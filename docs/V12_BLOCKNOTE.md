# v12.2 BlockNote dependency fix

BlockSuite は削除し、BlockNote を本命エディタに切り替えました。

## v12.2 の修正

- `@mantine/utils` の直接依存を削除
- `@blocknote/*` を `0.51.4` に固定
- `@mantine/core` / `@mantine/hooks` を `8.3.11` に固定
- React は 18.3.1 のまま維持

`@mantine/utils` は `@mantine/core` 側の推移依存に任せます。直接指定すると存在しないバージョンを引いて `ETARGET` になることがあるためです。

## 再インストール

```bash
rm -rf node_modules package-lock.json
npm cache verify
npm install
npm run dev
```
