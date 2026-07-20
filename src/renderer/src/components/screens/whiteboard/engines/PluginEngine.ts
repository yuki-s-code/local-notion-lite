export type WhiteboardPlugin = {
  id: string;
  name: string;
  version: string;
  capabilities: Array<"node" | "edge" | "layout" | "command" | "export">;
};

class WhiteboardPluginRegistry {
  private readonly plugins = new Map<string, WhiteboardPlugin>();

  register(plugin: WhiteboardPlugin) {
    if (this.plugins.has(plugin.id)) return false;
    this.plugins.set(plugin.id, plugin);
    return true;
  }

  unregister(id: string) {
    return this.plugins.delete(id);
  }

  list() {
    return [...this.plugins.values()];
  }
}

export const PluginEngine = new WhiteboardPluginRegistry();
PluginEngine.register({
  id: "core.knowledge-graph",
  name: "Knowledge Graph",
  version: "1.0.0",
  capabilities: ["node", "edge", "layout", "command"],
});
PluginEngine.register({
  id: "core.inline-page",
  name: "Inline Page Editor",
  version: "1.0.0",
  capabilities: ["node", "command"],
});

PluginEngine.register({
  id: "integration.google-workspace",
  name: "Google Workspace",
  version: "2.0.0",
  capabilities: ["node", "command", "export"],
});
