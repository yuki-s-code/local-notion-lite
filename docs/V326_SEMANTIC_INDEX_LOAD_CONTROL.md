# v326 Semantic Index Load Control

## 目的

Ruri-v3 / Workspace Semantic Index の対象が FAQ、ページ本文、Journal本文、DB行の文章プロパティまで広がったため、保存時や再生成時に重くならないよう負荷制御を追加した。

## 方針

- ページ・DB行・Journal保存時には embedding 生成を走らせない。
- Semantic Index は管理画面から手動で差分更新する。
- 変更がないチャンクは既存 embedding を再利用する。
- 変更・新規チャンクだけを embedding 対象にする。
- 差分更新では 1回あたりの新規/変更 embedding 件数に上限を設ける。

## 追加内容

### サーバー

- `SemanticIndexService.estimateDiff()` を追加。
- `buildIndex()` に `maxNewEmbeddings` を追加。
- 変更分が上限を超えた場合、既存 embedding があるチャンクは一時的に前回 embedding を保持し、次回差分更新の対象として残す。
- `POST /semantic/diff-update` を追加。
- `POST /semantic/reindex` は `mode: full | diff` を受け取れるように変更。
- `GET /semantic/index` に差分情報を追加。

### UI

Smart Assist > 関連Index に以下を追加。

- 更新待ち件数
- 再利用可能件数
- 新規/変更件数
- 削除検知件数
- 差分更新 20件
- 差分更新 100件
- 全件再生成

## 運用目安

- 日常運用: `差分更新 20件`
- 大量取込後: `差分更新 100件` を数回
- モデル変更・キャッシュ破損時: `全件再生成`

## 注意

SQLiteキャッシュは正本ではなく再構築可能な高速キャッシュ。共有フォルダ上の正本データは従来どおり保持する。
