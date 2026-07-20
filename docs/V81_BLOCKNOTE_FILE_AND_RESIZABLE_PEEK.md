# V81 BlockNote標準ファイル挿入 / 可変サイドピーク

- BlockNote標準のFile / Image / Video / Audio挿入を前提に、`uploadFile`で共有フォルダの`attachments`へ保存する構成を維持。
- 独自の「/ ファイルを添付」は使わない。
- 右サイドバー（サイドピーク）の左端にリサイズハンドルを追加。
- 幅はドラッグで変更でき、`localStorage`に保存される。
- 最小幅320px、最大幅は画面幅に応じて自動制限。
