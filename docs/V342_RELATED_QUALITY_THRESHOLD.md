# V342 Related Information Quality Threshold

関連情報パネルで、低一致候補が候補数合わせで大量表示される問題を抑制した。

## 変更点

- Workspace Semantic Related の表示候補に品質ゲートを追加
- 関連情報では通常検索より厳しめに判定
- score / semanticScore / titleScore / lexicalScore / metaScore / relationBoost を総合して、根拠の弱い候補を非表示
- attachment_summary は通常候補より少し厳しめに判定
- 非表示件数をレスポンスと画面に表示
- `groupRelated()` の重複 `target` プロパティも修正

## 方針

- Workspace AI Search の直接検索は広めに維持
- 右サイドの「関連情報」は受動表示なので厳しめにする
- 候補がない場合は無理に低一致候補を出さない

