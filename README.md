# local-notion-lite v707

V707 makes the workspace glossary operational rather than passive.

- Adds confirmation date, review deadline, owner, and evidence freshness checks
- Shows selected-term usage from local SQLite indexes only
- Adds lightweight relationship view based on shared evidence and categories
- Adds explicit, capped unregistered-term discovery from recent page titles
- Shows alias standardization candidates without automatically rewriting documents

# local-notion-lite v327

V327 adds idle-time Semantic Index diff updates.

- Adds an idle auto-update control to Workspace Semantic Index admin
- Saves idle settings in transformer settings
- Runs small `semantic/diff-update` batches only after user inactivity
- Keeps page/database/journal save operations lightweight by not generating embeddings on save
- Keeps manual 20/100/full rebuild controls


## V323 Workspace AI Search

- 右下AIフローティングボタンを追加
- 右サイドWorkspace AI Searchパネルを追加
- Cmd/Ctrl + Shift + KでAI横断検索を起動
- Command PaletteにAI横断検索を追加
- Smart Assist管理画面にAI横断検索タブを追加
- FAQ / ページ / DB行 / Journal / 資料を横断検索
- 検索結果を種類別カード表示し、クリックで対象を開く

# Local Notion Lite v29

## v288 Journal Related Panel and Counts

- Journal画面の右側タブに「関連情報」を追加しました。
- ruri-v3 Semantic Indexを使い、Journalに近いページ・FAQ・DB行・過去Journal・資料を横断表示します。
- 関連候補はAPIで最大32件取得し、サーバー側では各種別上位8件、UI初期表示は各種別上位4件です。
- 「さらに表示」で各種別上位8件まで展開できます。
- 詳細: `docs/V288_JOURNAL_RELATED_PANEL_AND_COUNTS.md`


Electron + React + Express + SQLite cache + shared-folder JSON source of truth + BlockNote editor.


## v238 Smart Assist 外部モデル運用

- 標準モデルは `Xenova/multilingual-e5-small`。
- 本番・開発ともに、モデル本体は任意フォルダに配置して管理画面から指定する。
- EXEには大型ONNXモデルを同梱せず、WASMランタイムのみ同梱する。
- 管理画面の「AIモデル」でモデルIDとモデル保存先フォルダを保存し、モデル確認後に semantic-index を再生成する。
- モデル保存先フォルダは `Xenova` の親フォルダを指定する。例: `D:\LocalNotionModels`。

```txt
D:\LocalNotionModels
  └─ Xenova
      └─ multilingual-e5-small
          ├─ config.json
          ├─ tokenizer.json
          ├─ tokenizer_config.json
          ├─ special_tokens_map.json
          └─ onnx
              └─ model_quantized.onnx
```

## v29

- タイトル入力の枠線を削除
- 本文アイコンを大きく表示
- 独自スラッシュ候補UIを削除
- 必要項目をBlockNote標準スラッシュメニューへ統合

## Run

```bash
npm install
npm run dev
```

If better-sqlite3 ABI error occurs:

```bash
npm run rebuild:native
npm run dev
```

# Local Notion Lite MVP

社内共有フォルダを正本にして、各PCのElectronアプリから利用するNotion風ローカルワークスペースのMVPです。

## v4で追加した内容

- ページツリー表示
- 子ページ作成
- 全文検索UI
- ページ複製
- ページのゴミ箱移動
- ロック中ページの表示
- 30秒ごとの自動同期
- 共有フォルダ変更ボタン
- `/pages/tree`, `/pages/search`, `/locks` API

## 基本方針

```txt
共有フォルダ
  pages/        正本データ
  attachments/  添付ファイル
  locks/        ページ単位ロック
  backups/      自動バックアップ置き場

各PC
  local.sqlite  検索・一覧表示用キャッシュ
```

SQLiteは正本ではありません。消えても共有フォルダのJSON/Markdownから再構築できる設計です。

## 起動

```bash
npm install
npm run dev
```

`better-sqlite3` のABIエラーが出た場合:

```bash
npm run rebuild:native
npm run dev
```

## Windowsビルド

```bash
npm install
npm run rebuild:native
npm run dist:win
```

`dist:win` はビルド前に Windows x64 用の DuckDB ネイティブファイル（`duckdb.node` と `duckdb.dll`）を確認します。不足している場合は、壊れたexeを作らずに停止します。

MacからWindows向け配布物を作る場合は、同梱の GitHub Actions を使ってください。macOSで `dist:win` を実行すると、Windows向けDuckDBバイナリが無いことを明示して停止します。

分析画面で最初に **同期** を成功させると、`local.sqlite` と同じフォルダへ `analysis.duckdb` が作成されます。

## 現在の制限

- 本文編集はまだ簡易Markdown textareaです。
- 同じページのリアルタイム共同編集は非対応です。
- 共同利用はページ単位ロック方式です。
- BlockNoteパッケージは依存関係に入れていますが、UIへの本格組み込みは次フェーズです。

## 次フェーズ候補

1. BlockNoteエディタへの置き換え
2. 添付ファイル管理
3. テーブルDB機能
4. バックリンク
5. 履歴・復元

## v5 追加内容

- textareaを廃止し、Notion風のローカルブロックエディタを追加しました。
- 対応ブロック: 本文、見出し1、見出し2、箇条書き、ToDo、引用、コード。
- 保存時に `blocksuite.json（互換名。v12以降はBlockNote文書を保存）` へブロック構造、`content.md` へMarkdownミラーを保存します。
- まだBlockNote本体ではありません。共有フォルダ運用の安定性を優先した中間実装です。

## v6 追加機能

- 添付ファイル追加: 編集中ページで「添付」を押すと、選択したファイルを共有フォルダの `attachments/<pageId>/` にコピーします。
- 履歴バックアップ: 保存時に直前の `meta.json` / `content.md` / `blocksuite.json（互換名。v12以降はBlockNote文書を保存）` を `backups/<pageId>/` に退避します。
- 復元: ページ下部の「履歴バックアップ」から過去版を復元できます。復元前の現行版もバックアップされます。
- 競合検知: 編集開始時点の `updatedAt` と共有フォルダ側の `updatedAt` がズレた場合、上書きせず `conflicts/` に退避します。

共有フォルダ構成は v6 で次のようになります。

```txt
YourAppVault/
  pages/
  attachments/
  locks/
  backups/
  conflicts/
  local-cache/
  manifest.json
```


## v8.1

BlockNote依存不整合により起動できない問題を避けるため、BlockNote本体への直接依存を一時的に隔離しました。既存のNotion風ブロックエディタ、共有フォルダ保存、DB、ロック、バックアップはそのまま利用できます。


## v9

データベースにビュー機能を追加しました。フィルター・ソート・ビュー保存に対応しています。詳細は `docs/V9_DATABASE_VIEWS.md` を参照してください。


## v10

ページ履歴のプレビュー、行単位差分表示、復元前確認UIを追加しました。


## v11 ゴミ箱強化

- ゴミ箱一覧を追加しました。
- ゴミ箱からの復元に対応しました。
- 完全削除に対応しました。完全削除前には `backups/deleted_*` に退避します。
- ゴミ箱を空にする操作に対応しました。
- 親ページをゴミ箱へ移動した場合、子ページもまとめてゴミ箱へ移動します。
- 親ページがゴミ箱内にある状態で子ページだけ復元した場合は、親なしページとして復元します。


## v12

BlockSuite実験モードを削除し、BlockNoteに切り替えました。React公式連携の `useCreateBlockNote` と `BlockNoteView` を使い、Notion風の編集体験を優先します。既存の共有フォルダ保存・ロック・履歴・競合退避は維持しています。


## v20

候補表示を固定オーバーレイ化し、`@` ページ候補や `/database` DB候補の表示で本文レイアウトの高さが変わらないように改善しました。


## v20

- 新規ページリンクを `📄 ページタイトル` の読みやすい表示に変更。
- 新規DB埋め込みを `🗃️ データベースタイトル` の読みやすい表示に変更。
- 旧マーカー形式も後方互換で読み取り可能。
- Notion風の余白・カード・カバー・候補パネルに調整。


## v22

サイドバーのお気に入り、ドラッグによるページ移動、同階層並び替え、BlockNote白背景固定、@リンクのインライン挿入優先を追加しました。詳細は `docs/V22_SIDEBAR_AND_BLOCKNOTE_POLISH.md` を参照してください。


## v26

- サイドバーのフィルターを折りたたみ表示に変更
- 長いページタイトルを省略表示し、視認性を改善
- 履歴バックアップをクリック時だけ表示
- 履歴プレビュー/差分が本文に被りにくいよう高さとスクロールを制御


## v63
Sidebar overflow fixes and embedded database editing.

## v285 Workspace Related Panel

v284のWorkspace Semantic EngineをBlockNoteページ右側の関連情報パネルに接続しました。

- ruri-v3ベースのSemantic Indexから関連ページ・FAQ・DB行・ジャーナル・資料を表示
- 右レール内にモダンなカード型UIとして表示
- Index未作成時はパネルから再構築可能
- UIは`WorkspaceRelatedPanel`に分離し、DB行詳細やジャーナル画面へ流用しやすい構成

詳細は `docs/V285_WORKSPACE_RELATED_PANEL.md` を参照してください。


## v286: Database Row Related Panel

- DB行詳細Drawerに ruri-v3 関連情報パネルを追加しました。
- ページだけでなく、DB行を開いた時にも関連ページ・FAQ・DB行・ジャーナル・資料を確認できます。
- `WorkspaceRelatedPanel` は `target` prop に対応し、ページ/DB行/ジャーナル/FAQで再利用できる共通コンポーネントになりました。
- 詳細: `docs/V286_DATABASE_ROW_RELATED_PANEL.md`

## v287 Related Panel Responsive Fix

- ruri-v3関連情報パネルが、リンクプレビュー表示時や狭い画面幅で消える問題を修正。
- `.page-right-utility-v105` を非表示にせず、狭い幅では本文上部のコンパクトカードとして表示。
- DB行詳細Drawerを狭くリサイズしても関連情報パネルが残るようにCSSを調整。
- 詳細: `docs/V287_RELATED_PANEL_RESPONSIVE_FIX.md`



## v289 Smart Assist 関連根拠候補

Smart Assist の回答画面に、Workspace Semantic Engine / ruri-v3 による「関連根拠候補」を追加しました。

- 回答本文は従来どおり FAQ を中心に安全に生成
- 関連候補は回答の断定根拠ではなく、確認用ナビゲーションとして表示
- ページ、FAQ、DB行、Journal、資料要約を横断して上位候補を表示
- UI表示は上位8件、低スコア候補は非表示

詳細: `docs/V289_SMART_ASSIST_RELATED_EVIDENCE.md`

## v290 Smart Assist Compact Answer UI

Smart Assist の回答カードを実務向けに整理しました。

- 常時表示は回答・信頼度・根拠FAQ・必要な確認ポイントに絞りました。
- 参考候補は初期表示を上位3件にし、残りは折りたたみにしました。
- 「関連根拠候補」は回答根拠と誤解されやすいため「参考候補」に変更しました。
- 関連質問・絞り込み・次アクションは、必要時のみ開く補助エリアにまとめました。

詳細: `docs/V290_SMART_ASSIST_COMPACT_ANSWER_UI.md`



## v292 Smart Assist Semantic Index Admin

Smart Assist管理画面に「関連Index」タブを追加しました。

このタブでは、Workspace Semantic Index の状態を確認できます。

- インデックス件数
- 最終生成日時
- 使用エンジン / モデル
- FAQ・ページ・DB行・Journal・資料の種別件数
- 状態更新
- 関連Index再生成

FAQ検索再生成はFAQ回答用、関連Index再生成はページ・DB・Journal・Smart Assistの関連表示用です。

詳細は `docs/V292_SMART_ASSIST_SEMANTIC_ADMIN.md` を参照してください。


## v293 Smart Assist Admin Scroll Fix

Smart Assist管理画面の「関連Index」タブが、画面サイズやプレビューサイズによってスクロールできず下部が見切れる問題を修正しました。

- 関連Indexタブを管理モーダル内のスクロール対象に追加
- AIモデルタブも同じスクロール対象に追加
- ヘッダー・タブ・進捗表示は固定し、タブ本文だけスクロール
- 小さい画面でも下部の運用ガイドやエラー詳細まで到達可能

詳細: `docs/V293_SMART_ASSIST_ADMIN_SCROLL_FIX.md`

## v294: 生成AIモデルフォルダ選択

Smart Assist管理画面に「生成AI」タブを追加しました。GGUFモデルはアプリ本体に同梱せず、ユーザーが任意の外部フォルダを選択して使用できます。

- 生成エンジンは標準OFF
- llama.cpp / GGUF を想定
- `.gguf` モデルをフォルダから検出
- Qwen2.5 1.5B / 3B を推奨
- 生成用途はFAQ改善案・要約・下書きから開始

詳細: `docs/V294_GENERATION_MODEL_FOLDER.md`



## v295 FAQ Generation Assist

- FAQ編集画面に「生成AIで改善案」を追加しました。
- v294の生成AI設定で `.gguf` モデルと llama 実行ファイルが確認できる場合、ローカル生成でFAQ改善案を作成します。
- 生成AIがOFFまたは未準備の場合でも、テンプレート改善案を作成できます。
- 改善案は自動保存されず、人が確認してから「検索ヒントだけ反映」または「本文も含めて反映」を選びます。

詳細: `docs/V295_FAQ_GENERATION_ASSIST.md`


## v296 - FAQ生成改善案の品質確認強化

- FAQ改善案生成で、元FAQとほぼ同じ内容が表示される問題を改善しました。
- 生成AIの出力に対して、質問類似度・回答類似度・JSON解析可否・モデル名を表示します。
- llama.cppの生出力を折りたたみで確認できるようにしました。
- プロンプトを強化し、代表質問・回答をそのままコピーしないようにしました。
- 詳細: `docs/V296_FAQ_GENERATION_QUALITY_FIX.md`

### v297 生成AI実行ファイル検証

- `llamaExecutablePath` に `.gguf` モデルを誤指定しても利用可能扱いにしないよう修正しました。
- 生成AI設定画面で `.gguf` が llama 実行ファイル欄に入っている場合、警告を表示します。
- 正しい設定は「使用モデル = `.gguf`」「llama実行ファイル = `llama-cli.exe` / `llama.exe` / `llama-cli`」です。



### v299 llama.cpp実行安定化

FAQ改善案生成で、長い日本語プロンプトをコマンドラインへ直接渡さず、一時ファイルに保存して `llama-cli -f` で実行するようにしました。Mac/Windowsでの日本語・改行・長文プロンプトの安定性を改善し、失敗時にはstderr/stdoutを含む詳細エラーを表示します。

### v300 llama prompt execution string literal fix

- v299の差分で `vaultService.ts` に混入した壊れた文字列リテラルを修正しました。
- `npm run dev` / Vite SSR build で発生していた `Unterminated string literal` を解消します。
- v299の `llama-cli -f <prompt-file>` 実行方式は維持しています。
- 詳細: `docs/V300_LLAMA_PROMPT_STRING_LITERAL_FIX.md`


## v303 llama.cpp Qwen CLI invocation fix

Qwen2.5 GGUF models now use a Qwen/llama.cpp-compatible CLI invocation by default: ChatML prompt via `-p`, special tokens via `-sp`, and no `--no-display-prompt` on the primary Qwen path. This fixes cases where Terminal generation works but the app receives an empty result.

## v341 - Database Summary Read Path

- Dashboard summary の DB 件数取得を `database_summary_index` へ変更
- DB保存時の scope check を軽量化
- Private DB ID を summary index から取得
- Private Page ID を SQLite pages.properties_json から取得
- summary index 未構築時のみ従来の full read へ fallback


## V348 Page AI Action Fix

- 右下AIのページ要約/TODO抽出で別FAQ・別ページ候補が混入する問題を修正。
- ページ要約/TODOは現在ページ本文を優先し、Semantic Search候補を混ぜない。
- 生成AI失敗時もページ本文ベースのfallback回答に変更。
- 生成AI失敗警告を短くし、llama.cpp stderrの長文表示を抑制。


## v710 Glossary edit-only correction
- Removed the unused read-only glossary decoration layer.
- The glossary now remains edit-safe: no BlockNote DOM rewriting, no MutationObserver, and no inline tooltip mutation.
- Page and database terminology continues to use the existing debounced Glossary Term Hints panel.

# local-notion-lite v712

- Fixes strict JSON import typing in the glossary CSV/JSON importer.
- Shows the supported CSV and JSON structures, including copyable-looking examples, before selection and during import preview.
