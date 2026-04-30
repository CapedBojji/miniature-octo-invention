const toolbar = plugin.CreateToolbar("Pathfinding");

const visualizeButton = toolbar.CreateButton(
	"Visualize Graph",
	"Highlight path-graph nodes and connections in the viewport",
	"",
);

const clearButton = toolbar.CreateButton(
	"Clear Visualization",
	"Remove all path-graph highlights from the viewport",
	"",
);

const HIGHLIGHT_COLOR = new BrickColor("Bright blue");
const HIGHLIGHT_MATERIAL = Enum.Material.Neon;
const PART_SIZE = new Vector3(1, 1, 1);
const FOLDER_NAME = "PathfindingHighlights";

function getOrCreateFolder(): Folder {
	const existing = game.Workspace.FindFirstChild(FOLDER_NAME);
	if (existing?.IsA("Folder")) return existing;
	const folder = new Instance("Folder");
	folder.Name = FOLDER_NAME;
	folder.Parent = game.Workspace;
	return folder;
}

function clearHighlights(): void {
	const folder = game.Workspace.FindFirstChild(FOLDER_NAME);
	if (folder) folder.Destroy();
}

function visualizeNode(name: string, position: Vector3, folder: Folder): void {
	const part = new Instance("Part");
	part.Name = name;
	part.Size = PART_SIZE;
	part.Position = position;
	part.BrickColor = HIGHLIGHT_COLOR;
	part.Material = HIGHLIGHT_MATERIAL;
	part.Anchored = true;
	part.CanCollide = false;
	part.Parent = folder;
}

visualizeButton.Click.Connect(() => {
	clearHighlights();
	const folder = getOrCreateFolder();

	// Walk the workspace looking for PathNode configuration objects.
	// Developers tag their node parts with the "PathNode" attribute containing
	// the node name so this plugin can discover and highlight them.
	for (const descendant of game.Workspace.GetDescendants()) {
		if (!descendant.IsA("BasePart")) continue;
		const nodeName = descendant.GetAttribute("PathNode");
		if (typeOf(nodeName) !== "string") continue;
		visualizeNode(tostring(nodeName), descendant.Position, folder);
	}

	print(`[Pathfinding Plugin] Highlighted path nodes in '${FOLDER_NAME}'.`);
});

clearButton.Click.Connect(() => {
	clearHighlights();
	print("[Pathfinding Plugin] Cleared path-graph highlights.");
});
