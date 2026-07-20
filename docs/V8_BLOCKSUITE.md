# v8.1 BlockSuite dependency isolation

v8で `@blocksuite/presets` / `@blocksuite/icons` 周辺の依存不整合によりViteの依存スキャンが停止したため、v8.1ではBlockSuite本体への直接依存を一度外しています。

## 方針

- アプリ全体の起動を最優先
- 共有フォルダ保存、ロック、バックアップ、競合退避は維持
- BlockSuite画面は安全プレビューにフォールバック
- 次版でBlockSuite関連パッケージを固定バージョンで再導入

## 理由

BlockSuiteはパッケージ間のバージョン整合が重要です。`@blocksuite/presets` が参照するCSSエクスポートやiconsの名前が、インストールされた依存と一致しない場合、実行時ではなくViteの起動時に停止します。
