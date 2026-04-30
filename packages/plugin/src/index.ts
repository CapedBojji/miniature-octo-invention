import ts from "typescript";

/**
 * Represents a path node extracted at compile time.
 */
export interface PathNodeInfo {
	name: string;
	position: { x: number; y: number; z: number };
	connections: string[];
}

/**
 * Represents a navigation graph generated at compile time.
 */
export interface NavigationGraph {
	nodes: Record<string, PathNodeInfo>;
}

/**
 * Extracts numeric literal values from a TypeScript expression.
 */
function extractNumericLiteral(node: ts.Expression): number | undefined {
	if (ts.isNumericLiteral(node)) {
		return Number(node.text);
	}
	if (
		ts.isPrefixUnaryExpression(node) &&
		node.operator === ts.SyntaxKind.MinusToken &&
		ts.isNumericLiteral(node.operand)
	) {
		return -Number(node.operand.text);
	}
	return undefined;
}

/**
 * Parses a `{ x, y, z }` object literal into a position tuple.
 */
function parsePositionLiteral(
	node: ts.Expression,
): { x: number; y: number; z: number } | undefined {
	if (!ts.isObjectLiteralExpression(node)) return undefined;
	const pos: Record<string, number> = {};
	for (const prop of node.properties) {
		if (!ts.isPropertyAssignment(prop)) continue;
		const key = ts.isIdentifier(prop.name) ? prop.name.text : undefined;
		if (!key || !["x", "y", "z"].includes(key)) continue;
		const val = extractNumericLiteral(prop.initializer);
		if (val === undefined) return undefined;
		pos[key] = val;
	}
	if (pos.x === undefined || pos.y === undefined || pos.z === undefined) return undefined;
	return { x: pos.x, y: pos.y, z: pos.z };
}

/**
 * Parses a string array literal into a connections array.
 */
function parseConnectionsLiteral(node: ts.Expression): string[] | undefined {
	if (!ts.isArrayLiteralExpression(node)) return undefined;
	const connections: string[] = [];
	for (const elem of node.elements) {
		if (!ts.isStringLiteral(elem)) return undefined;
		connections.push(elem.text);
	}
	return connections;
}

/**
 * Attempts to extract a PathNodeInfo from an object literal expression that matches:
 * { name: "...", position: { x: N, y: N, z: N }, connections: ["...", ...] }
 */
function extractPathNodeFromObject(node: ts.ObjectLiteralExpression): PathNodeInfo | undefined {
	let name: string | undefined;
	let position: { x: number; y: number; z: number } | undefined;
	let connections: string[] | undefined;

	for (const prop of node.properties) {
		if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
		switch (prop.name.text) {
			case "name":
				if (ts.isStringLiteral(prop.initializer)) {
					name = prop.initializer.text;
				}
				break;
			case "position":
				position = parsePositionLiteral(prop.initializer);
				break;
			case "connections":
				connections = parseConnectionsLiteral(prop.initializer);
				break;
		}
	}

	if (name === undefined || position === undefined || connections === undefined) return undefined;
	return { name, position, connections };
}

/**
 * Builds a serialized navigation graph object literal from the collected nodes.
 * This replaces the original `definePathGraph(nodes)` call with an inlined constant.
 */
function buildGraphLiteral(
	graph: NavigationGraph,
	factory: ts.NodeFactory,
): ts.ObjectLiteralExpression {
	const nodeProperties = Object.values(graph.nodes).map((node) =>
		factory.createPropertyAssignment(
			factory.createStringLiteral(node.name),
			factory.createObjectLiteralExpression(
				[
					factory.createPropertyAssignment(
						factory.createIdentifier("name"),
						factory.createStringLiteral(node.name),
					),
					factory.createPropertyAssignment(
						factory.createIdentifier("position"),
						factory.createObjectLiteralExpression(
							[
								factory.createPropertyAssignment(
									factory.createIdentifier("x"),
									factory.createNumericLiteral(node.position.x),
								),
								factory.createPropertyAssignment(
									factory.createIdentifier("y"),
									factory.createNumericLiteral(node.position.y),
								),
								factory.createPropertyAssignment(
									factory.createIdentifier("z"),
									factory.createNumericLiteral(node.position.z),
								),
							],
							true,
						),
					),
					factory.createPropertyAssignment(
						factory.createIdentifier("connections"),
						factory.createArrayLiteralExpression(
							node.connections.map((c) => factory.createStringLiteral(c)),
						),
					),
				],
				true,
			),
		),
	);

	return factory.createObjectLiteralExpression(
		[
			factory.createPropertyAssignment(
				factory.createIdentifier("nodes"),
				factory.createObjectLiteralExpression(nodeProperties, true),
			),
		],
		true,
	);
}

/**
 * Validates that all connections in the graph reference existing nodes.
 * Prints a warning for any dangling references, including the source location.
 */
function validateGraph(graph: NavigationGraph, callNode: ts.Node): void {
	const nodeNames = new Set(Object.keys(graph.nodes));
	for (const node of Object.values(graph.nodes)) {
		for (const conn of node.connections) {
			if (!nodeNames.has(conn)) {
				const sourceFile = callNode.getSourceFile();
				const { line, character } = sourceFile.getLineAndCharacterOfPosition(callNode.getStart());
				// Use process.stderr so the warning surfaces in the build output.
				process.stderr.write(
					`${sourceFile.fileName}(${line + 1},${character + 1}): warning TS9001: ` +
						`PathGraph: node "${node.name}" has connection to unknown node "${conn}". ` +
						`Available nodes: ${[...nodeNames].join(", ")}\n`,
				);
			}
		}
	}
}

/**
 * The main transformer factory.
 *
 * Transforms calls to `definePathGraph([...nodes])` by:
 *  1. Parsing each node literal at compile time.
 *  2. Validating all inter-node connections.
 *  3. Replacing the call with an inlined, pre-validated graph constant.
 *
 * This eliminates the runtime cost of building the navigation graph and
 * catches connection errors during compilation rather than at runtime.
 */
function transformer(_program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
	return (context: ts.TransformationContext) => {
		return (sourceFile: ts.SourceFile): ts.SourceFile => {
			function visit(node: ts.Node): ts.Node {
				// Match: definePathGraph([...])
				if (
					ts.isCallExpression(node) &&
					ts.isIdentifier(node.expression) &&
					node.expression.text === "definePathGraph" &&
					node.arguments.length === 1 &&
					ts.isArrayLiteralExpression(node.arguments[0])
				) {
					const arrayArg = node.arguments[0] as ts.ArrayLiteralExpression;
					const graph: NavigationGraph = { nodes: {} };

					for (const elem of arrayArg.elements) {
						if (!ts.isObjectLiteralExpression(elem)) continue;
						const info = extractPathNodeFromObject(elem);
						if (info) {
							graph.nodes[info.name] = info;
						}
					}

					validateGraph(graph, node);
					return buildGraphLiteral(graph, context.factory);
				}

				return ts.visitEachChild(node, visit, context);
			}

			return ts.visitNode(sourceFile, visit) as ts.SourceFile;
		};
	};
}

export default transformer;
