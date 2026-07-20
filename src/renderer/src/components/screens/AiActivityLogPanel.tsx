import React, { useEffect, useMemo, useState } from "react";
import { clearAiActivityLog, formatAiActivityTime, readAiActivityLog, type AiActivityEntry } from "../../lib/aiActivityLog";

const KIND_META: Record<AiActivityEntry["kind"], { icon: string; label: string }> = {
  related: { icon: "✦", label: "関連" },
  index: { icon: "◇", label: "Index" },
  glossary: { icon: "用", label: "用語" },
  save: { icon: "✓", label: "保存" },
  inbox: { icon: "↳", label: "整理" },
  system: { icon: "•", label: "System" },
};

export function useAiActivityLog(limit = 8): AiActivityEntry[] {
  const [items, setItems] = useState<AiActivityEntry[]>(() => readAiActivityLog());
  useEffect(() => {
    const refresh = () => setItems(readAiActivityLog());
    window.addEventListener("local-notion:ai-activity-log-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("local-notion:ai-activity-log-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return useMemo(() => items.slice(0, limit), [items, limit]);
}

export function AiActivityLogPanel({ compact = false, limit = 8 }: { compact?: boolean; limit?: number }) {
  const items = useAiActivityLog(limit);
  return (
    <section className={`ai-activity-panel-v729${compact ? " compact" : ""}`} aria-label="AI活動ログ">
      <header>
        <div>
          <span className="ai-activity-kicker-v729">AI ACTIVITY</span>
          <h3>AI活動ログ</h3>
        </div>
        {items.length ? <button type="button" onClick={() => clearAiActivityLog()} title="履歴を消去">消去</button> : null}
      </header>
      {items.length ? (
        <div className="ai-activity-list-v729">
          {items.map((item) => {
            const meta = KIND_META[item.kind] || KIND_META.system;
            return (
              <article key={item.id} className={`ai-activity-item-v729 kind-${item.kind}`}>
                <i>{meta.icon}</i>
                <div>
                  <div className="ai-activity-line-v729"><strong>{item.title}</strong><small>{formatAiActivityTime(item.createdAt)}</small></div>
                  {item.detail ? <p>{item.detail}</p> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="ai-activity-empty-v729">関連更新・Index更新・保存完了などをここに控えめに記録します。</p>
      )}
    </section>
  );
}
