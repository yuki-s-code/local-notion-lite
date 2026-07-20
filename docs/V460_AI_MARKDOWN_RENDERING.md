# v460 AI回答Markdown表示

Smart AssistとWorkspace AI検索の回答表示を、プレーンテキストの`pre` / 改行段落から、安全なMarkdown描画へ置換しました。

- 対応: 見出し、太字・斜体・取り消し線、インラインコード、コードブロック、箇条書き、番号付きリスト、タスク、引用、水平線、表、HTTP/HTTPS・mailtoリンク。
- AI本文はHTMLとして挿入しない。モデル出力中のHTML / scriptは実行されない。
- 外部Markdownライブラリは追加せず、既存のElectron配布依存を増やさない。
