import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, SyntheticEvent } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { Menu } from "@mantine/core";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import {
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  blockTypeSelectItems,
  createReactBlockSpec,
  getDefaultReactSlashMenuItems,
  useBlockNoteEditor,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteSchema, combineByGroup, defaultProps } from "@blocknote/core";
import {
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core/extensions";
import * as locales from "@blocknote/core/locales";
import type { PartialBlock } from "@blocknote/core";
import type { ApiClient } from "../lib/api";
import {
  getMultiColumnSlashMenuItems,
  multiColumnDropCursor,
  locales as multiColumnLocales,
  withMultiColumn,
} from "@blocknote/xl-multi-column";
import type {
  DatabaseRowLinkTarget,
  PageWithLock,
  WorkspaceDatabase,
} from "../../../shared/types";
import { normalizeExternalHttpUrl } from "../../../shared/externalUrlPolicy";

type AlertType = "warning" | "error" | "info" | "success";

const alertTypes: Array<{
  title: string;
  value: AlertType;
  icon: string;
  className: string;
}> = [
  { title: "Warning", value: "warning", icon: "⚠️", className: "warning" },
  { title: "Error", value: "error", icon: "⛔", className: "error" },
  { title: "Info", value: "info", icon: "ℹ️", className: "info" },
  { title: "Success", value: "success", icon: "✅", className: "success" },
];

const AlertToolbarIcon = () => <span aria-hidden="true">⚠️</span>;

const createAlertBlock = createReactBlockSpec(
  {
    type: "alert",
    propSchema: {
      textAlignment: defaultProps.textAlignment,
      textColor: defaultProps.textColor,
      type: {
        default: "warning",
        values: ["warning", "error", "info", "success"],
      },
    },
    content: "inline",
  },
  {
    render: (props) => {
      const currentType = (props.block.props.type || "warning") as AlertType;
      const alertType =
        alertTypes.find((type) => type.value === currentType) || alertTypes[0];
      return (
        <div className="bn-alert-block" data-alert-type={alertType.value}>
          <Menu
            withinPortal={false}
            shadow="md"
            radius="md"
            position="bottom-start"
          >
            <Menu.Target>
              <button
                type="button"
                className="bn-alert-icon-button"
                contentEditable={false}
                title="Alert type"
                aria-label="Alert type"
              >
                <span>{alertType.icon}</span>
              </button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Alert type</Menu.Label>
              {alertTypes.map((type) => (
                <Menu.Item
                  key={type.value}
                  leftSection={<span>{type.icon}</span>}
                  onClick={() =>
                    props.editor.updateBlock(props.block, {
                      type: "alert",
                      props: { type: type.value },
                    })
                  }
                >
                  {type.title}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          <div className="bn-alert-content" ref={props.contentRef} />
        </div>
      );
    },
  },
);

function externalLinkCardLabel(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/^www\./i, "") || rawUrl;
  } catch {
    return rawUrl;
  }
}

const createExternalLinkCardBlock = createReactBlockSpec(
  {
    type: "externalLinkCard",
    propSchema: {
      url: { default: "" },
      title: { default: "" },
      description: { default: "" },
      siteName: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const blockProps = props.block.props as Record<string, string>;
      const url = String(blockProps.url || "");
      const normalizedUrl = normalizeExternalHttpUrl(url);
      const title = String(blockProps.title || "").trim();
      const description = String(blockProps.description || "").trim();
      const siteName = String(blockProps.siteName || "").trim();
      const rawEditable = (props.editor as any).isEditable;
      const editable = typeof rawEditable === "function" ? Boolean(rawEditable()) : rawEditable !== false;
      const update = (patch: Record<string, string>) => {
        (props.editor as any).updateBlock(props.block, {
          type: "externalLinkCard",
          props: { ...blockProps, ...patch },
        });
      };
      const open = (event: ReactMouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (normalizedUrl) void window.localNotion.openExternalHttpUrl(normalizedUrl);
      };
      const stopEditorEvent = (event: SyntheticEvent) => event.stopPropagation();

      return (
        <div
          className={`external-link-card${normalizedUrl ? " is-ready" : " is-empty"}`}
          contentEditable={false}
          onMouseDown={stopEditorEvent}
        >
          <div className="external-link-card-mark" aria-hidden="true">↗</div>
          <div className="external-link-card-main">
            {editable ? (
              <>
                <input
                  className="external-link-card-url"
                  defaultValue={url}
                  placeholder="https://example.com"
                  aria-label="外部リンクURL"
                  onMouseDown={stopEditorEvent}
                  onKeyDown={stopEditorEvent}
                  onBlur={(event) => {
                    const nextUrl = event.currentTarget.value.trim();
                    const nextTitle = title || externalLinkCardLabel(nextUrl);
                    const nextSiteName = siteName || externalLinkCardLabel(nextUrl);
                    update({ url: nextUrl, title: nextTitle, siteName: nextSiteName });
                  }}
                />
                <input
                  className="external-link-card-title"
                  defaultValue={title}
                  placeholder="カードのタイトル（任意）"
                  aria-label="外部リンクカードのタイトル"
                  onMouseDown={stopEditorEvent}
                  onKeyDown={stopEditorEvent}
                  onBlur={(event) => update({ title: event.currentTarget.value.trim() })}
                />
                <textarea
                  className="external-link-card-description"
                  defaultValue={description}
                  placeholder="説明（任意）"
                  aria-label="外部リンクカードの説明"
                  rows={2}
                  onMouseDown={stopEditorEvent}
                  onKeyDown={stopEditorEvent}
                  onBlur={(event) => update({ description: event.currentTarget.value.trim() })}
                />
              </>
            ) : (
              <button
                type="button"
                className="external-link-card-open"
                onClick={open}
                disabled={!normalizedUrl}
                title={normalizedUrl || "有効な http:// または https:// URL を設定してください"}
              >
                <strong>{title || externalLinkCardLabel(url) || "外部リンク"}</strong>
                {description && <span>{description}</span>}
              </button>
            )}
            <div className="external-link-card-footer">
              <span>{siteName || externalLinkCardLabel(url) || "外部サイト"}</span>
              {normalizedUrl && <code>{normalizedUrl}</code>}
            </div>
          </div>
          {editable && (
            <button
              type="button"
              className="external-link-card-open-button"
              onClick={open}
              disabled={!normalizedUrl}
              title={normalizedUrl ? "既定のブラウザで開く" : "http:// または https:// で始まるURLを入力してください"}
            >
              開く ↗
            </button>
          )}
        </div>
      );
    },
  },
);

const alertSchemaBase = BlockNoteSchema.create().extend({
  blockSpecs: {
    alert: createAlertBlock(),
    externalLinkCard: createExternalLinkCardBlock(),
  },
});

function insertExternalLinkCardItem(editor: any) {
  return {
    title: "外部リンクカード",
    subtext: "http(s) URLを見やすいカードとして追加し、既定のブラウザで開きます",
    aliases: ["link card", "url card", "external", "リンクカード", "URLカード", "外部リンク"],
    group: "リンク",
    icon: <span>↗</span>,
    onItemClick: () =>
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "externalLinkCard" as any,
        // Schema defaults initialize the card fields. Passing literal strings here
        // makes BlockNote's inferred custom-block props narrow to `undefined`.
        props: {} as any,
      }),
  };
}

function insertAlertItem(editor: any) {
  return {
    title: "Alert",
    subtext: "注意・情報・成功・エラーを目立たせるブロック",
    aliases: [
      "alert",
      "warning",
      "error",
      "info",
      "success",
      "注意",
      "警告",
      "情報",
    ],
    group: "Basic blocks",
    icon: <span>⚠️</span>,
    onItemClick: () =>
      insertOrUpdateBlockForSlashMenu(editor, { type: "alert" as any }),
  };
}

function CustomFormattingToolbar() {
  const editor = useBlockNoteEditor();
  return (
    <FormattingToolbar
      blockTypeSelectItems={[
        ...blockTypeSelectItems((editor as any).dictionary),
        {
          name: "Alert",
          type: "alert" as any,
          icon: AlertToolbarIcon as any,
        } as any,
      ]}
    />
  );
}

export type BlockNoteDoc = PartialBlock[];

type Props = {
  pageId: string;
  initialContent: BlockNoteDoc;
  editing: boolean;
  pages: PageWithLock[];
  databases: WorkspaceDatabase[];
  databaseRowLinks?: DatabaseRowLinkTarget[];
  onChange: (content: BlockNoteDoc) => void;
  onCreateChildPage?: () => Promise<PageWithLock | null>;
  onOpenPage?: (id: string) => void;
  onPreviewPage?: (id: string) => void;
  onOpenDatabase?: (databaseId: string) => void;
  onOpenDatabaseRow?: (databaseId: string, rowId: string) => void;
  onUploadFile?: (file: File) => Promise<string>;
  previewMode?: boolean;
  /**
   * Keep the page shell responsive by mounting the Tiptap/BlockNote runtime
   * after the first paint. A lightweight text preview is shown meanwhile.
   */
  deferEditorMount?: boolean;
  /** Existing Local Notion AI client. When omitted, editor AI is hidden. */
  aiClient?: ApiClient | null;
  aiPageTitle?: string;
  aiTagHints?: string[];
  /** Current local API origin. Stored attachment URLs are rebound on every launch because the local server uses a dynamic port. */
  attachmentApiBaseUrl?: string;
};

function safeTextStyles(styles: any): Record<string, any> {
  if (!styles || typeof styles !== "object") return {};
  const allowed = [
    "bold",
    "italic",
    "underline",
    "strike",
    "code",
    "textColor",
    "backgroundColor",
  ];
  const next: Record<string, any> = {};
  for (const key of allowed) {
    if (styles[key] !== undefined) next[key] = styles[key];
  }
  return next;
}

function localPageIdFromHref(href: string): string {
  if (!href) return "";

  const hashIndex = href.indexOf("#local-page=");
  if (hashIndex >= 0) {
    const rawWithTail = href.slice(hashIndex + "#local-page=".length);
    const raw = rawWithTail.split(/[&?#]/)[0];
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  const legacyIndex = href.indexOf("local-page://");
  if (legacyIndex >= 0) {
    const rawWithTail = href.slice(legacyIndex + "local-page://".length);
    const raw = rawWithTail.split(/[?#]/)[0];
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return "";
}

function localDatabaseRowFromHref(
  href: string,
): { databaseId: string; rowId: string } | null {
  if (!href) return null;

  // Preferred v273+ format. Hash links are safer inside Electron/BlockNote than
  // custom protocols because they are preserved as normal in-document anchors.
  // Supported forms:
  //   #local-dbrow=<databaseId>&row=<rowId>
  //   #local-dbrow=<databaseId>:<rowId>
  //   #local-dbrow=target=<databaseId>&row=<rowId>  (defensive)
  const hashIndex = href.indexOf("#local-dbrow=");
  if (hashIndex >= 0) {
    const rawWithTail = href.slice(hashIndex + "#local-dbrow=".length);
    const raw = rawWithTail.split("#")[0];

    const rowMatch = raw.match(/^(.*?)&row=([^&]+)/);
    if (rowMatch?.[1] && rowMatch?.[2]) {
      const databaseIdRaw = rowMatch[1].replace(/^target=/, "");
      const rowIdRaw = rowMatch[2];
      try {
        return {
          databaseId: decodeURIComponent(databaseIdRaw),
          rowId: decodeURIComponent(rowIdRaw),
        };
      } catch {
        return { databaseId: databaseIdRaw, rowId: rowIdRaw };
      }
    }

    const params = new URLSearchParams(raw.includes("=") ? raw : `target=${raw}`);
    const target = params.get("target") || params.get("databaseId") || "";
    const rowParam = params.get("row") || params.get("rowId") || "";
    if (target && rowParam) {
      try {
        return {
          databaseId: decodeURIComponent(target),
          rowId: decodeURIComponent(rowParam),
        };
      } catch {
        return { databaseId: target, rowId: rowParam };
      }
    }

    const colonTarget = target || raw;
    if (colonTarget.includes(":")) {
      const [databaseIdRaw, rowIdRaw] = colonTarget.split(":");
      if (databaseIdRaw && rowIdRaw) {
        try {
          return {
            databaseId: decodeURIComponent(databaseIdRaw),
            rowId: decodeURIComponent(rowIdRaw),
          };
        } catch {
          return { databaseId: databaseIdRaw, rowId: rowIdRaw };
        }
      }
    }
  }

  const legacyIndex = href.indexOf("local-dbrow://");
  if (legacyIndex >= 0) {
    const rawWithTail = href.slice(legacyIndex + "local-dbrow://".length);
    const [databaseIdRaw, rowIdRaw] = rawWithTail.split(/[?#]/)[0].split("/");
    if (databaseIdRaw && rowIdRaw) {
      try {
        return {
          databaseId: decodeURIComponent(databaseIdRaw),
          rowId: decodeURIComponent(rowIdRaw),
        };
      } catch {
        return { databaseId: databaseIdRaw, rowId: rowIdRaw };
      }
    }
  }
  const tokenIndex = href.indexOf("dbrow:");
  if (tokenIndex >= 0) {
    const rawWithTail = href.slice(tokenIndex + "dbrow:".length);
    const [databaseIdRaw, rowIdRaw] = rawWithTail.split(/[?#]/)[0].split(":");
    if (databaseIdRaw && rowIdRaw)
      return { databaseId: databaseIdRaw, rowId: rowIdRaw };
  }
  return null;
}

function localDatabaseIdFromHref(href: string): string {
  if (!href) return "";

  const hashIndex = href.indexOf("#local-database=");
  if (hashIndex >= 0) {
    const rawWithTail = href.slice(hashIndex + "#local-database=".length);
    const raw = rawWithTail.split(/[&?#]/)[0];
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  const legacyIndex = href.indexOf("local-database://");
  if (legacyIndex >= 0) {
    const rawWithTail = href.slice(legacyIndex + "local-database://".length);
    const raw = rawWithTail.split(/[?#]/)[0];
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  const tokenIndex = href.indexOf("database:");
  if (tokenIndex >= 0) {
    const rawWithTail = href.slice(tokenIndex + "database:".length);
    const raw = rawWithTail.split(/[?#]/)[0];
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return "";
}

function findLocalPageIdFromEventTarget(target: EventTarget | null): string {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return "";

  const anchor = element.closest("a") as HTMLAnchorElement | null;
  const href = anchor?.getAttribute("href") || anchor?.href || "";
  const fromHref = localPageIdFromHref(href);
  if (fromHref) return fromHref;

  const localLinkElement = element.closest(
    "[data-local-page-id]",
  ) as HTMLElement | null;
  return localLinkElement?.dataset.localPageId || "";
}

function textFromInlineContent(
  content: any,
  preserveLocalLinks = false,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "link") {
        const text = textFromInlineContent(part.content);
        const href =
          typeof part.href === "string"
            ? part.href
            : typeof part.props?.href === "string"
              ? part.props.href
              : typeof part.props?.url === "string"
                ? part.props.url
                : "";
        const pageId = localPageIdFromHref(href);
        if (preserveLocalLinks && pageId) return `@[[${text}|${pageId}]]`;
        const dbrow = localDatabaseRowFromHref(href);
        if (preserveLocalLinks && dbrow)
          return `[[dbrow:${dbrow.databaseId}:${dbrow.rowId}|${stripDatabaseRowIconPrefix(text)}]]`;
        const databaseId = localDatabaseIdFromHref(href);
        if (preserveLocalLinks && databaseId)
          return `[[database:${databaseId}|${stripDatabaseIconPrefix(text)}]]`;
        return text;
      }
      if (part && typeof part.text === "string") {
        // v33 used styles.link, but BlockNote does not include a link style in the default schema.
        // Keep reading it for backward compatibility, but never write it back as a style.
        const legacyLink = part.styles?.link;
        const url =
          typeof legacyLink === "string"
            ? legacyLink
            : typeof legacyLink?.url === "string"
              ? legacyLink.url
              : "";
        const pageId = localPageIdFromHref(url);
        if (preserveLocalLinks && pageId) return `@[[${part.text}|${pageId}]]`;
        return part.text;
      }
      return "";
    })
    .join("");
}

function stripPageIconPrefix(text: string): string {
  // Page links/cards use the page icon outside the title. Prevent title text from
  // accumulating icons like "📄 📄 Title" when link titles are resynced.
  return String(text || "")
    .replace(/^(?:📄\s*)+/u, "")
    .trimStart();
}

function stripDatabaseIconPrefix(text: string): string {
  return String(text || "")
    .replace(/^(?:🗃️\s*)+/u, "")
    .trimStart();
}

function stripDatabaseRowIconPrefix(text: string): string {
  return String(text || "")
    .replace(/^(?:🧾\s*)+/u, "")
    .trimStart();
}

function stripLocalResourceIconPrefix(text: string): string {
  return stripDatabaseRowIconPrefix(stripDatabaseIconPrefix(stripPageIconPrefix(text)));
}

function stripTrailingLocalResourceIcons(parts: any[]): any[] {
  const next = [...parts];
  while (next.length > 0) {
    const last = next[next.length - 1];
    if (!last || last.type !== "text" || typeof last.text !== "string") break;
    const stripped = last.text.replace(/(?:[📄🗃️🧾]\s*)+$/u, "");
    if (stripped === last.text) break;
    if (stripped) {
      next[next.length - 1] = { ...last, text: stripped };
      break;
    }
    next.pop();
  }
  return next;
}

function stripTrailingPageIcons(parts: any[]): any[] {
  return stripTrailingLocalResourceIcons(parts);
}

function pageLinkInlineContent(title: string, pageId: string): any[] {
  const cleanTitle = stripPageIconPrefix(title);
  return [
    { type: "text", text: "📄 ", styles: {} },
    {
      type: "link",
      href: `#local-page=${encodeURIComponent(pageId)}`,
      content: [{ type: "text", text: cleanTitle || "Untitled", styles: {} }],
    },
    { type: "text", text: " ", styles: {} },
  ];
}

function currentPageTitle(
  pages: PageWithLock[],
  pageId: string,
  fallback: string,
): string {
  return stripPageIconPrefix(
    pages.find((page) => page.id === pageId)?.title || fallback || "Untitled",
  );
}

function currentDatabaseRowTitle(
  targets: DatabaseRowLinkTarget[],
  databaseId: string,
  rowId: string,
  fallback: string,
): string {
  const target = targets.find(
    (item) => item.databaseId === databaseId && item.rowId === rowId,
  );
  return stripDatabaseRowIconPrefix(
    target
      ? `${stripDatabaseIconPrefix(target.databaseTitle)} / ${stripDatabaseRowIconPrefix(target.rowTitle)}`
      : fallback || "DB行",
  );
}

function currentDatabaseTitle(
  databases: WorkspaceDatabase[],
  databaseId: string,
  fallback: string,
): string {
  return stripDatabaseIconPrefix(
    databases.find((item) => item.id === databaseId)?.title ||
      fallback ||
      "データベース",
  );
}

function syncInlineResourceTitles(
  content: any,
  pages: PageWithLock[],
  databases: WorkspaceDatabase[],
  databaseRowLinks: DatabaseRowLinkTarget[] = [],
): any[] {
  const normalized = normalizeInlineContentForBlockNote(content);
  let next: any[] = [];

  for (const part of normalized) {
    if (part?.type === "link") {
      const href = part.href || "";
      const pageId = localPageIdFromHref(href);
      if (pageId) {
        const fallback = stripPageIconPrefix(
          textFromInlineContent(part.content),
        );
        next = stripTrailingPageIcons(next);
        next.push(
          ...pageLinkInlineContent(
            currentPageTitle(pages, pageId, fallback),
            pageId,
          ),
        );
        continue;
      }

      const dbrow = localDatabaseRowFromHref(href);
      if (dbrow) {
        const fallback = stripDatabaseRowIconPrefix(textFromInlineContent(part.content));
        next = stripTrailingLocalResourceIcons(next);
        next.push(
          ...databaseRowLinkInlineContent(
            currentDatabaseRowTitle(
              databaseRowLinks,
              dbrow.databaseId,
              dbrow.rowId,
              fallback,
            ),
            dbrow.databaseId,
            dbrow.rowId,
          ),
        );
        continue;
      }

      const databaseId = localDatabaseIdFromHref(href);
      if (databaseId) {
        const fallback = stripDatabaseIconPrefix(textFromInlineContent(part.content));
        next = stripTrailingLocalResourceIcons(next);
        next.push(
          ...databaseLinkInlineContent(
            currentDatabaseTitle(databases, databaseId, fallback),
            databaseId,
          ),
        );
        continue;
      }
    }
    next.push(part);
  }

  return next;
}

function syncBlockResourceTitles(
  block: any,
  pages: PageWithLock[],
  databases: WorkspaceDatabase[],
  databaseRowLinks: DatabaseRowLinkTarget[] = [],
): PartialBlock {
  const next: any = { ...normalizeBlockForBlockNote(block) };
  if (Array.isArray(next.content))
    next.content = syncInlineResourceTitles(
      next.content,
      pages,
      databases,
      databaseRowLinks,
    );
  if (Array.isArray(next.children))
    next.children = next.children.map((child: any) =>
      syncBlockResourceTitles(child, pages, databases, databaseRowLinks),
    );
  return next as PartialBlock;
}

function syncDocResourceTitles(
  blocks: BlockNoteDoc,
  pages: PageWithLock[],
  databases: WorkspaceDatabase[],
  databaseRowLinks: DatabaseRowLinkTarget[] = [],
): BlockNoteDoc {
  return (
    blocks && blocks.length > 0
      ? blocks
      : [{ type: "paragraph", content: [] } as PartialBlock]
  ).map((block: any) =>
    syncBlockResourceTitles(block, pages, databases, databaseRowLinks),
  );
}

function normalizeInlineContentForBlockNote(content: any): any[] {
  if (!content) return [];
  if (typeof content === "string")
    return textToInlineContentWithLocalLinks(content);
  if (!Array.isArray(content)) return [];

  const next: any[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      next.push(...textToInlineContentWithLocalLinks(part));
      continue;
    }

    if (part?.type === "link") {
      const href = typeof part.href === "string" ? part.href : "";
      const linkContent = normalizeInlineContentForBlockNote(part.content)
        .filter((item: any) => item?.type === "text")
        .map((item: any) => ({
          type: "text",
          text: item.text ?? "",
          styles: safeTextStyles(item.styles),
        }));
      if (href && linkContent.length)
        next.push({ type: "link", href, content: linkContent });
      else next.push(...linkContent);
      continue;
    }

    if (part && typeof part.text === "string") {
      if (/@\s*@?\[\[|@\[\[|\[\[(?:dbrow|database):/.test(part.text)) {
        next.push(...textToInlineContentWithLocalLinks(part.text));
        continue;
      }
      const legacyLink = part.styles?.link;
      const url =
        typeof legacyLink === "string"
          ? legacyLink
          : typeof legacyLink?.url === "string"
            ? legacyLink.url
            : "";
      const pageId = localPageIdFromHref(url);
      if (pageId) {
        next.push(...pageLinkInlineContent(part.text, pageId));
        continue;
      }
      const dbrow = localDatabaseRowFromHref(url);
      if (dbrow) {
        next.push(
          ...databaseRowLinkInlineContent(
            stripDatabaseRowIconPrefix(part.text),
            dbrow.databaseId,
            dbrow.rowId,
          ),
        );
        continue;
      }
      const databaseId = localDatabaseIdFromHref(url);
      if (databaseId) {
        next.push(
          ...databaseLinkInlineContent(
            stripDatabaseIconPrefix(part.text),
            databaseId,
          ),
        );
        continue;
      }
      next.push({
        type: "text",
        text: part.text,
        styles: safeTextStyles(part.styles),
      });
    }
  }
  return next;
}

function docToPlainText(blocks: BlockNoteDoc): string {
  return (blocks ?? [])
    .map((block: any) => textFromInlineContent(block.content))
    .join("\n");
}

function detectMentionQuery(blocks: BlockNoteDoc): string | null {
  const text = docToPlainText(blocks);
  const match = text.match(/(?:^|\s)@([^@\n\[\]\|{}]{0,40})$/u);
  return match ? match[1].trim() : null;
}

function detectDatabaseQuery(blocks: BlockNoteDoc): string | null {
  const text = docToPlainText(blocks);
  const match = text.match(/(?:^|\s)\/(?:database|db)\s*([^\n]{0,40})$/iu);
  return match ? match[1].trim() : null;
}

export function blockNoteToMarkdown(blocks: BlockNoteDoc): string {
  return (blocks ?? [])
    .map((block: any) => {
      const text = textFromInlineContent(block.content, true);
      switch (block.type) {
        case "heading": {
          const level = Math.min(
            Math.max(Number(block.props?.level ?? 1), 1),
            3,
          );
          return `${"#".repeat(level)} ${text}`;
        }
        case "bulletListItem":
          return `- ${text}`;
        case "numberedListItem":
          return `1. ${text}`;
        case "checkListItem":
          return `- [${block.props?.checked ? "x" : " "}] ${text}`;
        case "quote":
          return `> ${text}`;
        case "codeBlock":
          return `\`\`\`\n${text}\n\`\`\``;
        default:
          return text;
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

export function localBlocksToBlockNote(
  blocks: Array<{ type: string; text: string; checked?: boolean }>,
): BlockNoteDoc {
  const converted = blocks.map((block) => {
    const content = block.text
      ? [{ type: "text", text: block.text, styles: {} }]
      : [];
    if (block.type === "heading1")
      return { type: "heading", props: { level: 1 }, content } as PartialBlock;
    if (block.type === "heading2")
      return { type: "heading", props: { level: 2 }, content } as PartialBlock;
    if (block.type === "bullet")
      return { type: "bulletListItem", content } as PartialBlock;
    if (block.type === "todo")
      return {
        type: "checkListItem",
        props: { checked: Boolean(block.checked) },
        content,
      } as PartialBlock;
    if (block.type === "quote")
      return { type: "quote", content } as PartialBlock;
    if (block.type === "code")
      return { type: "codeBlock", content } as PartialBlock;
    return { type: "paragraph", content } as PartialBlock;
  });
  return converted.length > 0
    ? converted
    : [{ type: "paragraph", content: [] } as PartialBlock];
}

export function blockNoteToLocalBlocks(blocks: BlockNoteDoc) {
  return (blocks ?? []).map((block: any) => {
    const text = textFromInlineContent(block.content);
    if (block.type === "heading")
      return {
        id: crypto.randomUUID(),
        type: Number(block.props?.level ?? 1) === 1 ? "heading1" : "heading2",
        text,
      };
    if (block.type === "bulletListItem")
      return { id: crypto.randomUUID(), type: "bullet", text };
    if (block.type === "checkListItem")
      return {
        id: crypto.randomUUID(),
        type: "todo",
        text,
        checked: Boolean(block.props?.checked),
      };
    if (block.type === "quote")
      return { id: crypto.randomUUID(), type: "quote", text };
    if (block.type === "codeBlock")
      return { id: crypto.randomUUID(), type: "code", text };
    return { id: crypto.randomUUID(), type: "paragraph", text };
  });
}

function blockWithText(text: string): PartialBlock {
  return {
    type: "paragraph",
    content: [{ type: "text", text, styles: {} }],
  } as PartialBlock;
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLikelyValidTableContent(content: any): boolean {
  // BlockNote table content is an object-shaped payload, not ordinary inline content.
  // Older broken builds could save `content: []`, which TipTap rejects as
  // "Invalid content for node table: <>" during initialContent creation.
  if (!isPlainObject(content)) return false;
  if (Array.isArray(content.rows) && content.rows.length > 0) return true;
  if (Array.isArray(content.columnWidths) && content.columnWidths.length > 0)
    return true;
  if (content.type === "tableContent") return true;
  return Object.keys(content).length > 0;
}

function fallbackTextForBrokenTable(block: any): string {
  const text = textFromInlineContent(block?.content);
  if (text.trim()) return text;
  return "表（古い保存形式のため安全な段落に変換されました）";
}

function databaseRowLinkInlineContent(
  title: string,
  databaseId: string,
  rowId: string,
): any[] {
  return [
    { type: "text", text: "🧾 ", styles: {} },
    {
      type: "link",
      href: `#local-dbrow=${encodeURIComponent(databaseId)}&row=${encodeURIComponent(rowId)}`,
      content: [
        {
          type: "text",
          text: stripDatabaseRowIconPrefix(title || "DB行"),
          styles: {},
        },
      ],
    },
    { type: "text", text: " ", styles: {} },
  ];
}

function databaseLinkInlineContent(title: string, databaseId: string): any[] {
  return [
    { type: "text", text: "🗃️ ", styles: {} },
    {
      type: "link",
      href: `#local-database=${encodeURIComponent(databaseId)}`,
      content: [
        {
          type: "text",
          text: stripDatabaseIconPrefix(title || "データベース"),
          styles: {},
        },
      ],
    },
    { type: "text", text: " ", styles: {} },
  ];
}

function textToInlineContentWithLocalLinks(text: string): any[] {
  const parts: any[] = [];
  // Handles page links and DB-row links saved in markdown fallback forms.
  // Page:  @[[Title|page_id]]
  // DB row: [[dbrow:database_id:row_id|Title]]
  const pattern =
    /(?:@\s*)?@\[\[([^|\]]+)\|([^\]]+)\]\]|\[\[dbrow:([^:\]\|]+):([^\]\|]+)\|([^\]]+)\]\]|\[\[database:([^\]\|]+)\|([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) parts.push({ type: "text", text: before, styles: {} });

    if (match[1] && match[2]) {
      parts.push(...pageLinkInlineContent(match[1], match[2]));
    } else if (match[3] && match[4]) {
      parts.push(
        ...databaseRowLinkInlineContent(match[5] || "DB行", match[3], match[4]),
      );
    } else if (match[6] && match[7]) {
      parts.push(
        ...databaseLinkInlineContent(match[7] || "データベース", match[6]),
      );
    }

    lastIndex = match.index + match[0].length;
  }

  const rest = text.slice(lastIndex);
  if (rest) parts.push({ type: "text", text: rest, styles: {} });
  return parts.length ? parts : [{ type: "text", text, styles: {} }];
}

function normalizeBlockForBlockNote(block: any): PartialBlock {
  const type = typeof block?.type === "string" ? block.type : "paragraph";
  const props =
    block?.props && typeof block.props === "object" ? block.props : {};

  if (type === "table") {
    if (isLikelyValidTableContent(block?.content)) {
      // Table content is schema-specific structured data. Do not run it through
      // inline text normalization or BlockNote will reject it on reload.
      const tableBlock: any = { ...block, type, props, content: block.content };
      if (Array.isArray(block?.children)) {
        tableBlock.children = block.children.map((child: any) =>
          normalizeBlockForBlockNote(child),
        );
      }
      return tableBlock as PartialBlock;
    }

    return {
      type: "paragraph",
      content: [
        { type: "text", text: fallbackTextForBrokenTable(block), styles: {} },
      ],
    } as PartialBlock;
  }

  const next: any = { ...block, type, props };

  if (Array.isArray(block?.content)) {
    next.content = normalizeInlineContentForBlockNote(block.content);
  } else if (typeof block?.content === "string") {
    next.content = normalizeInlineContentForBlockNote(block.content);
  } else if (!["columnList", "column", "externalLinkCard"].includes(type)) {
    next.content = [];
  } else {
    delete next.content;
  }

  if (Array.isArray(block?.children)) {
    next.children = block.children.map((child: any) =>
      normalizeBlockForBlockNote(child),
    );
  }

  return next as PartialBlock;
}

const STABLE_ATTACHMENT_SCHEME = "local-attachment:";

function decodeUrlSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * BlockNote documents must not persist the temporary localhost port used by the
 * Electron process.  This stable reference contains no physical path and is
 * resolved to the current API only while the editor is open.
 */
function toStableAttachmentUrl(raw: string): string {
  if (!raw || raw.startsWith(STABLE_ATTACHMENT_SCHEME)) return raw;
  try {
    const parsed = new URL(raw);
    const pageMatch = parsed.pathname.match(
      /^\/pages\/([^/]+)\/attachments\/([^/]+)\/(?:name\/([^/?#]+)|file|download)(?:\/|$)/,
    );
    if (pageMatch) {
      const pageId = decodeUrlSegment(pageMatch[1]);
      const attachmentId = decodeUrlSegment(pageMatch[2]);
      const fileName = decodeUrlSegment(pageMatch[3] || "attachment");
      return `${STABLE_ATTACHMENT_SCHEME}//attachment/page/${encodeURIComponent(pageId)}/${encodeURIComponent(attachmentId)}/${encodeURIComponent(fileName)}`;
    }
    const rowMatch = parsed.pathname.match(
      /^\/databases\/([^/]+)\/rows\/([^/]+)\/attachments\/([^/]+)\/(?:name\/([^/?#]+)|file|download)(?:\/|$)/,
    );
    if (!rowMatch) return raw;
    const databaseId = decodeUrlSegment(rowMatch[1]);
    const rowId = decodeUrlSegment(rowMatch[2]);
    const attachmentId = decodeUrlSegment(rowMatch[3]);
    const fileName = decodeUrlSegment(rowMatch[4] || "attachment");
    return `${STABLE_ATTACHMENT_SCHEME}//attachment/dbrow/${encodeURIComponent(databaseId)}/${encodeURIComponent(rowId)}/${encodeURIComponent(attachmentId)}/${encodeURIComponent(fileName)}`;
  } catch {
    return raw;
  }
}

function resolveStableAttachmentUrl(raw: string, attachmentApiBaseUrl: string): string {
  const base = String(attachmentApiBaseUrl || "").trim();
  if (!base || !raw) return raw;
  if (raw.startsWith(STABLE_ATTACHMENT_SCHEME)) {
    try {
      const parsed = new URL(raw);
      if (parsed.hostname !== "attachment") return raw;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === 'dbrow' && parts.length >= 5) {
        const databaseId = decodeUrlSegment(parts[1]);
        const rowId = decodeUrlSegment(parts[2]);
        const attachmentId = decodeUrlSegment(parts[3]);
        const fileName = decodeUrlSegment(parts[4] || 'attachment');
        return new URL(`/databases/${encodeURIComponent(databaseId)}/rows/${encodeURIComponent(rowId)}/attachments/${encodeURIComponent(attachmentId)}/name/${encodeURIComponent(fileName)}`, base).toString();
      }
      const start = parts[0] === 'page' ? 1 : 0;
      if (parts.length - start < 2) return raw;
      const pageId = decodeUrlSegment(parts[start]);
      const attachmentId = decodeUrlSegment(parts[start + 1]);
      const fileName = decodeUrlSegment(parts[start + 2] || "attachment");
      return new URL(`/pages/${encodeURIComponent(pageId)}/attachments/${encodeURIComponent(attachmentId)}/name/${encodeURIComponent(fileName)}`, base).toString();
    } catch {
      return raw;
    }
  }
  try {
    const parsed = new URL(raw);
    // Legacy documents can contain the previous Electron launch's localhost
    // port. Rebase only canonical attachment routes, never arbitrary URLs.
    const isPageAttachment = /^\/pages\/[^/]+\/attachments\/[^/]+\/(?:file|download)(?:\/|$)/.test(parsed.pathname) || /^\/pages\/[^/]+\/attachments\/[^/]+\/name\//.test(parsed.pathname);
    const isRowAttachment = /^\/databases\/[^/]+\/rows\/[^/]+\/attachments\/[^/]+\/(?:file|download)(?:\/|$)/.test(parsed.pathname) || /^\/databases\/[^/]+\/rows\/[^/]+\/attachments\/[^/]+\/name\//.test(parsed.pathname);
    if (!isPageAttachment && !isRowAttachment) return raw;
    return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, base).toString();
  } catch {
    return raw;
  }
}

function mapAttachmentUrls(value: any, mapper: (raw: string) => string): any {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return mapper(value);
  if (Array.isArray(value)) return value.map((item) => mapAttachmentUrls(item, mapper));
  if (typeof value !== "object") return value;
  const next: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) next[key] = mapAttachmentUrls(item, mapper);
  return next;
}

function rebaseStoredAttachmentUrls(value: any, attachmentApiBaseUrl: string): any {
  return mapAttachmentUrls(value, (raw) => resolveStableAttachmentUrl(raw, attachmentApiBaseUrl));
}

function persistStableAttachmentUrls(value: any): any {
  return mapAttachmentUrls(value, toStableAttachmentUrl);
}

function normalizeLegacyLocalLinks(
  blocks: BlockNoteDoc,
  attachmentApiBaseUrl = "",
): BlockNoteDoc {
  const safeBlocks =
    blocks && blocks.length > 0
      ? blocks
      : [{ type: "paragraph", content: [] } as PartialBlock];
  return safeBlocks.map((block: any) =>
    normalizeBlockForBlockNote(rebaseStoredAttachmentUrls(block, attachmentApiBaseUrl)),
  );
}

function replaceActiveMentionWithPageLink(
  editor: any,
  page: PageWithLock,
  query: string | null,
) {
  try {
    const position = editor.getTextCursorPosition?.();
    const block = position?.block;
    if (!block) return false;

    const content = block.content;
    const currentText = textFromInlineContent(content);
    const escapedQuery = (query ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = escapedQuery
      ? new RegExp(`(^|\\s)@${escapedQuery}$`, "u")
      : /(^|\s)@$/u;
    const match = currentText.match(pattern);
    if (!match || match.index === undefined) return false;

    const start = match.index + match[1].length;
    const before = currentText.slice(0, start);
    const after = currentText.slice(start + 1 + (query ?? "").length);
    const nextContent = [
      ...(before ? [{ type: "text", text: before, styles: {} }] : []),
      ...pageLinkInlineContent(page.title, page.id),
      ...(after ? [{ type: "text", text: after, styles: {} }] : []),
    ];

    if (typeof editor.updateBlock === "function") {
      editor.updateBlock(block, { ...block, content: nextContent });
      return true;
    }
    if (typeof editor.replaceBlocks === "function") {
      editor.replaceBlocks([block], [{ ...block, content: nextContent }]);
      return true;
    }
  } catch {}
  return false;
}

function readablePageLink(page: PageWithLock): string {
  return `📄 ${page.title}`;
}

function insertPageLinkInline(editor: any, page: PageWithLock) {
  try {
    if (typeof editor.insertInlineContent === "function") {
      editor.insertInlineContent(pageLinkInlineContent(page.title, page.id));
      return true;
    }
  } catch {}
  return false;
}

function pageLinkCardBlock(page: PageWithLock): PartialBlock {
  return {
    type: "paragraph",
    props: { backgroundColor: "gray" },
    content: [
      { type: "text", text: "📄 ", styles: { bold: true } },
      {
        type: "link",
        href: `#local-page=${encodeURIComponent(page.id)}`,
        content: [{ type: "text", text: page.title, styles: { bold: true } }],
      },
      { type: "text", text: "  ページリンク", styles: {} },
    ],
  } as PartialBlock;
}

function readableDatabaseEmbed(database: WorkspaceDatabase): string {
  return `[[database:${database.id}|${database.title}]]`;
}

function readableLinkedDatabaseViewEmbed(database: WorkspaceDatabase, viewId: string): string {
  const view = (database.views ?? []).find((item) => item.id === viewId);
  const viewName = view?.name || "ビュー";
  return `[[database-view:${database.id}:${viewId}|${database.title} · ${viewName}]]`;
}

function insertPageLinkCard(editor: any, page: PageWithLock): boolean {
  try {
    const block = pageLinkCardBlock(page);
    const position = editor.getTextCursorPosition?.();
    if (position?.block)
      editor.insertBlocks?.([block], position.block, "after");
    else {
      const doc = editor.document ?? [];
      const last = doc[doc.length - 1];
      if (last) editor.insertBlocks?.([block], last, "after");
      else editor.insertBlocks?.([block]);
    }
    return true;
  } catch {
    return false;
  }
}

function replaceActiveMentionWithPageCard(
  editor: any,
  page: PageWithLock,
  query: string | null,
): boolean {
  try {
    const position = editor.getTextCursorPosition?.();
    const block = position?.block;
    if (!block) return false;
    const currentText = textFromInlineContent(block.content);
    const escapedQuery = (query ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = escapedQuery
      ? new RegExp(`(^|\\s)@${escapedQuery}$`, "u")
      : /(^|\s)@$/u;
    const match = currentText.match(pattern);
    if (!match || match.index === undefined) return false;
    const start = match.index + match[1].length;
    const before = currentText.slice(0, start).trimEnd();
    const after = currentText
      .slice(start + 1 + (query ?? "").length)
      .trimStart();
    const replacementBlocks: PartialBlock[] = [];
    if (before)
      replacementBlocks.push({
        ...block,
        content: [{ type: "text", text: before, styles: {} }],
      } as PartialBlock);
    replacementBlocks.push(pageLinkCardBlock(page));
    if (after)
      replacementBlocks.push({
        type: "paragraph",
        content: [{ type: "text", text: after, styles: {} }],
      } as PartialBlock);
    if (typeof editor.replaceBlocks === "function") {
      editor.replaceBlocks([block], replacementBlocks);
      return true;
    }
  } catch {}
  return false;
}

function convertPageLinkPresentation(
  editor: any,
  page: PageWithLock,
  mode: "inline" | "card",
): boolean {
  try {
    const blocks = editor.document ?? [];
    const nextBlocks = blocks.map((block: any) => {
      const text = textFromInlineContent(block.content, true);
      if (!text.includes(page.id)) return block;
      if (mode === "card") return pageLinkCardBlock(page);
      return {
        ...block,
        type: "paragraph",
        props: block.props ?? {},
        content: pageLinkInlineContent(page.title, page.id),
      };
    });
    if (JSON.stringify(blocks) === JSON.stringify(nextBlocks)) return false;
    editor.replaceBlocks?.(blocks, nextBlocks);
    return true;
  } catch {
    return false;
  }
}

function insertInlineOrBlock(editor: any, text: string) {
  try {
    if (typeof editor.insertInlineContent === "function") {
      editor.insertInlineContent([
        { type: "text", text: ` ${text} `, styles: {} },
      ]);
      return;
    }
  } catch {}

  const block = blockWithText(text);
  try {
    const position = editor.getTextCursorPosition?.();
    if (position?.block)
      editor.insertBlocks?.([block], position.block, "after");
    else {
      const doc = editor.document ?? [];
      const last = doc[doc.length - 1];
      if (last) editor.insertBlocks?.([block], last, "after");
      else editor.insertBlocks?.([block]);
    }
  } catch {
    editor.insertBlocks?.([block]);
  }
}

function duplicateAwarePageLabel(
  page: PageWithLock,
  pages: PageWithLock[],
  suffix = "",
): string {
  const title = stripPageIconPrefix(page.title || "Untitled") || "Untitled";
  const sameTitleCount = pages.filter(
    (candidate) => stripPageIconPrefix(candidate.title || "Untitled") === title,
  ).length;
  const disambiguator = sameTitleCount > 1 ? ` · ${page.id.slice(-6)}` : "";
  return `${page.icon ?? "📄"} ${title}${disambiguator}${suffix}`;
}

function safeSuggestionItems(items: any): any[] {
  if (!Array.isArray(items)) return [];
  return items.filter(Boolean).map((item, index) => ({
    ...item,
    // BlockNote/Mantine internally uses the title as a React key in some paths.
    // Make duplicate titles deterministic so pages named "Untitled" don't create key collisions.
    title:
      typeof item.title === "string"
        ? `${item.title}${item.__uniqueSuffix ?? ""}`
        : `item-${index}`,
  }));
}

function getLocalNotionSlashItems(
  editor: any,
  databases: WorkspaceDatabase[],
  onCreateChildPage?: () => Promise<PageWithLock | null>,
  query = "",
) {
  const childPageItem = {
    title: "子ページを作成",
    subtext: "現在のページの下に新しい子ページを作成します",
    aliases: ["page", "child", "subpage", "子ページ", "ページ"],
    group: "Local Notion",
    icon: <span>📄</span>,
    onItemClick: async () => {
      if (!onCreateChildPage) return;
      const child = await onCreateChildPage();
      if (child && !insertPageLinkInline(editor, child))
        insertInlineOrBlock(editor, `@[[${child.title}|${child.id}]]`);
    },
  };

  const normalizedQuery = query.trim().toLowerCase();
  const isDatabaseQuery = /^(database|db|データベース)(\s|$)/i.test(
    normalizedQuery,
  );
  const databaseQuery = isDatabaseQuery
    ? normalizedQuery
        .replace(/^database\s*/i, "")
        .replace(/^db\s*/i, "")
        .replace(/^データベース\s*/i, "")
        .trim()
    : "";

  const databasePickerItem = {
    title: "データベースを埋め込み",
    subtext:
      "クリックすると下部に候補を表示します。/database 名前 で直接検索もできます。",
    aliases: ["database", "db", "table", "view", "データベース"],
    group: "Local Notion",
    icon: <span>🗃️</span>,
    onItemClick: () => {
      window.dispatchEvent(
        new CustomEvent("local-notion-open-db-picker", {
          detail: { query: "" },
        }),
      );
    },
  };

  if (!isDatabaseQuery) {
    return [childPageItem, databasePickerItem];
  }

  const matchedDatabases = databases
    .filter(
      (database) =>
        !databaseQuery ||
        database.title.toLowerCase().includes(databaseQuery) ||
        database.id.toLowerCase().includes(databaseQuery),
    )
    .slice(0, 12);

  const databaseItems = matchedDatabases.map((database) => {
    const sameTitleCount = databases.filter(
      (db) => db.title === database.title,
    ).length;
    const suffix = sameTitleCount > 1 ? ` · ${database.id.slice(-4)}` : "";
    return {
      title: `🗃️ ${database.title}${suffix}`,
      subtext: `${database.rows.length} rows / ${database.properties.length} properties`,
      aliases: [
        "database",
        "db",
        "table",
        "view",
        "データベース",
        database.title,
        database.id,
      ],
      group: "データベースを埋め込み",
      icon: <span>🗃️</span>,
      onItemClick: () =>
        insertInlineOrBlock(editor, readableDatabaseEmbed(database)),
    };
  });

  const databaseEmptyItem = {
    title: databases.length
      ? "DB名を入力して絞り込み"
      : "データベースがありません",
    subtext: databases.length
      ? "候補は最大12件まで表示します。/database 名前 または /db 名前 で絞り込めます。"
      : "先にサイドバーからデータベースを作成してください",
    aliases: ["database", "db", "table", "view", "データベース"],
    group: "データベースを埋め込み",
    icon: <span>🗃️</span>,
    onItemClick: () => undefined,
  };

  return [
    childPageItem,
    ...(databaseItems.length ? databaseItems : [databaseEmptyItem]),
  ];
}

const multiColumnSchema = withMultiColumn(alertSchemaBase);
const multiColumnDictionary = {
  ...((locales as any).ja ?? (locales as any).en),
  multi_column:
    (multiColumnLocales as any).ja ?? (multiColumnLocales as any).en,
};

export function BlockNotePageEditor(props: Props) {
  const { pageId, initialContent, deferEditorMount = false } = props;
  const [readyPageId, setReadyPageId] = useState<string>(
    deferEditorMount ? "" : pageId,
  );
  const previewText = useMemo(
    () => docToPlainText(initialContent).trim(),
    [initialContent],
  );
  const isReady = !deferEditorMount || readyPageId === pageId;

  useEffect(() => {
    if (!deferEditorMount) {
      setReadyPageId(pageId);
      return;
    }

    let cancelled = false;
    const schedule = (window as any).requestIdleCallback as
      | ((callback: () => void, options?: { timeout?: number }) => number)
      | undefined;
    const cancel = (window as any).cancelIdleCallback as
      | ((handle: number) => void)
      | undefined;
    const activate = () => {
      if (!cancelled) setReadyPageId(pageId);
    };
    const handle = schedule
      ? schedule(activate, { timeout: 180 })
      : window.setTimeout(activate, 80);

    return () => {
      cancelled = true;
      if (schedule && cancel) cancel(handle);
      else window.clearTimeout(handle);
    };
  }, [pageId, deferEditorMount]);

  if (!isReady) {
    return (
      <div className="blocknote-shell blocknote-deferred-shell" aria-busy="true">
        <div className="blocknote-deferred-preview">
          {previewText ? (
            <p>{previewText.slice(0, 1200)}</p>
          ) : (
            <p className="blocknote-deferred-empty">本文を準備しています…</p>
          )}
        </div>
        <div className="blocknote-deferred-status">
          <span className="blocknote-deferred-dot" aria-hidden="true" />
          エディタを準備しています…
        </div>
      </div>
    );
  }

  return <BlockNotePageEditorRuntime {...props} />;
}

function BlockNotePageEditorRuntime({
  pageId,
  initialContent,
  editing,
  pages,
  databases,
  databaseRowLinks = [],
  onChange,
  onCreateChildPage,
  onOpenPage,
  onPreviewPage,
  onOpenDatabase,
  onOpenDatabaseRow,
  onUploadFile,
  previewMode = false,
  aiClient = null,
  aiPageTitle = "",
  aiTagHints = [],
  attachmentApiBaseUrl = "",
}: Props) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  // v453: local AI editing UI. This uses an editor-only llama.cpp route instead of
  // the Smart Assist retrieval route, so related-source answers cannot enter the text.
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiStatus, setAiStatus] = useState<"idle" | "working" | "error">("idle");
  const [aiError, setAiError] = useState("");
  const [aiDraft, setAiDraft] = useState("");
  const selectedTextRef = useRef("");
  const [aiSelectionAnchor, setAiSelectionAnchor] = useState<{ left: number; top: number; text: string } | null>(null);
  const [pageQuery, setPageQuery] = useState("");
  const [dbQuery, setDbQuery] = useState("");
  const [typingMentionQuery, setTypingMentionQuery] = useState<string | null>(
    null,
  );
  const [typingDbQuery, setTypingDbQuery] = useState<string | null>(null);
  const [mentionSuggestionLimit, setMentionSuggestionLimit] = useState(24);
  const lastMentionQueryRef = useRef("");
  const pageTitleSignature = useMemo(
    () => pages.map((page) => `${page.id}:${page.title}`).join("|"),
    [pages],
  );
  const databaseTitleSignature = useMemo(
    () => databases.map((item) => `${item.id}:${item.title}`).join("|"),
    [databases],
  );
  const databaseRowTitleSignature = useMemo(
    () =>
      databaseRowLinks
        .map(
          (item) =>
            `${item.databaseId}:${item.rowId}:${item.databaseTitle}/${item.rowTitle}`,
        )
        .join("|"),
    [databaseRowLinks],
  );

  const normalizedInitialContent = useMemo(
    () =>
      syncDocResourceTitles(
        normalizeLegacyLocalLinks(
          initialContent && initialContent.length > 0
            ? initialContent
            : [{ type: "paragraph", content: [] } as PartialBlock],
          attachmentApiBaseUrl,
        ),
        pages,
        databases,
        databaseRowLinks,
      ),
    [
      pageId,
      initialContent,
      attachmentApiBaseUrl,
      pageTitleSignature,
      databaseTitleSignature,
      databaseRowTitleSignature,
    ],
  );

  const uploadFileRef = useRef<Props["onUploadFile"]>(onUploadFile);
  useEffect(() => {
    uploadFileRef.current = onUploadFile;
  }, [onUploadFile]);

  const editor = useCreateBlockNote(
    {
      schema: multiColumnSchema,
      dropCursor: multiColumnDropCursor,
      dictionary: multiColumnDictionary,
      initialContent: normalizedInitialContent,
      uploadFile: async (file) => {
        const uploader = uploadFileRef.current;
        if (!uploader)
          throw new Error("ファイルアップロード処理が設定されていません。");
        return uploader(file);
      },
    },
    [pageId, attachmentApiBaseUrl],
  );

  const [editorReady, setEditorReady] = useState(false);
  useEffect(() => {
    setEditorReady(false);
    const frame = requestAnimationFrame(() => setEditorReady(true));
    return () => cancelAnimationFrame(frame);
  }, [pageId, editor]);

  // Keep visible local page link titles in sync only when the editor is not being actively edited.
  // Replacing all blocks during text input recreates the Tiptap/BlockNote view and causes
  // `editor view is not available` errors, broken slash menus, and heavy rendering.
  useEffect(() => {
    if (editing) return;
    try {
      const doc = (editor as any).document as BlockNoteDoc;
      const synced = syncDocResourceTitles(
        doc,
        pages,
        databases,
        databaseRowLinks,
      );
      if (JSON.stringify(doc) === JSON.stringify(synced)) return;
      const blocks = (editor as any).document ?? [];
      if (
        typeof (editor as any).replaceBlocks === "function" &&
        blocks.length > 0
      ) {
        (editor as any).replaceBlocks(blocks, synced);
      }
    } catch {}
  }, [
    pageTitleSignature,
    databaseTitleSignature,
    databaseRowTitleSignature,
    editing,
    editor,
  ]);

  // v44: BlockNote標準リンクUIの「ページを開く」は内部的には通常の<a>クリックになる。
  // React側のonClickに届かないことがあるため、document captureでlocal pageリンクを一元的に拾う。
  useEffect(() => {
    const handleLocalPageOpen = (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;
      if (shellRef.current && !shellRef.current.contains(target)) return;
      const anchor = target.closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;

      const href = anchor.getAttribute("href") || anchor.href || "";
      // Internal @/resource links may be serialized as a normal http(s) URL with
      // a #local-* fragment. Resolve them before any external-browser handling.
      const dbrowFromHref = localDatabaseRowFromHref(href);
      if (dbrowFromHref) {
        event.preventDefault();
        event.stopPropagation();
        onOpenDatabaseRow?.(dbrowFromHref.databaseId, dbrowFromHref.rowId);
        return;
      }

      const databaseIdFromHref = localDatabaseIdFromHref(href);
      if (databaseIdFromHref) {
        event.preventDefault();
        event.stopPropagation();
        onOpenDatabase?.(databaseIdFromHref);
        return;
      }

      const pageIdFromHref = localPageIdFromHref(href);
      if (pageIdFromHref) {
        event.preventDefault();
        event.stopPropagation();
        onPreviewPage?.(pageIdFromHref);
        return;
      }

      const externalUrl = normalizeExternalHttpUrl(href);
      if (externalUrl) {
        event.preventDefault();
        event.stopPropagation();
        void window.localNotion.openExternalHttpUrl(externalUrl);
      }
    };

    document.addEventListener("click", handleLocalPageOpen, true);
    return () =>
      document.removeEventListener("click", handleLocalPageOpen, true);
  }, [onPreviewPage, onOpenDatabase, onOpenDatabaseRow]);

  const effectivePageQuery =
    typingMentionQuery !== null ? typingMentionQuery : pageQuery;
  const effectiveDbQuery = typingDbQuery !== null ? typingDbQuery : dbQuery;

  const matchedPages = useMemo(() => {
    const q = effectivePageQuery.trim().toLowerCase();
    return pages
      .filter((page) => page.id !== pageId)
      .filter(
        (page) =>
          !q ||
          page.title.toLowerCase().includes(q) ||
          page.id.toLowerCase().includes(q) ||
          page.properties.tags.some((tag) => tag.toLowerCase().includes(q)),
      )
      .slice(0, 24);
  }, [pages, pageId, effectivePageQuery]);

  const matchedDatabases = useMemo(() => {
    const q = effectiveDbQuery.trim().toLowerCase();
    return databases
      .filter(
        (db) =>
          !q ||
          db.title.toLowerCase().includes(q) ||
          db.id.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [databases, effectiveDbQuery]);

  const matchedDatabaseRows = useMemo(() => {
    const q = effectivePageQuery.trim().toLowerCase();
    return databaseRowLinks
      .filter(
        (target) =>
          !q ||
          target.rowTitle.toLowerCase().includes(q) ||
          target.databaseTitle.toLowerCase().includes(q) ||
          target.rowId.toLowerCase().includes(q),
      )
      .slice(0, 24);
  }, [databaseRowLinks, effectivePageQuery]);

  useEffect(() => {
    const openPicker = (event: Event) => {
      const detail = (event as CustomEvent<{ query?: string }>).detail;
      setTypingDbQuery(detail?.query ?? "");
      setDbQuery(detail?.query ?? "");
    };
    window.addEventListener(
      "local-notion-open-db-picker",
      openPicker as EventListener,
    );
    return () =>
      window.removeEventListener(
        "local-notion-open-db-picker",
        openPicker as EventListener,
      );
  }, []);

  function emitPersistedChange(doc: BlockNoteDoc) {
    // The live editor uses the current API URL so BlockNote can render previews.
    // The persisted document keeps stable attachment identifiers only.
    onChange(persistStableAttachmentUrls(doc) as BlockNoteDoc);
  }

  function emitChange() {
    const doc = editor.document as BlockNoteDoc;
    // Do not update React state on every keystroke. BlockNote's SuggestionMenuController
    // already handles slash/@ queries internally; updating our state here caused heavy
    // rerenders and made the editor feel slow.
    emitPersistedChange(doc);
  }

  function insertBlock(text: string) {
    const anyEditor = editor as any;
    // v22: @リンク選択で行が一段下がらないよう、まずカーソル位置へインライン挿入を試す。
    // BlockNoteのAPI差異に備え、未対応時だけ従来のブロック挿入にフォールバックする。
    try {
      if (typeof anyEditor.insertInlineContent === "function") {
        anyEditor.insertInlineContent([
          { type: "text", text: ` ${text} `, styles: {} },
        ]);
      } else {
        const block = blockWithText(text);
        const position = anyEditor.getTextCursorPosition?.();
        if (position?.block)
          anyEditor.insertBlocks?.([block], position.block, "after");
        else {
          const doc = anyEditor.document ?? [];
          const last = doc[doc.length - 1];
          if (last) anyEditor.insertBlocks?.([block], last, "after");
          else anyEditor.insertBlocks?.([block]);
        }
      }
    } catch {
      const block = blockWithText(text);
      const position = anyEditor.getTextCursorPosition?.();
      if (position?.block)
        anyEditor.insertBlocks?.([block], position.block, "after");
      else anyEditor.insertBlocks?.([block]);
    }
    setTypingMentionQuery(null);
    setTypingDbQuery(null);
    setPageQuery("");
    setDbQuery("");
    emitPersistedChange(editor.document as BlockNoteDoc);
  }

  function insertPageLink(page: PageWithLock) {
    const anyEditor = editor as any;
    const replaced = replaceActiveMentionWithPageLink(
      anyEditor,
      page,
      typingMentionQuery ?? pageQuery,
    );
    const inserted = replaced || insertPageLinkInline(anyEditor, page);
    if (!inserted) insertBlock(`📄 ${page.title}`);
    setTypingMentionQuery(null);
    setPageQuery("");
    queueMicrotask(() => emitPersistedChange(anyEditor.document as BlockNoteDoc));
  }

  function insertDatabaseRowLink(target: DatabaseRowLinkTarget) {
    const text = `${target.databaseTitle} / ${target.rowTitle}`;
    const href = `#local-dbrow=${encodeURIComponent(target.databaseId)}&row=${encodeURIComponent(target.rowId)}`;
    try {
      const anyEditor = editor as any;
      if (typeof anyEditor.insertInlineContent === "function") {
        anyEditor.insertInlineContent([
          ...databaseRowLinkInlineContent(
            text,
            target.databaseId,
            target.rowId,
          ),
        ]);
      } else
        insertBlock(`[[dbrow:${target.databaseId}:${target.rowId}|${text}]]`);
    } catch {
      insertBlock(`[[dbrow:${target.databaseId}:${target.rowId}|${text}]]`);
    }
    setTypingMentionQuery(null);
    setPageQuery("");
    queueMicrotask(() => emitPersistedChange((editor as any).document as BlockNoteDoc));
  }

  function insertDatabase(database: WorkspaceDatabase) {
    try {
      const anyEditor = editor as any;
      if (typeof anyEditor.insertInlineContent === "function") {
        anyEditor.insertInlineContent(
          databaseLinkInlineContent(database.title, database.id),
        );
      } else {
        insertBlock(readableDatabaseEmbed(database));
      }
    } catch {
      insertBlock(readableDatabaseEmbed(database));
    }
    setTypingDbQuery(null);
    setDbQuery("");
    queueMicrotask(() => emitPersistedChange((editor as any).document as BlockNoteDoc));
  }

  function insertLinkedDatabaseView(database: WorkspaceDatabase, viewId: string) {
    // A linked DB view stores only databaseId + viewId in the page body.
    // Rows and schema remain in the original database.
    insertBlock(readableLinkedDatabaseViewEmbed(database, viewId));
  }

  function insertPageCard(page: PageWithLock) {
    const anyEditor = editor as any;
    const replaced = replaceActiveMentionWithPageCard(
      anyEditor,
      page,
      typingMentionQuery ?? pageQuery,
    );
    const inserted = replaced || insertPageLinkCard(anyEditor, page);
    if (!inserted) insertBlock(`📄 ${page.title}`);
    setTypingMentionQuery(null);
    setPageQuery("");
    queueMicrotask(() => emitPersistedChange(anyEditor.document as BlockNoteDoc));
  }

  function convertExistingPageLink(
    page: PageWithLock,
    mode: "inline" | "card",
  ) {
    const anyEditor = editor as any;
    const converted = convertPageLinkPresentation(anyEditor, page, mode);
    if (converted)
      queueMicrotask(() => emitPersistedChange(anyEditor.document as BlockNoteDoc));
  }

  const getMentionMenuItems = useMemo(() => {
    return async (query: string) => {
      const normalizedQuery = (query ?? "").trim().toLowerCase();
      if (lastMentionQueryRef.current !== normalizedQuery) {
        lastMentionQueryRef.current = normalizedQuery;
        // Avoid showing hundreds of page candidates at once when the query changes.
        setMentionSuggestionLimit(24);
      }

      const allCandidates = pages
        .filter((page) => page.id !== pageId)
        .filter((page) => {
          if (!normalizedQuery) return true;
          return (
            page.title.toLowerCase().includes(normalizedQuery) ||
            page.id.toLowerCase().includes(normalizedQuery) ||
            page.properties.tags.some((tag) =>
              tag.toLowerCase().includes(normalizedQuery),
            )
          );
        });

      const visibleCandidates = allCandidates.slice(0, mentionSuggestionLimit);
      const remainingCount = Math.max(
        0,
        allCandidates.length - visibleCandidates.length,
      );

      const inlineItems = visibleCandidates.map((page) => ({
        title: duplicateAwarePageLabel(page, pages),
        subtext: `インラインリンクとして挿入${page.properties.tags.length ? ` / #${page.properties.tags[0]}` : ""}`,
        aliases: [page.title, page.id, ...page.properties.tags],
        group: "ページリンク",
        icon: <span>{page.icon ?? "📄"}</span>,
        onItemClick: () => {
          const activeQuery =
            detectMentionQuery((editor as any).document as BlockNoteDoc) ??
            query;
          if (
            !replaceActiveMentionWithPageLink(editor as any, page, activeQuery)
          ) {
            insertPageLinkInline(editor as any, page);
          }
          setTypingMentionQuery(null);
          setPageQuery("");
          queueMicrotask(() =>
            emitPersistedChange((editor as any).document as BlockNoteDoc),
          );
        },
      }));

      const cardItems = visibleCandidates.map((page) => ({
        title: duplicateAwarePageLabel(page, pages, " をカードで挿入"),
        subtext: "Notion風のページカードとして挿入",
        aliases: [
          page.title,
          page.id,
          "card",
          "カード",
          ...page.properties.tags,
        ],
        group: "ページカード",
        icon: <span>▣</span>,
        onItemClick: () => {
          const activeQuery =
            detectMentionQuery((editor as any).document as BlockNoteDoc) ??
            query;
          if (
            !replaceActiveMentionWithPageCard(editor as any, page, activeQuery)
          ) {
            insertPageLinkCard(editor as any, page);
          }
          setTypingMentionQuery(null);
          setPageQuery("");
          queueMicrotask(() =>
            emitPersistedChange((editor as any).document as BlockNoteDoc),
          );
        },
      }));

      const dbRowItems = matchedDatabaseRows.map((target) => ({
        title: `${target.databaseTitle} / ${target.rowTitle}`,
        subtext: "DB行ページへのリンクとして挿入",
        aliases: [
          target.databaseTitle,
          target.rowTitle,
          target.databaseId,
          target.rowId,
          "dbrow",
          "行",
        ],
        group: "DB行リンク",
        icon: <span>🧾</span>,
        onItemClick: () => insertDatabaseRowLink(target),
      }));

      const loadMoreItem =
        remainingCount > 0
          ? [
              {
                title: `さらに表示（残り${remainingCount}件）`,
                subtext: "候補を24件ずつ追加表示します",
                aliases: ["more", "さらに", "load more"],
                group: "ページ候補",
                icon: <span>＋</span>,
                onItemClick: () => {
                  setMentionSuggestionLimit((limit) =>
                    Math.min(limit + 24, allCandidates.length),
                  );
                },
              },
            ]
          : [];

      return filterSuggestionItems(
        combineByGroup(
          inlineItems as any,
          dbRowItems as any,
          cardItems as any,
          loadMoreItem as any,
        ) as any,
        query,
      ) as any;
    };
  }, [
    editor,
    pages,
    pageId,
    onChange,
    mentionSuggestionLimit,
    matchedDatabaseRows,
  ]);

  const readEditorSelection = () => {
    const selection = window.getSelection?.();
    const text = selection?.toString()?.trim() || "";
    if (text) selectedTextRef.current = text;
    return text || selectedTextRef.current;
  };

  const captureEditorAiSelection = () => {
    const selection = window.getSelection?.();
    const text = selection?.toString()?.trim() || "";
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const shell = shellRef.current;
    const commonNode = range?.commonAncestorContainer;
    const selectionBelongsToEditor = Boolean(
      shell && commonNode && (commonNode === shell || shell.contains(commonNode.nodeType === Node.ELEMENT_NODE ? commonNode : commonNode.parentElement)),
    );

    if (!text || !range || !selectionBelongsToEditor) {
      setAiSelectionAnchor(null);
      return;
    }

    selectedTextRef.current = text;
    const rect = range.getBoundingClientRect();
    const next = {
      left: Math.max(12, Math.min(window.innerWidth - 176, rect.left + rect.width / 2 - 78)),
      top: Math.max(12, rect.top - 46),
      text,
    };
    setAiSelectionAnchor((previous) =>
      previous && previous.text === next.text && Math.abs(previous.left - next.left) < 2 && Math.abs(previous.top - next.top) < 2
        ? previous
        : next,
    );
  };

  useEffect(() => {
    if (!editing || !aiClient) return;
    const onSelectionChange = () => captureEditorAiSelection();
    const onViewportChange = () => setAiSelectionAnchor(null);
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [editing, aiClient]);

  const openEditorAi = () => {
    captureEditorAiSelection();
    setAiError("");
    setAiPanelOpen(true);
  };

  const runEditorAi = async (preset: "summary" | "rewrite" | "bullets" | "todo" | "custom") => {
    if (!aiClient) {
      setAiError("AI接続が準備できていません。アプリの接続状態を確認してください。");
      setAiStatus("error");
      return;
    }
    const selectedText = readEditorSelection();
    const currentText = selectedText || docToPlainText((editor as any).document as BlockNoteDoc).trim();
    if (!currentText) {
      setAiError("AIに渡す本文または選択範囲がありません。");
      setAiStatus("error");
      return;
    }
    const action = preset === "summary" ? "次の文章を、内容を変えずに日本語で簡潔に要約してください。"
      : preset === "rewrite" ? "次の文章を、意味を変えずに読みやすく自然な業務文へ書き換えてください。"
      : preset === "bullets" ? "次の文章を、内容を落とさずに見出し付きの箇条書きへ整理してください。"
      : preset === "todo" ? "次の文章から、実行すべきTODO・確認事項・期限を箇条書きで抽出してください。"
      : aiInstruction.trim();
    if (!action) {
      setAiError("AIへの指示を入力してください。");
      setAiStatus("error");
      return;
    }
    setAiStatus("working");
    setAiError("");
    setAiDraft("");
    try {
      const result = await aiClient.generateEditorAiEdit({
        operation: preset,
        instruction: preset === "custom" ? action : undefined,
        // Editor AI must receive only the selection (or current page when nothing
        // is selected). It deliberately does not receive tags, page title,
        // related candidates, or any workspace search context.
        text: currentText.slice(0, 8_000),
      });
      const answer = String(result?.answer || result?.text || "").trim();
      if (!result?.ok || !answer) throw new Error(String(result?.message || "AIの編集結果を取得できませんでした。"));
      setAiDraft(answer);
      setAiStatus("idle");
    } catch (error: any) {
      setAiStatus("error");
      setAiError(String(error?.message || "AI編集に失敗しました。"));
    }
  };

  const applyAiDraft = (mode: "replace" | "append") => {
    const text = aiDraft.trim();
    if (!text) return;
    const anyEditor = editor as any;
    try {
      if (mode === "replace" && selectedTextRef.current) {
        const tiptap = anyEditor._tiptapEditor || anyEditor.tiptapEditor;
        if (tiptap?.commands?.insertContent) {
          tiptap.commands.insertContent(text);
        } else if (typeof anyEditor.insertInlineContent === "function") {
          anyEditor.insertInlineContent([{ type: "text", text, styles: {} }]);
        } else {
          throw new Error("選択範囲の置換APIが利用できません。");
        }
      } else {
        const blocks = text.split(/\n{2,}/).map((part: string) => blockWithText(part.trim())).filter((block: any) => textFromInlineContent(block.content));
        const cursor = anyEditor.getTextCursorPosition?.();
        if (cursor?.block && typeof anyEditor.insertBlocks === "function") anyEditor.insertBlocks(blocks, cursor.block, "after");
        else if (typeof anyEditor.insertBlocks === "function") anyEditor.insertBlocks(blocks);
        else anyEditor.insertInlineContent?.([{ type: "text", text: `\n${text}`, styles: {} }]);
      }
      selectedTextRef.current = "";
      setAiDraft("");
      setAiPanelOpen(false);
      queueMicrotask(() => emitPersistedChange(anyEditor.document as BlockNoteDoc));
    } catch (error: any) {
      setAiStatus("error");
      setAiError(String(error?.message || "AI結果の適用に失敗しました。"));
    }
  };

  const getSlashMenuItems = useMemo(() => {
    return async (query: string) => {
      try {
        const localItems = getLocalNotionSlashItems(
          editor as any,
          databases,
          onCreateChildPage,
          query,
        ) as any;
        const linkCardItems = [insertExternalLinkCardItem(editor as any)] as any;
        const alertItems = [insertAlertItem(editor as any)] as any;
        const aiItems = aiClient ? [{
          title: "AIで書く・編集",
          subtext: "要約、書き換え、箇条書き、TODO抽出を行います",
          aliases: ["ai", "AI", "生成", "要約", "書き換え", "todo"],
          group: "AI",
          icon: <span>✦</span>,
          onItemClick: () => openEditorAi(),
        }] : [];
        const multiColumnItems = getMultiColumnSlashMenuItems(
          editor as any,
        ) as any;
        const defaultItems = getDefaultReactSlashMenuItems(
          editor as any,
        ) as any;
        return safeSuggestionItems(
          filterSuggestionItems(
            combineByGroup(
              localItems,
              linkCardItems,
              alertItems,
              aiItems,
              multiColumnItems,
              defaultItems,
            ) as any,
            query,
          ) as any,
        );
      } catch (error) {
        console.error("Failed to build BlockNote slash menu items", error);
        // Keep the built-in slash menu usable even if a local extension fails.
        return filterSuggestionItems(
          getDefaultReactSlashMenuItems(editor as any) as any,
          query,
        ) as any;
      }
    };
  }, [editor, databases, onCreateChildPage, aiClient]);

  return (
    <div
      ref={shellRef}
      className={
        previewMode
          ? "blocknote-shell preview-blocknote-shell"
          : "blocknote-shell"
      }
    >
      {false && editing && typingMentionQuery !== null && (
        <div
          className="floating-suggestion-panel notion-suggestion"
          role="listbox"
          aria-label="ページ候補"
        >
          <div className="floating-suggestion-header">
            <div>
              <strong>@{typingMentionQuery || "ページ"}</strong>
              <span>ページ候補</span>
            </div>
            <small>{matchedPages.length}件</small>
          </div>
          <div className="floating-suggestion-body">
            {matchedPages.length === 0 ? (
              <div className="suggestion-empty">該当ページなし</div>
            ) : (
              matchedPages.map((page) => (
                <div key={page.id} className="suggestion-row-combo">
                  <button
                    type="button"
                    className="suggestion-primary-action"
                    onClick={() => insertPageLink(page)}
                    title="インラインリンクとして挿入"
                  >
                    <span className="suggestion-main">
                      <span>
                        {page.icon ?? "📄"} {page.title}
                      </span>
                      <em>{page.id.slice(0, 10)}</em>
                    </span>
                    <small>
                      インライン / {page.properties.status} /{" "}
                      {page.properties.priority}
                      {page.properties.tags.length
                        ? ` / #${page.properties.tags[0]}`
                        : ""}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="suggestion-secondary-action"
                    onClick={() => insertPageCard(page)}
                    title="カード型リンクとして挿入"
                  >
                    カード
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="floating-suggestion-footer">
            クリックでページリンク、カードでカード型リンクを挿入します
          </div>
        </div>
      )}

      {editing && typingDbQuery !== null && (
        <div
          className="floating-suggestion-panel db-panel notion-suggestion"
          role="listbox"
          aria-label="データベース候補"
        >
          <div className="floating-suggestion-header">
            <div>
              <strong>
                /{typingDbQuery ? `database ${typingDbQuery}` : "database"}
              </strong>
              <span>データベース候補</span>
            </div>
            <small>{matchedDatabases.length}件</small>
          </div>
          <div className="floating-suggestion-body">
            {matchedDatabases.length === 0 ? (
              <div className="suggestion-empty">該当DBなし</div>
            ) : (
              matchedDatabases.map((db) => (
                <div className="linked-db-picker-item-v474" key={db.id}>
                  <button type="button" onClick={() => insertDatabase(db)}>
                    <span className="suggestion-main">
                      <span>🗃️ {db.title}</span>
                      <em>{db.id.slice(0, 10)}</em>
                    </span>
                    <small>{db.rows.length} rows / {db.properties.length} properties</small>
                  </button>
                  {(db.views ?? []).length > 0 && (
                    <div className="linked-db-view-options-v474">
                      <span>リンクドビュー</span>
                      {(db.views ?? []).slice(0, 6).map((view) => (
                        <button
                          key={view.id}
                          type="button"
                          className="linked-db-view-option-v474"
                          onClick={() => insertLinkedDatabaseView(db, view.id)}
                          title={`このページに「${view.name}」をリンクドDBとして表示`}
                        >
                          {view.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="floating-suggestion-footer">
            DB本体の埋め込み、またはビュー名を選んでリンクドDBビューとして挿入できます
          </div>
        </div>
      )}

      {editing && aiClient && (
        <>
          {!aiPanelOpen && (
            <button
              type="button"
              className={`blocknote-ai-fab${aiSelectionAnchor ? " has-selection" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openEditorAi}
              aria-label={aiSelectionAnchor ? "選択範囲をAI編集" : "AI編集を開く"}
            >
              <span>✦</span>
              <strong>{aiSelectionAnchor ? "選択範囲をAI編集" : "AI編集"}</strong>
            </button>
          )}

          {aiPanelOpen && (
            <aside className="blocknote-ai-dock" aria-label="AI編集">
              <div className="blocknote-ai-dock-head">
                <div className="blocknote-ai-dock-title">
                  <span className="blocknote-ai-spark" aria-hidden="true">✦</span>
                  <div><strong>AI編集</strong><small>{selectedTextRef.current ? `選択範囲 ${Math.min(selectedTextRef.current.length, 8000)}文字` : "現在のページを対象"}</small></div>
                </div>
                <button type="button" className="blocknote-ai-icon-button" onClick={() => { setAiPanelOpen(false); setAiError(""); }} aria-label="AI編集を閉じる">×</button>
              </div>

              <div className="blocknote-ai-quick-actions">
                <button type="button" disabled={aiStatus === "working"} onMouseDown={(event) => event.preventDefault()} onClick={() => void runEditorAi("rewrite")}><span>✎</span>書き換え</button>
                <button type="button" disabled={aiStatus === "working"} onMouseDown={(event) => event.preventDefault()} onClick={() => void runEditorAi("summary")}><span>≡</span>要約</button>
                <button type="button" disabled={aiStatus === "working"} onMouseDown={(event) => event.preventDefault()} onClick={() => void runEditorAi("bullets")}><span>•</span>箇条書き</button>
                <button type="button" disabled={aiStatus === "working"} onMouseDown={(event) => event.preventDefault()} onClick={() => void runEditorAi("todo")}><span>✓</span>TODO</button>
              </div>

              <label className="blocknote-ai-composer">
                <span>指示</span>
                <textarea value={aiInstruction} disabled={aiStatus === "working"} onChange={(event) => setAiInstruction(event.target.value)} placeholder="例：保護者向けに、やわらかく分かりやすい表現にする" rows={3} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void runEditorAi("custom"); } }} />
              </label>
              <div className="blocknote-ai-dock-footer">
                <small>⌘ / Ctrl + Enter で生成</small>
                <button type="button" className="blocknote-ai-generate" disabled={aiStatus === "working"} onClick={() => void runEditorAi("custom")}>{aiStatus === "working" ? "生成中…" : "生成"}</button>
              </div>
              {aiError && <div className="blocknote-ai-error" role="alert">{aiError}</div>}
              {aiDraft && (
                <div className="blocknote-ai-result">
                  <div className="blocknote-ai-result-head"><strong>プレビュー</strong><button type="button" onClick={() => setAiDraft("")}>破棄</button></div>
                  <pre>{aiDraft}</pre>
                  <div className="blocknote-ai-result-actions">
                    <button type="button" onClick={() => applyAiDraft("replace")}>{selectedTextRef.current ? "置換する" : "カーソル位置に追加"}</button>
                    <button type="button" className="secondary" onClick={() => applyAiDraft("append")}>末尾に追加</button>
                  </div>
                </div>
              )}
            </aside>
          )}
        </>
      )}

      {!previewMode && (
        <div className="blocknote-hint">
          本文で <kbd>@</kbd> と入力するとページ・DB行リンクを挿入できます。
        </div>
      )}
      <BlockNoteView
        editor={editor}
        editable={editing}
        theme="light"
        slashMenu={false}
        onChange={emitChange}
      >
        {/* Use BlockNote's built-in formatting toolbar.
            The custom controller conflicted with TipTap/BlockNote mouse handlers and made toolbar buttons unresponsive. */}
        {editing && editorReady && (
          <>
            <SuggestionMenuController
              {...({
                triggerCharacter: "@",
                getItems: getMentionMenuItems,
              } as any)}
            />
            <SuggestionMenuController
              {...({
                triggerCharacter: "/",
                getItems: getSlashMenuItems,
              } as any)}
            />
          </>
        )}
      </BlockNoteView>
    </div>
  );
}
