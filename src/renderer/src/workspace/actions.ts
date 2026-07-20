import type { WorkspaceScreenId } from "./types";

export type WorkspaceAction =
  | { type: "open-screen"; screen: WorkspaceScreenId }
  | { type: "focus-documents" }
  | { type: "reset-layout" };

type Listener = (action: WorkspaceAction) => void;
const listeners = new Set<Listener>();

export const workspaceActions = {
  dispatch(action: WorkspaceAction) {
    for (const listener of listeners) listener(action);
  },
  openScreen(screen: WorkspaceScreenId) {
    this.dispatch({ type: "open-screen", screen });
  },
  focusDocuments() {
    this.dispatch({ type: "focus-documents" });
  },
  resetLayout() {
    this.dispatch({ type: "reset-layout" });
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
