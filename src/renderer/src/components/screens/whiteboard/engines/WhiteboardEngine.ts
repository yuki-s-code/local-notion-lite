import { AIEngine } from "./AIEngine";
import { NodeEngine } from "./NodeEngine";
import { RenderEngine } from "./RenderEngine";
import { SelectionEngine } from "./SelectionEngine";
import { PluginEngine } from "./PluginEngine";

export const WhiteboardEngine = {
  node: NodeEngine,
  render: RenderEngine,
  selection: SelectionEngine,
  ai: AIEngine,
  plugins: PluginEngine,
};

