import type { MouseEventHandler } from "react";

type CurrentPageRef = {
  id: string;
  title?: string;
  icon?: string;
};

type Props = {
  currentPage?: CurrentPageRef | null;
  aiBusy: boolean;
  onChooseCurrentPageShelf: (page: CurrentPageRef) => void;
  onOpenAi: MouseEventHandler<HTMLButtonElement>;
};

/**
 * Keeps page-local actions and the global AI launcher in a single fixed rail.
 * Individual controls never own viewport coordinates, which prevents overlap
 * when an additional action is displayed for an open page.
 */
export function FloatingWorkspaceActions({
  currentPage,
  aiBusy,
  onChooseCurrentPageShelf,
  onOpenAi,
}: Props) {
  return (
    <div className="workspace-floating-actions" aria-label="ページ操作">
      {currentPage?.id ? (
        <button
          type="button"
          className="quick-add-current-shelf"
          title="現在のページを本棚に追加"
          aria-label="現在のページを本棚に追加"
          onClick={() => onChooseCurrentPageShelf(currentPage)}
        >
          <span aria-hidden="true">📚</span>
          <b>本棚へ</b>
        </button>
      ) : null}
      <button
        type="button"
        className={`workspace-ai-fab notion-ai-orb-v325 notion-ai-glyph-v463${aiBusy ? " is-generating-v463" : ""}`}
        title={aiBusy ? "AIが回答を生成中。押すと会話へ戻ります" : "AIアシスタント"}
        aria-label={aiBusy ? "AIが回答を生成中。AIアシスタントを開く" : "AIアシスタントを開く"}
        aria-busy={aiBusy}
        onClick={onOpenAi}
      >
        <span className="notion-ai-aurora-v464" aria-hidden="true" />
        <span className="notion-ai-orbit-v464 notion-ai-orbit-one-v464" aria-hidden="true"><i /></span>
        <span className="notion-ai-orbit-v464 notion-ai-orbit-two-v464" aria-hidden="true"><i /></span>
        <span className="notion-ai-orb-core notion-ai-core-v464" aria-hidden="true">
          <svg viewBox="0 0 48 48" focusable="false">
            <defs>
              <linearGradient id="aiOrbSparkV464" x1="10" y1="8" x2="39" y2="42" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="0.54" stopColor="#e9e7ff" />
                <stop offset="1" stopColor="#b8b5ff" />
              </linearGradient>
            </defs>
            <path className="orb-main" d="M24 6.3c3.2 8.15 7.5 12.4 15.7 15.7-8.2 3.25-12.5 7.55-15.7 15.7-3.22-8.15-7.52-12.45-15.7-15.7C16.48 18.7 20.78 14.45 24 6.3Z" />
            <path className="orb-mini orb-mini-a" d="M37.7 8.1c1.25 3.18 2.9 4.8 6.08 6.08-3.18 1.25-4.83 2.9-6.08 6.08-1.28-3.18-2.93-4.83-6.1-6.08 3.17-1.28 4.82-2.9 6.1-6.08Z" />
            <path className="orb-mini orb-mini-b" d="M9.4 29.9c.96 2.48 2.24 3.75 4.72 4.72-2.48.96-3.76 2.25-4.72 4.73-.98-2.48-2.26-3.77-4.74-4.73 2.48-.97 3.76-2.24 4.74-4.72Z" />
          </svg>
        </span>
        <span className="notion-ai-orb-generation-v463 notion-ai-generation-v464" aria-hidden="true" />
      </button>
    </div>
  );
}
