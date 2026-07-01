# V122 Database View Persistence

## 目的

v121 では Database のビュー切替自体は実装済みでしたが、保存・再読み込み時に `calendar` / `gallery` / `timeline` が `table` に戻る可能性がありました。

原因はサーバー側の `normalizeDatabase()` で、保存済みビューの `type` を以下のように `board` 以外すべて `table` に丸めていたためです。

```ts
type: v.type === 'board' ? 'board' : 'table'
```

## 修正内容

- `normalizeDatabaseViewType()` を追加
- `table` / `board` / `calendar` / `gallery` / `timeline` を正しく保持
- 不正なビュータイプのみ `table` にフォールバック
- Filter operator の旧形式 `empty` / `not_empty` を `is_empty` / `is_not_empty` に正規化
- 画面側の Filter UI も保存型に合わせて `is_empty` / `is_not_empty` を使うように修正

## 期待される挙動

1. DBでCalendarビューを作成する
2. 保存する
3. アプリを閉じる、またはページ/DBを再読み込みする
4. Calendarビューのまま復元される

Gallery / Timeline も同様に、Tableへ戻らず保存されます。

## 主な変更ファイル

- `src/server/services/vaultService.ts`
- `src/renderer/src/main.tsx`
