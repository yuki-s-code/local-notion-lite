# V774 Workspace Foundation

## 方針

ページとデータベースのタブは、既存の `WorkspaceWorkbench` が引き続き唯一の所有者です。V774のWorkspace基盤は、そのタブを再実装・複製せず、`documents` という単一の画面パネルとして扱います。

- ページ・データベース: `tabOwnership: "screen"`
- Web Builder・ホワイトボード等: `tabOwnership: "workspace"`
- ホーム等: `tabOwnership: "none"`

これにより、将来DockViewを導入しても「外側のWorkspaceタブ」と「内側のページ・DBタブ」が競合しません。

## 追加

- `workspace/types.ts`: Workspace画面とタブ所有権
- `workspace/registry.ts`: Screen Registry
- `workspace/storage.ts`: バージョン付きlocalStorage共通層
- `workspace/session.ts`: アクティブ画面・最近使った画面の保存
- `workspace/mainModeBridge.ts`: 既存mainModeからWorkspace画面への変換

## 変更

- `WorkspaceWorkbench` の保存を共通ストレージ層へ移行
- 既存キーから新キーへ自動移行
- `main.tsx` は現在のWorkspace画面を記録
- editor paneに画面IDとタブ所有権を付与

## 非重複設計

ページ・DBの文書タブ配列は `WorkspaceWorkbench` だけが保持します。Workspace Sessionは画面単位の履歴しか保持せず、ページID・DB ID・ピン留め・閉じたタブを複製しません。
