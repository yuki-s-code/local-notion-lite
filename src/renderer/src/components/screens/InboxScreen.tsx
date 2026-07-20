import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { InboxAttachment, InboxItem } from "../../../../shared/types";

export function QuickCaptureModal({
  open,
  value,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  return createPortal(
    <div className="quick-capture-backdrop" onMouseDown={onClose}>
      <section
        className="quick-capture-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quick-capture-head">
          <span>⚡</span>
          <div>
            <strong>Quick Capture</strong>
            <small>あとで整理するメモをInboxへ保存</small>
          </div>
          <button
            className="icon-toolbar-button"
            onClick={onClose}
            title="閉じる"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
        <textarea
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="思いつき、会議中のメモ、あとで整理したい内容を書きます…"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSubmit();
          }}
        />
        <div className="quick-capture-actions">
          <small>⌘/Ctrl + Enter で保存</small>
          <button className="secondary" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="toolbar-primary"
            onClick={onSubmit}
            disabled={!value.trim()}
          >
            Inboxへ保存
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function captureHint(item: InboxItem): string {
  const files = item.attachments || [];
  const name =
    `${item.title} ${item.text} ${files.map((file) => file.fileName).join(" ")}`.toLowerCase();
  if (files.some((file) => /\.pdf$/i.test(file.fileName)))
    return "資料として確認し、必要なら案件やWikiへ追加";
  if (files.some((file) => /\.(png|jpe?g|heic|webp)$/i.test(file.fileName)))
    return "画像メモとして内容確認・文字起こし候補";
  if (/問い合わせ|見学|申込|相談/.test(name))
    return "問い合わせ記録・FAQ候補として整理";
  if (/会議|打合せ|議題/.test(name)) return "会議メモとして整理し、TODOを確認";
  if (/期限|までに|対応|確認/.test(name))
    return "タスク化または案件への追加を検討";
  return "ページ化・Journal追加・アーカイブから整理先を選択";
}

type InboxPreviewTarget = {
  inboxId: string;
  itemTitle: string;
  file: InboxAttachment;
};

type InboxPreviewKind = "pdf" | "image" | "text" | "office" | "other";

function inboxPreviewKind(file: InboxAttachment): InboxPreviewKind {
  const name = file.fileName.toLowerCase();
  const type = String(file.mimeType || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    type.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(name)
  )
    return "image";
  if (type.startsWith("text/") || /\.(txt|md|csv|json|log)$/i.test(name))
    return "text";
  if (/\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(name)) return "office";
  return "other";
}

function previewLabel(kind: InboxPreviewKind): string {
  if (kind === "pdf") return "PDFプレビュー";
  if (kind === "image") return "画像プレビュー";
  if (kind === "text") return "テキストプレビュー";
  if (kind === "office") return "Officeファイル";
  return "添付ファイル";
}

export function InboxView({
  items,
  drafts,
  onDraft,
  onUpdate,
  onCreatePage,
  onSendJournal,
  onArchive,
  onDelete,
  onCaptureFiles,
  onOpenOcrCenter,
  attachmentUrl,
}: {
  items: InboxItem[];
  drafts: Record<string, string>;
  onDraft: (id: string, text: string) => void;
  onUpdate: (id: string, patch: Partial<InboxItem>) => void;
  onCreatePage: (item: InboxItem) => void;
  onSendJournal: (item: InboxItem) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onCaptureFiles: (files: File[]) => Promise<void>;
  onOpenOcrCenter: () => void;
  attachmentUrl: (inboxId: string, attachmentId: string) => string;
}) {
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<"all" | "High" | "Mid" | "Low">(
    "all",
  );
  const [tag, setTag] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<InboxPreviewTarget | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tags = useMemo(
    () => Array.from(new Set(items.flatMap((item) => item.tags || []))).sort(),
    [items],
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const haystack = [
        item.title,
        item.text,
        item.priority,
        ...(item.tags || []),
        ...(item.attachments || []).map((file) => file.fileName),
      ]
        .join(" ")
        .toLowerCase();
      return (
        (!q || haystack.includes(q)) &&
        (priority === "all" || item.priority === priority) &&
        (!tag || (item.tags || []).includes(tag))
      );
    });
  }, [items, search, priority, tag]);
  const highCount = items.filter((item) => item.priority === "High").length;
  const tagText = (item: InboxItem) => (item.tags || []).join(", ");
  const parseTags = (value: string) =>
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 12);
  const previewFile = preview
    ? (
        items.find((item) => item.id === preview.inboxId)?.attachments || []
      ).find((file) => file.id === preview.file.id) || preview.file
    : null;
  const previewKind = previewFile ? inboxPreviewKind(previewFile) : "other";
  const captureFiles = async (list: FileList | File[]) => {
    const files = Array.from(list).filter((file) => file.size > 0);
    if (!files.length || uploading) return;
    setUploading(true);
    try {
      await onCaptureFiles(files);
    } finally {
      setUploading(false);
      setDragging(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  return (
    <section className="inbox-page inbox-workbench inbox-workbench-v487">
      <div className="inbox-hero inbox-hero-v92">
        <span className="inbox-hero-icon">📥</span>
        <div>
          <p className="section-kicker-v61">Capture first, organize later</p>
          <h1>Inbox</h1>
          <p>
            メモ・資料・画像を受け取り、あとからページ・Journal・案件へ整理します。
          </p>
        </div>
        <div className="inbox-insights">
          <span>
            <b>{items.length}</b>
            <small>open</small>
          </span>
          <span>
            <b>{highCount}</b>
            <small>high</small>
          </span>
          <span>
            <b>{tags.length}</b>
            <small>tags</small>
          </span>
        </div>
      </div>
      <div className="inbox-drop-layout-v487">
        <button
          className={`inbox-dropzone-v487${dragging ? " is-dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            void captureFiles(e.dataTransfer.files);
          }}
          disabled={uploading}
        >
          <span className="inbox-drop-icon-v487">{uploading ? "…" : "＋"}</span>
          <span>
            <strong>
              {uploading ? "Inboxへ保存中…" : "資料・画像をここへドロップ"}
            </strong>
            <small>
              PDF / Word / Excel / 画像 / テキスト　・　最大15MB/ファイル
            </small>
          </span>
          <em>ファイルを選択</em>
        </button>
        <aside className="inbox-capture-guide-v487">
          <b>整理候補</b>
          <span>
            投入後、内容に応じてページ化・Journal追加・タスク化の判断をしやすくします。
          </span>
        </aside>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => void captureFiles(e.target.files || [])}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp,.heic"
        />
      </div>
      <div className="inbox-toolbar-v92">
        <label>
          <span>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Inboxを検索"
          />
        </label>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as any)}
          title="優先度"
        >
          <option value="all">すべて</option>
          <option value="High">High</option>
          <option value="Mid">Mid</option>
          <option value="Low">Low</option>
        </select>
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          title="タグ"
        >
          <option value="">タグ</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {items.length === 0 ? (
        <div className="inbox-empty">
          <b>Inboxは空です</b>
          <span>
            ファイルをドロップするか、Cmd/Ctrl + Shift + Space
            でメモを追加できます。
          </span>
        </div>
      ) : (
        <div className="inbox-preview-layout-v488">
          <div className="inbox-list inbox-list-v92">
            {visible.map((item) => {
              const text = drafts[item.id] ?? item.text;
              return (
                <article
                  key={item.id}
                  className={`inbox-card inbox-card-v92 priority-${(item.priority || "Mid").toLowerCase()}`}
                >
                  <div className="inbox-card-top inbox-card-top-v92">
                    <button
                      className="inbox-pin"
                      onClick={() =>
                        onUpdate(item.id, { pinned: !item.pinned })
                      }
                      title={item.pinned ? "ピンを外す" : "ピン留め"}
                    >
                      {item.pinned ? "📌" : "○"}
                    </button>
                    <div className="inbox-card-title">
                      <strong>{item.title}</strong>
                      <small>
                        {new Date(item.createdAt).toLocaleString("ja-JP")}
                      </small>
                    </div>
                    <select
                      value={item.priority || "Mid"}
                      onChange={(e) =>
                        onUpdate(item.id, {
                          priority: e.target.value as InboxItem["priority"],
                        })
                      }
                      title="優先度"
                    >
                      <option value="High">High</option>
                      <option value="Mid">Mid</option>
                      <option value="Low">Low</option>
                    </select>
                  </div>
                  <textarea
                    value={text}
                    onChange={(e) => onDraft(item.id, e.target.value)}
                    onBlur={() => {
                      if (text !== item.text)
                        onUpdate(item.id, {
                          text,
                          title:
                            text
                              .split(/\r?\n/)
                              .map((v) => v.trim())
                              .find(Boolean)
                              ?.slice(0, 80) || item.title,
                        });
                    }}
                  />
                  {(item.attachments || []).length > 0 && (
                    <div className="inbox-file-list-v487">
                      {item.attachments?.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          className={
                            preview?.inboxId === item.id &&
                            preview.file.id === file.id
                              ? "is-selected"
                              : ""
                          }
                          onClick={() =>
                            setPreview({
                              inboxId: item.id,
                              itemTitle: item.title,
                              file,
                            })
                          }
                          title={`${file.fileName} をプレビュー`}
                        >
                          📎 {file.fileName}
                          <small>{Math.ceil(file.sizeBytes / 1024)}KB</small>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="inbox-suggestion-v487">
                    <span>✦ 整理候補</span>
                    <p>{captureHint(item)}</p>
                  </div>
                  <input
                    className="inbox-tag-input"
                    value={tagText(item)}
                    onChange={(e) =>
                      onUpdate(item.id, { tags: parseTags(e.target.value) })
                    }
                    placeholder="タグをカンマ区切りで追加"
                  />
                  <div className="inbox-card-actions inbox-card-actions-v92">
                    <button
                      onClick={() => onCreatePage({ ...item, text })}
                      title="ページ化"
                      aria-label="ページ化"
                    >
                      📄
                    </button>
                    <button
                      onClick={() => onSendJournal({ ...item, text })}
                      title="今日のJournalへ追加"
                      aria-label="Journalへ追加"
                    >
                      📅
                    </button>
                    <button
                      onClick={() => onArchive(item.id)}
                      title="アーカイブ"
                      aria-label="アーカイブ"
                    >
                      ✓
                    </button>
                    <button
                      className="danger"
                      onClick={() => onDelete(item.id)}
                      title="削除"
                      aria-label="削除"
                    >
                      🗑️
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <aside
            className="inbox-preview-pane-v488"
            aria-label="添付ファイルプレビュー"
          >
            {!preview || !previewFile ? (
              <div className="inbox-preview-empty-v488">
                <span>▧</span>
                <b>添付を選ぶとここに表示されます</b>
                <small>PDF・画像・テキストはそのまま確認できます。</small>
              </div>
            ) : (
              (() => {
                const kind = inboxPreviewKind(previewFile);
                const url = attachmentUrl(preview.inboxId, previewFile.id);
                return (
                  <>
                    <header className="inbox-preview-head-v488">
                      <div>
                        <small>{previewLabel(kind)}</small>
                        <strong title={previewFile.fileName}>
                          {previewFile.fileName}
                        </strong>
                        <span>{preview.itemTitle}</span>
                      </div>
                      <div>
                        <a href={url} target="_blank" rel="noreferrer">
                          別画面で開く ↗
                        </a>
                        <button
                          type="button"
                          onClick={() => setPreview(null)}
                          aria-label="プレビューを閉じる"
                          title="プレビューを閉じる"
                        >
                          ×
                        </button>
                      </div>
                    </header>
                    <div className={`inbox-preview-body-v488 kind-${kind}`}>
                      {kind === "pdf" && (
                        <iframe title={previewFile.fileName} src={url} />
                      )}
                      {kind === "image" && (
                        <img src={url} alt={previewFile.fileName} />
                      )}
                      {kind === "text" && (
                        <iframe title={previewFile.fileName} src={url} />
                      )}
                      {kind === "office" && (
                        <div className="inbox-preview-office-v488">
                          <span>▤</span>
                          <b>
                            この形式はアプリ内の完全プレビューに対応していません
                          </b>
                          <p>
                            Word・Excelは表示崩れを避けるため、対応アプリで確認します。
                          </p>
                          <a href={url} target="_blank" rel="noreferrer">
                            {previewFile.fileName} を開く ↗
                          </a>
                        </div>
                      )}
                      {kind === "other" && (
                        <div className="inbox-preview-office-v488">
                          <span>⌁</span>
                          <b>このファイルは外部アプリで開きます</b>
                          <a href={url} target="_blank" rel="noreferrer">
                            {previewFile.fileName} を開く ↗
                          </a>
                        </div>
                      )}
                    </div>
                    {(previewKind === "image" || previewKind === "pdf") && (
                      <section className="inbox-ocr-center-link">
                        <div>
                          <b>OCRはOCRセンターで一元管理します</b>
                          <small>処理の予約、停止、再実行、結果確認はOCRセンターから行います。</small>
                        </div>
                        <button type="button" onClick={onOpenOcrCenter}>OCRセンターを開く</button>
                      </section>
                    )}
                  </>
                );
              })()
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
