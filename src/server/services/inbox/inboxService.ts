import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";
import type {
  InboxAttachment,
  InboxItem,
  InboxOcrResult,
  InboxPdfTextResult,
  InboxOcrQueueState,
  OcrSourceRef,
} from "../../../shared/types";
import { vaultPaths } from "../../utils/paths";

export type InboxServiceDependencies = {
  sharedRoot: string;
  atomicWriteJson: (file: string, data: unknown) => Promise<void>;
  withSharedJsonMutation: <T>(
    file: string,
    task: () => Promise<T>,
  ) => Promise<T>;
  onSaved?: (item: InboxItem) => void | Promise<void>;
  onDeleted?: (id: string) => void | Promise<void>;
};

/** Inbox persistence isolated from VaultService; mutations re-read under a shared write lease. */
class OcrCancelledError extends Error {
  constructor() {
    super("OCR処理は停止されました。");
    this.name = "OcrCancelledError";
  }
}

type ClaimedOcrJob = {
  itemId: string;
  attachmentId: string;
  queue: InboxOcrQueueState;
};

const OCR_JOB_LEASE_MS = 90_000;
const OCR_HEARTBEAT_MS = 20_000;

export class InboxService {
  private ocrQueuePumping = false;
  private nextOcrRecoveryAt = 0;
  private readonly ocrWorkerId = `${os.hostname() || "local"}:${process.pid}:${nanoid(8)}`;

  constructor(private readonly deps: InboxServiceDependencies) {}

  file(): string {
    return path.join(vaultPaths(this.deps.sharedRoot).inbox, "items.json");
  }

  private attachmentDir(itemId: string): string {
    return path.join(
      vaultPaths(this.deps.sharedRoot).inbox,
      "attachments",
      itemId,
    );
  }

  private normalizeAttachment(
    input: Partial<InboxAttachment>,
  ): InboxAttachment {
    const fileName =
      path
        .basename(String(input.fileName || "attachment"))
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .slice(0, 180) || "attachment";
    return {
      id: String(input.id || `inboxfile_${nanoid(10)}`),
      fileName,
      mimeType: input.mimeType
        ? String(input.mimeType).slice(0, 200)
        : undefined,
      sizeBytes: Math.max(0, Number(input.sizeBytes || 0)),
      createdAt: input.createdAt || new Date().toISOString(),
      ocr:
        input.ocr && typeof input.ocr === "object"
          ? ({
              status: input.ocr.status === "ready" ? "ready" : "failed",
              text: String(input.ocr.text || ""),
              language: String(input.ocr.language || "jpn+eng"),
              updatedAt: String(
                input.ocr.updatedAt || new Date().toISOString(),
              ),
              engine: input.ocr.engine ? String(input.ocr.engine) : undefined,
              error: input.ocr.error
                ? String(input.ocr.error).slice(0, 600)
                : undefined,
              mode: ["image", "pdf-page", "pdf-all"].includes(
                String(input.ocr.mode),
              )
                ? input.ocr.mode
                : undefined,
              page: Number.isFinite(Number(input.ocr.page))
                ? Math.max(1, Number(input.ocr.page))
                : undefined,
              pageCount: Number.isFinite(Number(input.ocr.pageCount))
                ? Math.max(1, Number(input.ocr.pageCount))
                : undefined,
              preprocessing:
                input.ocr.preprocessing === "enhanced"
                  ? "enhanced"
                  : "standard",
              preprocessingNote: input.ocr.preprocessingNote
                ? String(input.ocr.preprocessingNote).slice(0, 300)
                : undefined,
              handwritingWarning: Boolean(input.ocr.handwritingWarning),
            } as InboxOcrResult)
          : undefined,
      pdfText:
        input.pdfText && typeof input.pdfText === "object"
          ? ({
              status:
                input.pdfText.status === "ready"
                  ? "ready"
                  : input.pdfText.status === "unavailable"
                    ? "unavailable"
                    : "failed",
              text: String(input.pdfText.text || ""),
              pageCount: Number.isFinite(Number(input.pdfText.pageCount))
                ? Math.max(1, Number(input.pdfText.pageCount))
                : undefined,
              updatedAt: String(
                input.pdfText.updatedAt || new Date().toISOString(),
              ),
              engine: input.pdfText.engine
                ? String(input.pdfText.engine)
                : undefined,
              error: input.pdfText.error
                ? String(input.pdfText.error).slice(0, 600)
                : undefined,
            } as InboxPdfTextResult)
          : undefined,
      ocrQueue:
        input.ocrQueue && typeof input.ocrQueue === "object"
          ? ({
              status: ["queued", "running", "cancelling", "completed", "failed", "cancelled"].includes(String(input.ocrQueue.status))
                ? input.ocrQueue.status
                : "failed",
              mode: ["inspect", "page", "all"].includes(String(input.ocrQueue.mode))
                ? input.ocrQueue.mode
                : "inspect",
              page: Number.isFinite(Number(input.ocrQueue.page))
                ? Math.max(1, Number(input.ocrQueue.page))
                : undefined,
              preprocessing: input.ocrQueue.preprocessing === "enhanced" ? "enhanced" : "standard",
              queuedAt: String(input.ocrQueue.queuedAt || new Date().toISOString()),
              startedAt: input.ocrQueue.startedAt ? String(input.ocrQueue.startedAt) : undefined,
              finishedAt: input.ocrQueue.finishedAt ? String(input.ocrQueue.finishedAt) : undefined,
              attempt: Math.max(1, Number(input.ocrQueue.attempt || 1)),
              workerId: input.ocrQueue.workerId ? String(input.ocrQueue.workerId).slice(0, 240) : undefined,
              leaseId: input.ocrQueue.leaseId ? String(input.ocrQueue.leaseId).slice(0, 120) : undefined,
              leaseExpiresAt: input.ocrQueue.leaseExpiresAt ? String(input.ocrQueue.leaseExpiresAt) : undefined,
              heartbeatAt: input.ocrQueue.heartbeatAt ? String(input.ocrQueue.heartbeatAt) : undefined,
              totalPages: Number.isFinite(Number(input.ocrQueue.totalPages)) ? Math.max(1, Number(input.ocrQueue.totalPages)) : undefined,
              processedPages: Number.isFinite(Number(input.ocrQueue.processedPages)) ? Math.max(0, Number(input.ocrQueue.processedPages)) : undefined,
              currentPage: Number.isFinite(Number(input.ocrQueue.currentPage)) ? Math.max(1, Number(input.ocrQueue.currentPage)) : undefined,
              error: input.ocrQueue.error ? String(input.ocrQueue.error).slice(0, 600) : undefined,
            } as InboxOcrQueueState)
          : undefined,
    };
  }

  normalize(input: Partial<InboxItem>): InboxItem {
    const now = new Date().toISOString();
    const text = typeof input.text === "string" ? input.text : "";
    const fallbackTitle =
      text
        .split(/\r?\n/)
        .map((v) => v.trim())
        .find(Boolean) || "Untitled capture";
    const priority = ["Low", "Mid", "High"].includes(
      String((input as any).priority),
    )
      ? ((input as any).priority as InboxItem["priority"])
      : "Mid";
    const tags = Array.isArray((input as any).tags)
      ? (input as any).tags
          .map(String)
          .map((v: string) => v.trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];
    return {
      id: input.id || `inbox_${nanoid(10)}`,
      title: input.title || fallbackTitle.slice(0, 80),
      text,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || input.createdAt || now,
      source:
        input.source === "manual" ||
        input.source === "drop" ||
        input.source === "web"
          ? input.source
          : "quick",
      status: input.status === "archived" ? "archived" : "open",
      priority,
      tags,
      pinned: Boolean((input as any).pinned),
      attachments: Array.isArray((input as any).attachments)
        ? (input as any).attachments
            .map((attachment: Partial<InboxAttachment>) =>
              this.normalizeAttachment(attachment),
            )
            .slice(0, 24)
        : [],
      ocrSource: (() => {
        const source = (input as any).ocrSource;
        if (!source || typeof source !== "object") return undefined;
        const sourceType = ["page", "journal", "database-row"].includes(String(source.sourceType))
          ? String(source.sourceType) as OcrSourceRef["sourceType"]
          : undefined;
        const attachmentId = String(source.attachmentId || "").trim();
        if (!sourceType || !attachmentId) return undefined;
        return {
          sourceType,
          attachmentId,
          pageId: source.pageId ? String(source.pageId) : undefined,
          date: source.date ? String(source.date) : undefined,
          databaseId: source.databaseId ? String(source.databaseId) : undefined,
          rowId: source.rowId ? String(source.rowId) : undefined,
          scope: source.scope === "private" ? "private" : source.scope === "shared" ? "shared" : undefined,
          sourceTitle: source.sourceTitle ? String(source.sourceTitle).slice(0, 300) : undefined,
        } satisfies OcrSourceRef;
      })(),
    };
  }

  async read(): Promise<InboxItem[]> {
    const raw = await fs.readJson(this.file()).catch(() => []);
    return Array.isArray(raw)
      ? raw
          .map((item) => this.normalize(item))
          .filter((item) => item.status === "open")
      : [];
  }

  private async write(items: InboxItem[]): Promise<void> {
    await fs.ensureDir(vaultPaths(this.deps.sharedRoot).inbox);
    await this.deps.atomicWriteJson(this.file(), items);
  }

  private queueLeaseExpired(queue: InboxOcrQueueState, now = Date.now()): boolean {
    const expires = Date.parse(String(queue.leaseExpiresAt || ""));
    return !Number.isFinite(expires) || expires <= now;
  }

  /**
   * A process that exits cannot release an OCR lease.  Do not silently restart
   * such work: mark it failed and let the user explicitly retry it. This avoids
   * duplicate OCR after an unclean shutdown on a shared folder.
   */
  private async recoverInterruptedOcrQueue(): Promise<void> {
    await this.deps.withSharedJsonMutation(this.file(), async () => {
      const items = await this.read();
      let changed = false;
      const now = Date.now();
      const next = items.map((item) => {
        let itemChanged = false;
        const attachments = (item.attachments || []).map((attachment) => {
          const queue = attachment.ocrQueue;
          if (!queue) return attachment;
          if (queue.status === "cancelling") {
            changed = itemChanged = true;
            return this.normalizeAttachment({
              ...attachment,
              ocrQueue: {
                ...queue,
                status: "cancelled",
                finishedAt: new Date().toISOString(),
                workerId: undefined,
                leaseId: undefined,
                leaseExpiresAt: undefined,
                heartbeatAt: undefined,
                error: undefined,
              },
            });
          }
          if (queue.status === "running" && this.queueLeaseExpired(queue, now)) {
            changed = itemChanged = true;
            return this.normalizeAttachment({
              ...attachment,
              ocrQueue: {
                ...queue,
                status: "failed",
                finishedAt: new Date().toISOString(),
                workerId: undefined,
                leaseId: undefined,
                leaseExpiresAt: undefined,
                heartbeatAt: undefined,
                error: "前回のOCR処理はアプリ終了または接続断により中断されました。再実行してください。",
              },
            });
          }
          return attachment;
        });
        return itemChanged ? this.normalize({ ...item, attachments }) : item;
      });
      if (changed) await this.write(next);
    }).catch(() => undefined);
  }

  async list(): Promise<InboxItem[]> {
    // Recovery needs the shared mutation lock, so do not take it on every UI poll.
    if (Date.now() >= this.nextOcrRecoveryAt) {
      this.nextOcrRecoveryAt = Date.now() + 30_000;
      await this.recoverInterruptedOcrQueue();
    }
    const items = await this.read();
    void this.pumpOcrQueue().catch((error) => {
      console.error("[OCR queue] background pump failed", error);
    });
    return items.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  async create(input: Partial<InboxItem>): Promise<InboxItem> {
    return this.deps.withSharedJsonMutation(this.file(), async () => {
      const item = this.normalize(input);
      const items = await this.read();
      items.unshift(item);
      await this.write(items);
      await this.deps.onSaved?.(item);
      return item;
    });
  }

  async update(id: string, patch: Partial<InboxItem>): Promise<InboxItem> {
    return this.deps.withSharedJsonMutation(this.file(), async () => {
      const items = await this.read();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Inbox item not found");
      const next = this.normalize({
        ...items[index],
        ...patch,
        id,
        updatedAt: new Date().toISOString(),
      });
      items[index] = next;
      await this.write(items);
      await this.deps.onSaved?.(next);
      return next;
    });
  }

  async addAttachmentFromBase64(
    id: string,
    fileName: string,
    base64: string,
    mimeType?: string,
  ): Promise<InboxItem> {
    return this.deps.withSharedJsonMutation(this.file(), async () => {
      const items = await this.read();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Inbox item not found");
      const bytes = Buffer.from(base64, "base64");
      const attachment = this.normalizeAttachment({
        fileName,
        mimeType,
        sizeBytes: bytes.length,
      });
      const dir = this.attachmentDir(id);
      await fs.ensureDir(dir);
      await fs.writeFile(path.join(dir, attachment.id), bytes);
      const next = this.normalize({
        ...items[index],
        attachments: [...(items[index].attachments || []), attachment],
        updatedAt: new Date().toISOString(),
      });
      items[index] = next;
      await this.write(items);
      await this.deps.onSaved?.(next);
      return next;
    });
  }

  /**
   * Copies an already-managed workspace attachment into the durable OCR Inbox
   * without routing the bytes through the renderer/base64 upload path.
   */
  async addAttachmentFromFile(
    id: string,
    fileName: string,
    sourcePath: string,
    mimeType?: string,
  ): Promise<InboxItem> {
    return this.deps.withSharedJsonMutation(this.file(), async () => {
      const items = await this.read();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Inbox item not found");
      if (!(await fs.pathExists(sourcePath))) {
        throw new Error("OCR対象の添付ファイルが見つかりません");
      }
      const stat = await fs.stat(sourcePath);
      const attachment = this.normalizeAttachment({
        fileName,
        mimeType,
        sizeBytes: stat.size,
      });
      const dir = this.attachmentDir(id);
      await fs.ensureDir(dir);
      await fs.copyFile(sourcePath, path.join(dir, attachment.id));
      const next = this.normalize({
        ...items[index],
        attachments: [...(items[index].attachments || []), attachment],
        updatedAt: new Date().toISOString(),
      });
      items[index] = next;
      await this.write(items);
      await this.deps.onSaved?.(next);
      return next;
    });
  }

  async getAttachmentFilePath(
    itemId: string,
    attachmentId: string,
  ): Promise<{ attachment: InboxAttachment; filePath: string }> {
    const item = (await this.read()).find(
      (candidate) => candidate.id === itemId,
    );
    if (!item) throw new Error("Inbox item not found");
    const attachment = (item.attachments || []).find(
      (candidate) => candidate.id === attachmentId,
    );
    if (!attachment) throw new Error("Inbox attachment not found");
    const filePath = path.join(this.attachmentDir(itemId), attachment.id);
    if (!(await fs.pathExists(filePath)))
      throw new Error("Inbox attachment file not found");
    return { attachment, filePath };
  }

  private isOcrImage(attachment: InboxAttachment): boolean {
    const name = attachment.fileName.toLowerCase();
    const mime = String(attachment.mimeType || "").toLowerCase();
    return (
      mime.startsWith("image/") || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(name)
    );
  }

  /**
   * Some bundled Windows builds of Poppler/Tesseract still fail on Unicode
   * source paths. External tools only receive an ASCII-named temporary copy;
   * the actual Inbox attachment remains untouched in the shared workspace.
   */
  private async createExternalToolTempDir(
    kind: "pdf" | "image",
  ): Promise<string> {
    const token = `${kind}_${nanoid(10)}`;
    const candidates: string[] = [];
    if (process.platform === "win32") {
      const drive = process.env.SystemDrive || "C:";
      candidates.push(
        path.join(
          drive,
          "Users",
          "Public",
          "Documents",
          "LocalNotionLite",
          "ocr-temp",
          token,
        ),
        path.join(drive, "Temp", "LocalNotionLite", "ocr-temp", token),
      );
    }
    candidates.push(path.join(os.tmpdir(), "local-notion-lite-ocr", token));

    let lastError: unknown;
    for (const directory of candidates) {
      try {
        await fs.ensureDir(directory);
        return directory;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `OCR用の一時フォルダを作成できませんでした: ${String((lastError as any)?.message || lastError || "unknown")}`,
    );
  }

  private async copyForExternalTool(
    sourcePath: string,
    tempDir: string,
    extension: string,
  ): Promise<string> {
    const normalizedExtension = extension.startsWith(".")
      ? extension
      : `.${extension}`;
    const targetPath = path.join(tempDir, `source${normalizedExtension}`);
    await fs.copyFile(sourcePath, targetPath);
    return targetPath;
  }

  private isPdf(attachment: InboxAttachment): boolean {
    return (
      String(attachment.mimeType || "").toLowerCase() === "application/pdf" ||
      /\.pdf$/i.test(attachment.fileName)
    );
  }

  private resourceBinary(name: string): string {
    const resourcesPath = (process as any).resourcesPath as string | undefined;
    const candidate = resourcesPath
      ? path.join(
          resourcesPath,
          "ocr",
          `${name}${process.platform === "win32" ? ".exe" : ""}`,
        )
      : "";
    return candidate && fs.existsSync(candidate) ? candidate : "";
  }

  private resolveOcrBinary(): string {
    return (
      process.env.LOCAL_NOTION_OCR_BINARY ||
      this.resourceBinary("tesseract") ||
      (process.platform === "win32" ? "tesseract.exe" : "tesseract")
    );
  }

  private resolvePopplerBinary(
    name: "pdftotext" | "pdftoppm" | "pdfinfo",
  ): string {
    const envName = `LOCAL_NOTION_${name.toUpperCase()}_BINARY`;
    return (
      process.env[envName] ||
      this.resourceBinary(name) ||
      (process.platform === "win32" ? `${name}.exe` : name)
    );
  }

  private runBinary(
    binary: string,
    args: string[],
    timeoutMs: number,
    shouldCancel?: () => Promise<boolean>,
  ): Promise<{ text: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
      let settled = false;
      let stdout = "";
      let stderr = "";
      const finish = (error?: Error, value?: { text: string; stderr: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(cancelPoll);
        if (error) reject(error);
        else resolve(value!);
      };
      const stopChild = () => {
        // kill() is best effort; the close handler is still allowed to fire.
        child.kill();
      };
      const timeout = setTimeout(() => {
        stopChild();
        finish(new Error("処理が時間切れになりました。対象ページを減らして再試行してください。"));
      }, timeoutMs);
      const cancelPoll = shouldCancel
        ? setInterval(() => {
            void shouldCancel().then((cancelled) => {
              if (!cancelled || settled) return;
              stopChild();
              finish(new OcrCancelledError());
            }).catch(() => undefined);
          }, 700)
        : undefined;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          finish(new Error(`必要なローカルツールが見つかりません: ${path.basename(binary)}。TesseractとPoppler（pdftotext / pdftoppm）を設定してください。`));
        } else {
          finish(error);
        }
      });
      child.on("close", (code) => {
        if (settled) return;
        if (code !== 0) {
          finish(new Error(stderr.trim() || `処理に失敗しました (code ${code ?? "unknown"})`));
        } else {
          finish(undefined, { text: stdout.replace(/\r\n/g, "\n").trim(), stderr: stderr.trim() });
        }
      });
    });
  }

  private formatOcrText(value: string): string {
    const source = String(value || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim());
    const output: string[] = [];
    let buffer = "";
    const flush = () => {
      if (buffer) output.push(buffer);
      buffer = "";
    };
    for (const line of source) {
      if (!line) {
        flush();
        if (output.at(-1) !== "") output.push("");
        continue;
      }
      if (
        /^---\s*\d+ページ\s*---$/.test(line) ||
        /^(?:[-*•]|\d+[.)、])\s+/.test(line)
      ) {
        flush();
        output.push(line);
        continue;
      }
      buffer = buffer
        ? `${buffer}${/[。！？.!?]$/.test(buffer) ? "\n" : " "}${line}`
        : line;
      if (/[。！？.!?]$/.test(line) || buffer.length >= 140) flush();
    }
    flush();
    return output
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private async preprocessForOcr(
    inputPath: string,
    requested: "standard" | "enhanced",
    tempDir: string,
    shouldCancel?: () => Promise<boolean>,
  ): Promise<{ path: string; note: string }> {
    if (requested !== "enhanced")
      return { path: inputPath, note: "標準：元画像をそのまま認識" };
    const outputPath = path.join(tempDir, `prepared_${nanoid(8)}.png`);
    const commands =
      process.platform === "win32"
        ? ["magick.exe", "magick"]
        : ["magick", "convert"];
    const argsFor = (command: string) =>
      command.startsWith("magick")
        ? [
            inputPath,
            "-auto-orient",
            "-colorspace",
            "Gray",
            "-contrast-stretch",
            "1%x1%",
            "-deskew",
            "40%",
            "-threshold",
            "68%",
            outputPath,
          ]
        : [
            inputPath,
            "-auto-orient",
            "-colorspace",
            "Gray",
            "-contrast-stretch",
            "1%x1%",
            "-deskew",
            "40%",
            "-threshold",
            "68%",
            outputPath,
          ];
    for (const command of commands) {
      try {
        await this.runBinary(command, argsFor(command), 120000, shouldCancel);
        if (await fs.pathExists(outputPath))
          return {
            path: outputPath,
            note: "高精度：自動傾き補正・白黒化・コントラスト調整を適用",
          };
      } catch {
        /* ImageMagick is optional; fall back safely. */
      }
    }
    return {
      path: inputPath,
      note: "高精度前処理は未適用：ImageMagickが見つからないため元画像を認識",
    };
  }

  private async runTesseract(
    inputPath: string,
    preprocessing: "standard" | "enhanced" = "standard",
    tempDir?: string,
    shouldCancel?: () => Promise<boolean>,
  ): Promise<{ text: string; stderr: string; preprocessingNote: string }> {
    const working = tempDir
      ? await this.preprocessForOcr(inputPath, preprocessing, tempDir, shouldCancel)
      : { path: inputPath, note: "標準：元画像をそのまま認識" };
    const result = await this.runBinary(
      this.resolveOcrBinary(),
      [working.path, "stdout", "-l", "jpn+eng", "--psm", "6"],
      120000,
      shouldCancel,
    );
    return {
      ...result,
      text: this.formatOcrText(result.text),
      preprocessingNote: working.note,
    };
  }

  private async pdfPageCount(sourcePath: string): Promise<number | undefined> {
    try {
      const result = await this.runBinary(
        this.resolvePopplerBinary("pdfinfo"),
        [sourcePath],
        30000,
      );
      const hit = result.text.match(/^Pages:\s*(\d+)/im);
      return hit ? Math.max(1, Number(hit[1])) : undefined;
    } catch {
      return undefined;
    }
  }

  private async inspectPdfText(
    sourcePath: string,
  ): Promise<InboxPdfTextResult> {
    const tempDir = await this.createExternalToolTempDir("pdf");
    try {
      const safePdfPath = await this.copyForExternalTool(
        sourcePath,
        tempDir,
        ".pdf",
      );
      const pageCount = await this.pdfPageCount(safePdfPath);
      try {
        const result = await this.runBinary(
          this.resolvePopplerBinary("pdftotext"),
          ["-enc", "UTF-8", safePdfPath, "-"],
          60000,
        );
        const text = result.text.trim();
        return text.replace(/\s+/g, "").length >= 40
          ? {
              status: "ready",
              text: text.slice(0, 2_000_000),
              pageCount,
              updatedAt: new Date().toISOString(),
              engine: "pdftotext",
            }
          : {
              status: "unavailable",
              text: "",
              pageCount,
              updatedAt: new Date().toISOString(),
              engine: "pdftotext",
            };
      } catch (error: any) {
        return {
          status: "failed",
          text: "",
          pageCount,
          updatedAt: new Date().toISOString(),
          engine: "pdftotext",
          error: String(error?.message || error).slice(0, 600),
        };
      }
    } finally {
      await fs.remove(tempDir).catch(() => undefined);
    }
  }

  private async isOcrCancellationRequested(id: string, attachmentId: string): Promise<boolean> {
    const item = (await this.read()).find((candidate) => candidate.id === id);
    const queue = item?.attachments?.find((candidate) => candidate.id === attachmentId)?.ocrQueue;
    return queue?.status === "cancelling" || queue?.status === "cancelled";
  }

  private async updateOcrProgress(
    id: string,
    attachmentId: string,
    leaseId: string,
    progress: Pick<InboxOcrQueueState, "totalPages" | "processedPages" | "currentPage">,
  ): Promise<void> {
    await this.deps.withSharedJsonMutation(this.file(), async () => {
      const items = await this.read();
      const itemIndex = items.findIndex((item) => item.id === id);
      if (itemIndex < 0) return;
      const attachmentIndex = (items[itemIndex].attachments || []).findIndex((attachment) => attachment.id === attachmentId);
      if (attachmentIndex < 0) return;
      const attachment = items[itemIndex].attachments![attachmentIndex];
      const queue = attachment.ocrQueue;
      if (!queue || queue.leaseId !== leaseId || !["running", "cancelling"].includes(queue.status)) return;
      const attachments = [...items[itemIndex].attachments!];
      attachments[attachmentIndex] = this.normalizeAttachment({
        ...attachment,
        ocrQueue: { ...queue, ...progress, heartbeatAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + OCR_JOB_LEASE_MS).toISOString() },
      });
      items[itemIndex] = this.normalize({ ...items[itemIndex], attachments, updatedAt: new Date().toISOString() });
      await this.write(items);
    });
  }

  private async claimNextOcrJob(): Promise<ClaimedOcrJob | undefined> {
    return this.deps.withSharedJsonMutation(this.file(), async () => {
      const items = await this.read();
      const candidate = items
        .flatMap((item) => (item.attachments || []).map((attachment) => ({ item, attachment })))
        .filter(({ attachment }) => attachment.ocrQueue?.status === "queued")
        .sort((a, b) => String(a.attachment.ocrQueue?.queuedAt).localeCompare(String(b.attachment.ocrQueue?.queuedAt)))[0];
      if (!candidate?.attachment.ocrQueue) return undefined;
      const now = Date.now();
      const claimedQueue: InboxOcrQueueState = {
        ...candidate.attachment.ocrQueue,
        status: "running",
        startedAt: new Date(now).toISOString(),
        workerId: this.ocrWorkerId,
        leaseId: nanoid(14),
        heartbeatAt: new Date(now).toISOString(),
        leaseExpiresAt: new Date(now + OCR_JOB_LEASE_MS).toISOString(),
        totalPages: undefined,
        processedPages: undefined,
        currentPage: undefined,
        error: undefined,
      };
      const itemIndex = items.findIndex((item) => item.id === candidate.item.id);
      const attachmentIndex = (items[itemIndex].attachments || []).findIndex((attachment) => attachment.id === candidate.attachment.id);
      const attachments = [...items[itemIndex].attachments!];
      attachments[attachmentIndex] = this.normalizeAttachment({ ...attachments[attachmentIndex], ocrQueue: claimedQueue });
      const next = this.normalize({ ...items[itemIndex], attachments, updatedAt: new Date().toISOString() });
      items[itemIndex] = next;
      await this.write(items);
      await this.deps.onSaved?.(next);
      return { itemId: candidate.item.id, attachmentId: candidate.attachment.id, queue: claimedQueue };
    });
  }

  private async finalizeClaimedOcrJob(
    job: ClaimedOcrJob,
    status: "completed" | "failed" | "cancelled",
    error?: string,
  ): Promise<void> {
    await this.deps.withSharedJsonMutation(this.file(), async () => {
      const items = await this.read();
      const itemIndex = items.findIndex((item) => item.id === job.itemId);
      if (itemIndex < 0) return;
      const attachmentIndex = (items[itemIndex].attachments || []).findIndex((attachment) => attachment.id === job.attachmentId);
      if (attachmentIndex < 0) return;
      const attachment = items[itemIndex].attachments![attachmentIndex];
      const current = attachment.ocrQueue;
      if (!current || current.leaseId !== job.queue.leaseId || current.workerId !== this.ocrWorkerId) return;
      const attachments = [...items[itemIndex].attachments!];
      attachments[attachmentIndex] = this.normalizeAttachment({
        ...attachment,
        ocrQueue: {
          ...current,
          status,
          finishedAt: new Date().toISOString(),
          workerId: undefined,
          leaseId: undefined,
          leaseExpiresAt: undefined,
          heartbeatAt: undefined,
          error: error ? error.slice(0, 600) : undefined,
        },
      });
      const next = this.normalize({ ...items[itemIndex], attachments, updatedAt: new Date().toISOString() });
      items[itemIndex] = next;
      await this.write(items);
      await this.deps.onSaved?.(next);
    });
  }

  private async patchAttachment(
    id: string,
    attachmentId: string,
    patch: Partial<InboxAttachment>,
  ): Promise<InboxItem> {
    return this.deps.withSharedJsonMutation(this.file(), async () => {
      const items = await this.read();
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("Inbox item not found");
      const attachmentIndex = (items[index].attachments || []).findIndex(
        (item) => item.id === attachmentId,
      );
      if (attachmentIndex < 0) throw new Error("Inbox attachment not found");
      const attachments = [...(items[index].attachments || [])];
      attachments[attachmentIndex] = this.normalizeAttachment({
        ...attachments[attachmentIndex],
        ...patch,
      });
      const next = this.normalize({
        ...items[index],
        attachments,
        updatedAt: new Date().toISOString(),
      });
      items[index] = next;
      await this.write(items);
      await this.deps.onSaved?.(next);
      return next;
    });
  }

  async enqueueOcrAttachment(
    id: string,
    attachmentId: string,
    options: {
      mode?: "inspect" | "page" | "all";
      page?: number;
      preprocessing?: "standard" | "enhanced";
    } = {},
  ): Promise<InboxItem> {
    const next = await this.deps.withSharedJsonMutation(this.file(), async () => {
      const items = await this.read();
      const itemIndex = items.findIndex((item) => item.id === id);
      if (itemIndex < 0) throw new Error("Inbox item not found");
      const attachmentIndex = (items[itemIndex].attachments || []).findIndex((attachment) => attachment.id === attachmentId);
      if (attachmentIndex < 0) throw new Error("Inbox attachment not found");
      const attachment = items[itemIndex].attachments![attachmentIndex];
      const active = attachment.ocrQueue?.status;
      if (active === "queued" || active === "running" || active === "cancelling") return items[itemIndex];
      const queue: InboxOcrQueueState = {
        status: "queued",
        mode: options.mode || "inspect",
        page: options.page,
        preprocessing: options.preprocessing === "enhanced" ? "enhanced" : "standard",
        queuedAt: new Date().toISOString(),
        attempt: Math.max(1, Number(attachment.ocrQueue?.attempt || 0) + 1),
      };
      const attachments = [...items[itemIndex].attachments!];
      attachments[attachmentIndex] = this.normalizeAttachment({ ...attachment, ocrQueue: queue });
      const updated = this.normalize({ ...items[itemIndex], attachments, updatedAt: new Date().toISOString() });
      items[itemIndex] = updated;
      await this.write(items);
      await this.deps.onSaved?.(updated);
      return updated;
    });
    void this.pumpOcrQueue().catch((error) => {
      console.error("[OCR queue] background pump failed", error);
    });
    return next;
  }

  async cancelOcrQueueAttachment(id: string, attachmentId: string): Promise<InboxItem> {
    return this.deps.withSharedJsonMutation(this.file(), async () => {
      const items = await this.read();
      const itemIndex = items.findIndex((item) => item.id === id);
      if (itemIndex < 0) throw new Error("Inbox item not found");
      const attachmentIndex = (items[itemIndex].attachments || []).findIndex((attachment) => attachment.id === attachmentId);
      if (attachmentIndex < 0) throw new Error("Inbox attachment not found");
      const attachment = items[itemIndex].attachments![attachmentIndex];
      const queue = attachment.ocrQueue;
      if (!queue) throw new Error("OCRキュー項目が見つかりません。");
      // Completed/failed work must not be overwritten by a late UI click.
      if (!["queued", "running", "cancelling"].includes(queue.status)) return items[itemIndex];
      const running = queue.status === "running" || queue.status === "cancelling";
      const attachments = [...items[itemIndex].attachments!];
      attachments[attachmentIndex] = this.normalizeAttachment({
        ...attachment,
        ocrQueue: {
          ...queue,
          status: running ? "cancelling" : "cancelled",
          finishedAt: running ? undefined : new Date().toISOString(),
          error: running ? "停止要求を受け付けました。現在の外部OCR処理を停止しています。" : undefined,
        },
      });
      const next = this.normalize({ ...items[itemIndex], attachments, updatedAt: new Date().toISOString() });
      items[itemIndex] = next;
      await this.write(items);
      await this.deps.onSaved?.(next);
      return next;
    });
  }

  async retryOcrQueueAttachment(id: string, attachmentId: string): Promise<InboxItem> {
    const item = (await this.read()).find((candidate) => candidate.id === id);
    const queue = item?.attachments?.find((candidate) => candidate.id === attachmentId)?.ocrQueue;
    return this.enqueueOcrAttachment(id, attachmentId, {
      mode: queue?.mode || "inspect",
      page: queue?.page,
      preprocessing: queue?.preprocessing || "standard",
    });
  }

  private async pumpOcrQueue(): Promise<void> {
    if (this.ocrQueuePumping) return;
    this.ocrQueuePumping = true;
    try {
      while (true) {
        const job = await this.claimNextOcrJob();
        if (!job) return;
        const heartbeat = setInterval(() => {
          void this.updateOcrProgress(job.itemId, job.attachmentId, job.queue.leaseId!, {}).catch((error) => {
            console.warn("[OCR queue] heartbeat update failed", error);
          });
        }, OCR_HEARTBEAT_MS);
        try {
          const result = await this.recognizeAttachment(job.itemId, job.attachmentId, {
            mode: job.queue.mode,
            page: job.queue.page,
            preprocessing: job.queue.preprocessing,
            leaseId: job.queue.leaseId,
          });
          const latest = result.attachments?.find((attachment) => attachment.id === job.attachmentId);
          const cancelled = latest?.ocrQueue?.status === "cancelling" || latest?.ocrQueue?.status === "cancelled";
          const failed = latest?.ocr?.status === "failed" || latest?.pdfText?.status === "failed";
          await this.finalizeClaimedOcrJob(job, cancelled ? "cancelled" : failed ? "failed" : "completed", failed ? (latest?.ocr?.error || latest?.pdfText?.error || "OCRに失敗しました。") : undefined);
        } catch (error: any) {
          await this.finalizeClaimedOcrJob(job, error instanceof OcrCancelledError ? "cancelled" : "failed", error instanceof OcrCancelledError ? undefined : String(error?.message || error));
        } finally {
          clearInterval(heartbeat);
        }
      }
    } finally {
      this.ocrQueuePumping = false;
    }
  }

  async recognizeAttachment(
    id: string,
    attachmentId: string,
    options: {
      mode?: "inspect" | "page" | "all";
      page?: number;
      preprocessing?: "standard" | "enhanced";
      leaseId?: string;
    } = {},
  ): Promise<InboxItem> {
    const item = (await this.read()).find((candidate) => candidate.id === id);
    if (!item) throw new Error("Inbox item not found");
    const attachment = (item.attachments || []).find(
      (candidate) => candidate.id === attachmentId,
    );
    if (!attachment) throw new Error("Inbox attachment not found");
    const sourcePath = path.join(this.attachmentDir(id), attachment.id);
    if (!(await fs.pathExists(sourcePath)))
      throw new Error("OCR対象ファイルが見つかりません。");
    const shouldCancel = () => this.isOcrCancellationRequested(id, attachmentId);
    if (await shouldCancel()) throw new OcrCancelledError();
    const preprocessing =
      options.preprocessing === "enhanced" ? "enhanced" : "standard";
    if (this.isOcrImage(attachment)) {
      if (attachment.sizeBytes > 15 * 1024 * 1024)
        throw new Error("OCR対象は15MB以下の画像にしてください。");
      const tempDir = await this.createExternalToolTempDir("image");
      try {
        const safeImagePath = await this.copyForExternalTool(
          sourcePath,
          tempDir,
          path.extname(attachment.fileName) || ".png",
        );
        const result = await this.runTesseract(
          safeImagePath,
          preprocessing,
          tempDir,
          shouldCancel,
        );
        return this.patchAttachment(id, attachmentId, {
          ocr: {
            status: "ready",
            text: result.text,
            language: "jpn+eng",
            updatedAt: new Date().toISOString(),
            engine: "Tesseract",
            mode: "image",
            preprocessing,
            preprocessingNote: result.preprocessingNote,
            handwritingWarning: true,
          },
        });
      } catch (error: any) {
        if (error instanceof OcrCancelledError) throw error;
        return this.patchAttachment(id, attachmentId, {
          ocr: {
            status: "failed",
            text: "",
            language: "jpn+eng",
            updatedAt: new Date().toISOString(),
            engine: "Tesseract",
            mode: "image",
            preprocessing,
            handwritingWarning: true,
            error: String(error?.message || error).slice(0, 600),
          },
        });
      } finally {
        await fs.remove(tempDir).catch(() => undefined);
      }
    }
    if (!this.isPdf(attachment))
      throw new Error("OCRは画像またはPDFで利用できます。");
    const mode = options.mode || "inspect";
    const pdfText =
      attachment.pdfText?.status === "ready"
        ? attachment.pdfText
        : await this.inspectPdfText(sourcePath);
    if (mode === "inspect" || pdfText.status === "ready")
      return this.patchAttachment(id, attachmentId, { pdfText });
    const page = Math.max(
      1,
      Math.min(Number(options.page || 1), pdfText.pageCount || 5000),
    );
    const tempDir = await this.createExternalToolTempDir("pdf");
    try {
      const safePdfPath = await this.copyForExternalTool(
        sourcePath,
        tempDir,
        ".pdf",
      );
      const base = path.join(tempDir, "page");
      const renderArgs = ["-r", "200", "-png"];
      if (mode === "page")
        renderArgs.push("-f", String(page), "-l", String(page));
      renderArgs.push(safePdfPath, base);
      await this.runBinary(
        this.resolvePopplerBinary("pdftoppm"),
        renderArgs,
        mode === "all" ? 15 * 60_000 : 120000,
        shouldCancel,
      );
      const images = (await fs.readdir(tempDir))
        .filter((name) => /^page-\d+\.png$/i.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (!images.length)
        throw new Error("PDFページを画像化できませんでした。");
      if (options.leaseId) {
        await this.updateOcrProgress(id, attachmentId, options.leaseId, {
          totalPages: images.length,
          processedPages: 0,
          currentPage: mode === "page" ? page : 1,
        });
      }
      const parts: string[] = [];
      let preprocessingNote = "";
      for (let i = 0; i < images.length; i += 1) {
        if (await shouldCancel()) throw new OcrCancelledError();
        const result = await this.runTesseract(
          path.join(tempDir, images[i]),
          preprocessing,
          tempDir,
          shouldCancel,
        );
        preprocessingNote = result.preprocessingNote;
        const label = mode === "page" ? page : i + 1;
        parts.push(`--- ${label}ページ ---\n${result.text}`.trim());
        if (options.leaseId) {
          await this.updateOcrProgress(id, attachmentId, options.leaseId, {
            totalPages: images.length,
            processedPages: i + 1,
            currentPage: mode === "page" ? page : i + 1,
          });
        }
      }
      return this.patchAttachment(id, attachmentId, {
        pdfText,
        ocr: {
          status: "ready",
          text: this.formatOcrText(parts.join("\n\n")),
          language: "jpn+eng",
          updatedAt: new Date().toISOString(),
          engine: "Poppler + Tesseract",
          mode: mode === "all" ? "pdf-all" : "pdf-page",
          page: mode === "page" ? page : undefined,
          pageCount: pdfText.pageCount,
          preprocessing,
          preprocessingNote,
          handwritingWarning: true,
        },
      });
    } catch (error: any) {
      if (error instanceof OcrCancelledError) throw error;
      return this.patchAttachment(id, attachmentId, {
        pdfText,
        ocr: {
          status: "failed",
          text: "",
          language: "jpn+eng",
          updatedAt: new Date().toISOString(),
          engine: "Poppler + Tesseract",
          mode: mode === "all" ? "pdf-all" : "pdf-page",
          page: mode === "page" ? page : undefined,
          pageCount: pdfText.pageCount,
          preprocessing,
          handwritingWarning: true,
          error: String(error?.message || error).slice(0, 600),
        },
      });
    } finally {
      await fs.remove(tempDir).catch(() => undefined);
    }
  }

  async remove(id: string): Promise<{ ok: true; id: string }> {
    return this.deps.withSharedJsonMutation(this.file(), async () => {
      const next = (await this.read()).filter((item) => item.id !== id);
      await this.write(next);
      await this.deps.onDeleted?.(id);
      return { ok: true, id };
    });
  }
}
