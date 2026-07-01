# V167 Build Windows Type Fix

GitHub Actions build-windowsで発生していたTypeScriptエラーを修正しました。

## 修正

- `SmartFaqRecord.sourceTitle` 参照を `sourceTitles[0]` に修正
- `TaskItem.sourcePageId` 参照を `sourceId` に修正
- `FastDatabaseRow` / `FastCell` に `api` を明示的に受け渡し
- Rollup relation IDの型ガードを明示化
- BlockNote `SuggestionMenuController` の型差異を安全に回避
- `AppBootSettings` の catch 戻り値型を明示

