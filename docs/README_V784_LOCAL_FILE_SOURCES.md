# V784 ローカルファイルソース

Web BuilderのデータパネルからJSON・CSV・HTMLファイルを読み込み、プロジェクト内で再利用できるようにしました。

## 対応形式

- JSON（配列・オブジェクト）
- CSV（引用符、カンマ入りセル、セル内改行に対応）
- HTML / HTM

## 使用方法

1. Web Builderの「データ」を開く
2. 「ファイルを読み込む」を押す
3. 読み込んだソースの「ページへ挿入」を押す

挿入されるタグ:

```html
<ln-local-source name="sample"></ln-local-source>
```

JSON・CSVの先頭レコードにある単純値は、次の形式でも参照できます。

```html
<h1>{{file.sample.title}}</h1>
```

## 実装上の方針

- プレビューとHTML/ZIP出力は同じWeb Runtimeを使用
- 旧プロジェクトは`localFileSources: []`を自動補完
- 同名ファイルは新しい内容で置換
- 1ファイル1.5MBまで
- JSON/CSVは最大200行・30列を表として描画
- HTMLはRuntimeでそのまま差し込み
