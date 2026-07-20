# V762 Google Calendar / Drive差分同期

## 追加
- OAuthスコープにGoogle Calendar読み取りを追加
- カレンダー一覧と期間指定イベント取得
- Calendar予定をホワイトボードノードとして追加
- Drive Changes APIによる差分同期
- ホワイトボード上のDriveカードの名称・更新日時・削除状態を差分更新
- Google Calendar Plugin登録

## 既存利用者
V761以前にGoogle認証済みの場合はCalendar権限がないため、Calendarタブの「再認証する」を実行する。

## 安全性
- Calendarは読み取り専用
- Driveも読み取り専用
- OAuthトークンはMain Processに保持
- Rendererにはアクセストークンを渡さない
- Drive差分トークンのみRendererのlocalStorageへ保存
