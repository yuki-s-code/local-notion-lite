import type { ApiClient } from "../../lib/api";
import {
  WorkspaceAiChatPanel,
  WorkspaceAiSearch,
} from "../search/WorkspaceAiSearch";

type Props = {
  api: ApiClient | null;
  open: boolean;
  mode: "chat" | "search";
  initialQuery: string;
  queuedPrompt: string;
  currentPageId: string;
  currentTitle: string;
  currentMarkdown: string;
  onClose: () => void;
  onQueuedPromptHandled: () => void;
  onGenerationStateChange: (state: { busy: boolean; question?: string }) => void;
  onOpenDetailedSearch: (query: string) => void;
  onOpenPage: (id: string) => void;
  onOpenDatabase: (id: string) => void;
  onOpenDatabaseRow: (databaseId: string, rowId: string) => void;
  onOpenJournal: (date: string) => void;
};

/** Keeps AI drawer routing and close behavior out of the main workspace component. */
export function WorkspaceAiDrawer({
  api,
  open,
  mode,
  initialQuery,
  queuedPrompt,
  currentPageId,
  currentTitle,
  currentMarkdown,
  onClose,
  onQueuedPromptHandled,
  onGenerationStateChange,
  onOpenDetailedSearch,
  onOpenPage,
  onOpenDatabase,
  onOpenDatabaseRow,
  onOpenJournal,
}: Props) {
  const closeThen = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <div
      className={`workspace-ai-drawer-backdrop ${open ? "" : "is-hidden-v461"}`}
      onMouseDown={onClose}
    >
      <aside
        className={`workspace-ai-drawer ${mode === "chat" ? "workspace-ai-drawer-chat-v353" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {mode === "chat" ? (
          <WorkspaceAiChatPanel
            api={api}
            autoFocus={open}
            currentPageId={currentPageId}
            currentTitle={currentTitle}
            currentMarkdown={currentMarkdown}
            queuedPrompt={queuedPrompt}
            onQueuedPromptHandled={onQueuedPromptHandled}
            onClose={onClose}
            onGenerationStateChange={onGenerationStateChange}
            onOpenDetailedSearch={onOpenDetailedSearch}
            onOpenPage={(id) => closeThen(() => onOpenPage(id))}
            onOpenDatabase={(id) => closeThen(() => onOpenDatabase(id))}
            onOpenDatabaseRow={(databaseId, rowId) => closeThen(() => onOpenDatabaseRow(databaseId, rowId))}
            onOpenJournal={(date) => closeThen(() => onOpenJournal(date))}
          />
        ) : (
          <WorkspaceAiSearch
            api={api}
            compact
            autoFocus={open}
            initialQuery={initialQuery}
            onClose={onClose}
            onOpenPage={(id) => closeThen(() => onOpenPage(id))}
            onOpenDatabase={(id) => closeThen(() => onOpenDatabase(id))}
            onOpenDatabaseRow={(databaseId, rowId) => closeThen(() => onOpenDatabaseRow(databaseId, rowId))}
            onOpenJournal={(date) => closeThen(() => onOpenJournal(date))}
          />
        )}
      </aside>
    </div>
  );
}
