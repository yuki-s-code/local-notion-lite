# v329 HomeDashboard DB row prop type fix

## 修正内容

- `HomeDashboard` のprops型に `onOpenDatabaseRow?: (databaseId: string, rowId: string) => void` を追加しました。
- `main.tsx` から渡している `onOpenDatabaseRow={openDatabaseRow}` と型定義を一致させました。
- v323以降のWorkspace AI Search / DB行クリック導線で追加されたpropsが、HomeDashboard側の型に未反映だった問題を修正しました。

## 対象エラー

```txt
Property 'onOpenDatabaseRow' does not exist on type ... Did you mean 'onOpenDatabase'?
```

## 備考

現時点ではHomeDashboard内でこのpropsを直接利用していませんが、親コンポーネントから共通的に渡されるナビゲーションハンドラとして受け取れるようにしています。
