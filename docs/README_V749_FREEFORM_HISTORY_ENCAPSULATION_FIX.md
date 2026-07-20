# V749 Freeform history encapsulation fix

## 修正内容

- `FreeformCanvasScreen.tsx` に残っていた旧 `historyRef` 参照を削除。
- `useFreeformBoardState` から `canUndo` / `canRedo` を公開し、画面側が履歴配列の内部実装へ直接依存しない設計へ変更。
- 画面側で未使用になった `historyIndex` の公開・分割代入を削除。
- `freeform-viewport` が同一要素へ4回指定されていた重複クラスを1件へ統合。
- `FreeformCanvasScreen.tsx` に `historyRef` / `historyIndexRef` の残存参照がないことを確認。

## 原因

V748で履歴状態を `useFreeformBoardState` に分離した際、Redoボタンのdisabled判定だけが旧ローカルRefを参照したまま残っていました。
