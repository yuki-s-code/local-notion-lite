# V748 Freeform high-value upgrade

## 実装内容

- フレーム所属を `parentFrameId` で永続化。
- フレーム移動時に内部カードをまとめて移動。
- カード移動終了時に所属フレームを再判定。
- 新規カードをフレーム内へ追加した場合も所属を自動設定。
- 接続線をノード中心ではなく上下左右の最適アンカーへ接続。
- 接続線へ矢印、選択判定、削除、色、太さ、破線、ラベルを追加。
- 接続線描画とミニマップを memo 化した独立コンポーネントへ分離。
- ミニマップを Enter / Space でも操作可能に改善。
- ペン入力中の React state 更新を requestAnimationFrame 単位に制限。
- ボード本体を localStorage に加えて IndexedDB にもミラー保存。
- IndexedDB を assets / boards の2ストア構成へ更新。
- 同一ノード要素に `freeform-node` が4回指定されていた重複を削除。
- DBカードの「開く」で `onOpenDatabase()` が2回実行されていた重複呼び出しを削除。

## 互換性

- 既存の localStorage 保存キーは維持。
- 旧ノードに `parentFrameId` がなくても読み込み可能。
- 旧接続線に装飾情報がなくても既定値で補完。
- 画像用 IndexedDB はDBバージョン2へ自動アップグレード。

## 検証

- TypeScript transpile syntax check: 6編集ファイル成功。
- CSS structure check: 15ファイル成功。
- `freeform-node freeform-node` 重複なし。
- DBを開く関数の隣接二重呼び出し解消。
- 全Rendererコードのトップレベル同名宣言候補を確認。
