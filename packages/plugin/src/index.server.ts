const toolbar = plugin.CreateToolbar("Pathfinding");
const button = toolbar.CreateButton("Pathfinding", "", "");

button.Click.Connect(() => {
	print("Pathfinding button clicked!");
});
