# v163 Database Private / Shared Relation Guard

## 目的

BlockNoteページだけでなく、データベースにも `Private / Shared` を追加しました。

- `🌐 Shared` は共有フォルダへ保存され、他端末から見えるデータです。
- `🔒 Private` はこのPCの private-vault へ保存され、自分だけが使うデータです。

## 追加内容

1. データベース本体に `scope: "private" | "shared"` を追加
2. Shared DB / Private DB を作成可能
3. データベース上部に公開範囲切替を追加
4. サイドバーに DB の 🔒 / 🌐 表示を追加
5. 保存先を分離
   - Shared DB: `shared-root/databases`
   - Private DB: `appData/private-vault/databases`
6. SharedデータベースからPrivateデータへのRelationをブロック

## Relation安全ルール

| Relation元 | Relation先 | 結果 |
|---|---|---|
| Private | Private | OK |
| Private | Shared | OK |
| Shared | Shared | OK |
| Shared | Private | ブロック |

Shared DBからPrivate DBやPrivateページへRelationを作れないようにしています。
これは、共有フォルダ側からPrivate情報が見えてしまうことを防ぐためです。

## 既存DBの扱い

既存DBは後方互換のため、`scope` がない場合は `shared` として読み込まれます。
