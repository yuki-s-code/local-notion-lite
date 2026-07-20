import React, { useEffect, useMemo, useRef, useState } from "react";
import type { InboxAttachment, InboxItem } from "../../../../shared/types";

type OcrOptions = {
  mode?: "inspect" | "page" | "all";
  page?: number;
  preprocessing?: "standard" | "enhanced";
};

function isOcrTarget(file: InboxAttachment): boolean {
  const name = String(file.fileName || "").toLowerCase();
  const type = String(file.mimeType || "").toLowerCase();
  return type === "application/pdf" || type.startsWith("image/") || /\.(pdf|png|jpe?g|gif|webp|bmp|tiff?)$/i.test(name);
}

function fileKind(file: InboxAttachment): "pdf" | "image" {
  const name = String(file.fileName || "").toLowerCase();
  const type = String(file.mimeType || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf") ? "pdf" : "image";
}

function queueLabel(file: InboxAttachment): string {
  const status = file.ocrQueue?.status;
  if (status === "queued") return "待機中";
  if (status === "running") return "処理中";
  if (status === "cancelling") return "停止待ち";
  if (status === "completed") return "完了";
  if (status === "failed") return "失敗";
  if (status === "cancelled") return "中止";
  if (file.ocr?.status === "ready") return "文字抽出済み";
  if (file.pdfText?.status === "ready") return "PDF本文あり";
  return "未処理";
}

function formatSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "サイズ不明";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string): string {
  if (!value) return "日時不明";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP");
}

export function OcrCenterView({
  items,
  attachmentUrl,
  onCaptureFiles,
  onRunOcr,
  onCancelOcr,
  onRetryOcr,
  onRefresh,
  onAskAiFromOcr,
  onOpenInbox,
  focusedKey,
}: {
  items: InboxItem[];
  attachmentUrl: (inboxId: string, attachmentId: string) => string;
  onCaptureFiles: (files: File[]) => Promise<void>;
  onRunOcr: (inboxId: string, attachmentId: string, options?: OcrOptions) => Promise<InboxItem>;
  onCancelOcr: (inboxId: string, attachmentId: string) => Promise<void>;
  onRetryOcr: (inboxId: string, attachmentId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onAskAiFromOcr: (item: InboxItem, file: InboxAttachment, text: string) => void;
  onOpenInbox: () => void;
  focusedKey?: string;
}) {
  const [filter, setFilter] = useState<"all" | "pending" | "active" | "done" | "failed">("all");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [busyKey, setBusyKey] = useState<string>("");
  const [preprocessing, setPreprocessing] = useState<"standard" | "enhanced">("standard");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const records = useMemo(
    () =>
      items
        .flatMap((item) =>
          (item.attachments || [])
            .filter(isOcrTarget)
            .map((file) => ({ item, file, key: `${item.id}:${file.id}` })),
        )
        .sort((a, b) => {
          const aRunning = ["running", "queued", "cancelling"].includes(String(a.file.ocrQueue?.status || ""));
          const bRunning = ["running", "queued", "cancelling"].includes(String(b.file.ocrQueue?.status || ""));
          if (aRunning !== bRunning) return aRunning ? -1 : 1;
          return String(b.file.createdAt || b.item.updatedAt).localeCompare(String(a.file.createdAt || a.item.updatedAt));
        }),
    [items],
  );

  const visibleRecords = useMemo(() => records.filter(({ file }) => {
    const status = String(file.ocrQueue?.status || "");
    if (filter === "active") return ["queued", "running", "cancelling"].includes(status);
    if (filter === "pending") return !status && file.ocr?.status !== "ready" && file.pdfText?.status !== "ready";
    if (filter === "done") return file.ocr?.status === "ready" || file.pdfText?.status === "ready" || status === "completed";
    if (filter === "failed") return ["failed", "cancelled"].includes(status) || file.ocr?.status === "failed" || file.pdfText?.status === "failed";
    return true;
  }), [filter, records]);

  const selected = records.find((record) => record.key === selectedKey) || visibleRecords[0] || records[0];
  const activeCount = records.filter(({ file }) => ["queued", "running", "cancelling"].includes(String(file.ocrQueue?.status || ""))).length;
  const pendingCount = records.filter(({ file }) => !file.ocrQueue && file.ocr?.status !== "ready" && file.pdfText?.status !== "ready").length;
  const doneCount = records.filter(({ file }) => file.ocr?.status === "ready" || file.pdfText?.status === "ready" || file.ocrQueue?.status === "completed").length;

  useEffect(() => {
    if (!focusedKey) return;
    if (records.some((record) => record.key === focusedKey)) {
      setSelectedKey(focusedKey);
      setError("");
    }
  }, [focusedKey, records]);

  useEffect(() => {
    if (!activeCount) return;
    const timer = window.setInterval(() => void onRefresh(), 1800);
    return () => window.clearInterval(timer);
  }, [activeCount, onRefresh]);

  const run = async (record: { item: InboxItem; file: InboxAttachment; key: string }, options: OcrOptions) => {
    if (busyKey) return;
    setBusyKey(record.key);
    setError("");
    try {
      await onRunOcr(record.item.id, record.file.id, { ...options, preprocessing });
      await onRefresh();
    } catch (cause: any) {
      setError(String(cause?.message || cause || "OCRの予約に失敗しました。"));
    } finally {
      setBusyKey("");
    }
  };

  const upload = async (files: FileList | null) => {
    const selectedFiles = Array.from(files || []).filter((file) => file.size > 0);
    if (!selectedFiles.length) return;
    setError("");
    try {
      await onCaptureFiles(selectedFiles);
      await onRefresh();
    } catch (cause: any) {
      setError(String(cause?.message || cause || "ファイルをOCRセンターへ追加できませんでした。"));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const kind = selected ? fileKind(selected.file) : "image";
  const fileUrl = selected ? attachmentUrl(selected.item.id, selected.file.id) : "#";
  const isActive = selected && ["queued", "running", "cancelling"].includes(String(selected.file.ocrQueue?.status || ""));

  return (
    <section className="ocr-center-screen">
      <header className="ocr-center-hero">
        <div className="ocr-center-hero-copy">
          <span className="ocr-center-eyebrow">ONE OCR QUEUE</span>
          <h1>OCRセンター</h1>
          <p>画像・PDFの文字抽出はここで一元管理します。ページ、DB行、Journalには実行ボタンを置かず、結果と状態だけを参照します。</p>
        </div>
        <div className="ocr-center-hero-actions">
          <input ref={inputRef} type="file" accept="image/*,.pdf" multiple hidden onChange={(event) => void upload(event.target.files)} />
          <button type="button" className="ocr-center-upload" onClick={() => inputRef.current?.click()}>＋ OCR対象を追加</button>
          <button type="button" className="ocr-center-secondary" onClick={onOpenInbox}>Inboxを開く</button>
        </div>
      </header>

      <div className="ocr-center-metrics" aria-label="OCRの状態">
        <button type="button" className={filter === "active" ? "is-selected" : ""} onClick={() => setFilter("active")}><b>{activeCount}</b><span>処理中・待機</span></button>
        <button type="button" className={filter === "pending" ? "is-selected" : ""} onClick={() => setFilter("pending")}><b>{pendingCount}</b><span>未処理</span></button>
        <button type="button" className={filter === "done" ? "is-selected" : ""} onClick={() => setFilter("done")}><b>{doneCount}</b><span>完了</span></button>
        <button type="button" className={filter === "all" ? "is-selected" : ""} onClick={() => setFilter("all")}><b>{records.length}</b><span>対象ファイル</span></button>
      </div>

      {error ? <p className="ocr-center-error">{error}</p> : null}

      {!records.length ? (
        <div className="ocr-center-empty">
          <span>⌁</span><h2>まだOCR対象がありません</h2><p>画像またはPDFを追加すると、この画面で処理順・状態・抽出結果を管理できます。</p>
          <button type="button" className="ocr-center-upload" onClick={() => inputRef.current?.click()}>最初のファイルを追加</button>
        </div>
      ) : (
        <div className="ocr-center-layout">
          <aside className="ocr-center-list" aria-label="OCR対象一覧">
            <div className="ocr-center-list-head"><strong>OCR対象</strong><small>{visibleRecords.length}件</small></div>
            {visibleRecords.length ? visibleRecords.map((record) => {
              const selectedCard = selected?.key === record.key;
              return <button type="button" key={record.key} className={`ocr-center-item ${selectedCard ? "is-selected" : ""}`} onClick={() => { setSelectedKey(record.key); setError(""); }}>
                <span className={`ocr-center-type ${fileKind(record.file)}`}>{fileKind(record.file) === "pdf" ? "PDF" : "IMG"}</span>
                <span className="ocr-center-item-copy"><b>{record.file.fileName}</b><small>{record.item.title} ・ {formatSize(record.file.sizeBytes)}</small></span>
                <em className={`state-${String(record.file.ocrQueue?.status || (record.file.ocr?.status === "ready" ? "completed" : "idle"))}`}>{queueLabel(record.file)}</em>
              </button>;
            }) : <div className="ocr-center-list-empty">この条件の対象はありません。</div>}
          </aside>

          {selected ? <article className="ocr-center-detail">
            <div className="ocr-center-detail-head">
              <div><span>{kind === "pdf" ? "PDF" : "画像"}</span><h2>{selected.file.fileName}</h2><p>{selected.item.title} ・ {formatSize(selected.file.sizeBytes)} ・ {formatDate(selected.file.createdAt)}</p></div>
              <a href={fileUrl} target="_blank" rel="noreferrer">原本を開く ↗</a>
            </div>
            <div className="ocr-center-preview">{kind === "pdf" ? <iframe title={selected.file.fileName} src={fileUrl} /> : <img src={fileUrl} alt={selected.file.fileName} />}</div>

            <div className="ocr-center-controls">
              <div className="ocr-center-control-copy"><b>認識モード</b><small>高精度は傾き補正・白黒化・コントラスト調整を試みます。</small></div>
              <div className="ocr-center-segment"><button type="button" className={preprocessing === "standard" ? "is-active" : ""} onClick={() => setPreprocessing("standard")}>標準</button><button type="button" className={preprocessing === "enhanced" ? "is-active" : ""} onClick={() => setPreprocessing("enhanced")}>高精度</button></div>
            </div>

            {selected.file.ocrQueue ? <div className={`ocr-center-queue state-${selected.file.ocrQueue.status}`}><b>{queueLabel(selected.file)}</b><span>試行 {selected.file.ocrQueue.attempt}回目{selected.file.ocrQueue.totalPages ? ` ・ ${Math.min(selected.file.ocrQueue.processedPages || 0, selected.file.ocrQueue.totalPages)} / ${selected.file.ocrQueue.totalPages}ページ` : ""}</span>{["queued", "running"].includes(selected.file.ocrQueue.status) ? <button type="button" onClick={() => void onCancelOcr(selected.item.id, selected.file.id).then(onRefresh)}>停止</button> : null}{["failed", "cancelled"].includes(selected.file.ocrQueue.status) ? <button type="button" onClick={() => void onRetryOcr(selected.item.id, selected.file.id).then(onRefresh)}>再実行</button> : null}</div> : null}

            {kind === "image" ? <div className="ocr-center-action-row"><button type="button" className="ocr-center-upload" disabled={Boolean(busyKey) || Boolean(isActive)} onClick={() => void run(selected, { mode: "page", page: 1 })}>{busyKey === selected.key ? "キューへ追加中…" : selected.file.ocr?.status === "ready" ? "再実行を予約" : "OCRを予約"}</button></div> : <div className="ocr-center-pdf-actions"><button type="button" className="ocr-center-secondary" disabled={Boolean(busyKey) || Boolean(isActive)} onClick={() => void run(selected, { mode: "inspect" })}>PDF本文を確認</button>{selected.file.pdfText?.status !== "ready" ? <><label>ページ<input type="number" min="1" value={page} onChange={(event) => setPage(Math.max(1, Number(event.target.value || 1)))} /></label><button type="button" className="ocr-center-secondary" disabled={Boolean(busyKey) || Boolean(isActive)} onClick={() => void run(selected, { mode: "page", page })}>このページをOCR</button><button type="button" className="ocr-center-danger" disabled={Boolean(busyKey) || Boolean(isActive)} onClick={() => { if (window.confirm("PDFの全ページをOCRします。ページ数が多い場合は時間がかかります。続行しますか？")) void run(selected, { mode: "all" }); }}>全ページOCR</button></> : <p className="ocr-center-text-pdf">文字PDFを検出しました。OCRは不要です。</p>}</div>}

            {(selected.file.ocr?.status === "ready" || selected.file.pdfText?.status === "ready") ? <section className="ocr-center-result"><div><b>{selected.file.ocr?.status === "ready" ? "OCR結果" : "PDF本文"}</b><small>{formatDate(selected.file.ocr?.updatedAt || selected.file.pdfText?.updatedAt)}</small></div><textarea readOnly value={selected.file.ocr?.text || selected.file.pdfText?.text || "文字を検出できませんでした。"} /><button type="button" className="ocr-center-secondary" onClick={() => onAskAiFromOcr(selected.item, selected.file, selected.file.ocr?.text || selected.file.pdfText?.text || "")}>AIで整理</button></section> : null}
          </article> : null}
        </div>
      )}
    </section>
  );
}
