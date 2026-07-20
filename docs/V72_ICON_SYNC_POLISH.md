# v72 icon sync polish

- v72-sidebar-polish をベースに、エディター上部・データベース上部の明確な操作をアイコン中心に整理。
- 説明は `title` / `aria-label` に残し、画面上の文字量を削減。
- BlockNote本文内のローカルページリンクは `page_id` を正として、ページタイトル変更時に表示名を再同期。
- 旧形式 `@[[タイトル|page_id]]`、`#local-page=`、`local-page://` の互換読み込みは維持。
