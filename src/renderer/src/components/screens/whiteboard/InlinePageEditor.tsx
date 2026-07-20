import React, { useEffect, useState } from "react";
import type { PageBundle } from "../../../../../shared/types";

export function InlinePageEditor({
  bundle,
  saving,
  onCancel,
  onSave,
}: {
  bundle: PageBundle;
  saving: boolean;
  onCancel: () => void;
  onSave: (changes: { title: string; markdown: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(bundle.meta.title);
  const [markdown, setMarkdown] = useState(bundle.markdown || "");

  useEffect(() => {
    setTitle(bundle.meta.title);
    setMarkdown(bundle.markdown || "");
  }, [bundle]);

  return (
    <section
      className="freeform-inline-page-editor"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <header>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="ページタイトル"
          placeholder="無題"
        />
        <div>
          <button type="button" onClick={onCancel} disabled={saving}>取消</button>
          <button
            type="button"
            className="primary"
            onClick={() => void onSave({ title: title.trim() || "無題", markdown })}
            disabled={saving}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </header>
      <textarea
        value={markdown}
        onChange={(event) => setMarkdown(event.target.value)}
        aria-label="ページ本文"
        placeholder="Markdownで編集…"
      />
      <footer>キャンバスを離れずに編集できます。Escで閉じます。</footer>
    </section>
  );
}
