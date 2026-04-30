/**
 * Represents a position in 3D space.
 * Uses plain numbers so it can be serialised at compile time by the plugin.
 */
export interface PathPosition {
	x: number;
	y: number;
	z: number;
}

/**
 * A single node in the navigation graph.
 * The plugin validates all connections at compile time.
 */
export interface PathNode {
	name: string;
	position: PathPosition;
	connections: string[];
}

/**
 * A navigation graph produced (and validated) by the compile-time plugin.
 */
export interface NavigationGraph {
	nodes: Record<string, PathNode>;
}

/**
 * A waypoint along a computed path.
 */
export interface Waypoint {
	/** World-space position to move to. */
	position: Vector3;
	/** Human-readable name from the navigation graph. */
	label: string;
}

/**
 * Result returned by `findPath`.
 */
export interface PathResult {
	/** Whether a path was found. */
	success: boolean;
	/** Ordered list of waypoints from start to destination. */
	waypoints: Waypoint[];
	/** Total estimated travel distance. */
	totalDistance: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Converts a `PathPosition` record into a Roblox `Vector3`.
 */
function toVector3(pos: PathPosition): Vector3 {
	return new Vector3(pos.x, pos.y, pos.z);
}

/**
 * Euclidean distance between two `PathPosition` values.
 */
function distance(a: PathPosition, b: PathPosition): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	const dz = a.z - b.z;
	return math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * A* shortest-path search over the navigation graph.
 * Returns an ordered list of node names, or `undefined` if no path exists.
 */
function astar(graph: NavigationGraph, startName: string, goalName: string): string[] | undefined {
	if (startName === goalName) return [startName];

	const goal = graph.nodes[goalName];
	if (!goal) return undefined;

	// g-scores: actual cost from start to each node
	const gScore = new Map<string, number>();
	// f-scores: g + heuristic
	const fScore = new Map<string, number>();
	// came-from: for path reconstruction
	const cameFrom = new Map<string, string>();
	// open set
	const openSet = new Set<string>();

	const heuristic = (name: string) => distance(graph.nodes[name].position, goal.position);

	gScore.set(startName, 0);
	fScore.set(startName, heuristic(startName));
	openSet.add(startName);

	while (openSet.size() > 0) {
		// Find node in openSet with lowest fScore
		let current: string | undefined;
		let bestF = math.huge;
		for (const name of openSet) {
			const f = fScore.get(name) ?? math.huge;
			if (f < bestF) {
				bestF = f;
				current = name;
			}
		}

		if (current === undefined) break;

		if (current === goalName) {
			// Reconstruct path
			const path: string[] = [];
			let node: string | undefined = goalName;
			while (node !== undefined) {
				path.insert(1, node);
				node = cameFrom.get(node);
			}
			return path;
		}

		openSet.delete(current);
		const currentNode = graph.nodes[current];
		if (!currentNode) continue;

		for (const neighbourName of currentNode.connections) {
			const neighbour = graph.nodes[neighbourName];
			if (!neighbour) continue;

			const tentativeG =
				(gScore.get(current) ?? math.huge) + distance(currentNode.position, neighbour.position);
			if (tentativeG < (gScore.get(neighbourName) ?? math.huge)) {
				cameFrom.set(neighbourName, current);
				gScore.set(neighbourName, tentativeG);
				fScore.set(neighbourName, tentativeG + heuristic(neighbourName));
				openSet.add(neighbourName);
			}
		}
	}

	return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Finds the shortest path between two named nodes in a navigation graph.
 *
 * The navigation graph is validated at compile time by the pathfinding plugin,
 * so all connection references are guaranteed to be valid before this function
 * is ever called at runtime.
 *
 * @param graph  - Navigation graph produced by `definePathGraph`.
 * @param start  - Name of the starting node.
 * @param goal   - Name of the destination node.
 * @returns A `PathResult` describing the computed path.
 *
 * @example
 * ```ts
 * const graph = definePathGraph([
 *   { name: "SpawnA", position: { x: 0,   y: 0, z: 0   }, connections: ["MidPoint"] },
 *   { name: "MidPoint", position: { x: 10, y: 0, z: 5   }, connections: ["SpawnA", "SpawnB"] },
 *   { name: "SpawnB", position: { x: 20,  y: 0, z: 0   }, connections: ["MidPoint"] },
 * ]);
 *
 * const result = findPath(graph, "SpawnA", "SpawnB");
 * if (result.success) {
 *   for (const wp of result.waypoints) {
 *     print(`Move to ${wp.label} at ${wp.position}`);
 *   }
 * }
 * ```
 */
export function findPath(graph: NavigationGraph, start: string, goal: string): PathResult {
	if (!(start in graph.nodes)) {
		return { success: false, waypoints: [], totalDistance: 0 };
	}
	if (!(goal in graph.nodes)) {
		return { success: false, waypoints: [], totalDistance: 0 };
	}

	const nodeNames = astar(graph, start, goal);
	if (!nodeNames) {
		return { success: false, waypoints: [], totalDistance: 0 };
	}

	const waypoints: Waypoint[] = nodeNames.map((name) => ({
		position: toVector3(graph.nodes[name].position),
		label: name,
	}));

	let totalDistance = 0;
	for (let i = 0; i < nodeNames.size() - 1; i++) {
		totalDistance += distance(
			graph.nodes[nodeNames[i]].position,
			graph.nodes[nodeNames[i + 1]].position,
		);
	}

	return { success: true, waypoints, totalDistance };
}

/**
 * Marker function used by the compile-time plugin to validate navigation graph
 * node definitions and inline the resulting graph constant.
 *
 * At compile time the plugin replaces every call to this function with a
 * pre-validated, inlined `NavigationGraph` object literal, eliminating the
 * runtime construction cost and catching dangling connection references as
 * compiler warnings.
 *
 * @param nodes - Array of path-node definitions.
 * @returns A fully-constructed `NavigationGraph`.
 */
export function definePathGraph(nodes: PathNode[]): NavigationGraph {
	const graph: NavigationGraph = { nodes: {} };
	for (const node of nodes) {
		graph.nodes[node.name] = node;
	}
	return graph;
}

/**
 * Moves a Roblox `Model` (typically an NPC or character) along a pre-computed
 * path by teleporting its `PrimaryPart` from waypoint to waypoint.
 *
 * For smooth movement you should replace this with a tween or a `Humanoid`
 * `MoveTo` call; this implementation is intentionally simple so it works
 * without a `Humanoid` present.
 *
 * @param model  - The model to move.
 * @param path   - A successful `PathResult` from `findPath`.
 */
export function followPath(model: Model, path: PathResult): void {
	if (!path.success) return;
	for (const waypoint of path.waypoints) {
		model.PivotTo(new CFrame(waypoint.position));
	}
}
