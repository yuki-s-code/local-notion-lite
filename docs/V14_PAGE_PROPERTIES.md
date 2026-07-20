# v14 Page Properties

v14 adds Notion-like page properties while keeping BlockNote as the only page editor.

## Added properties

- Status: 未着手 / 進行中 / 確認待ち / 完了 / 保留
- Priority: Low / Mid / High
- Assignee
- Due date
- Tags

## Storage

Properties are stored in `pages/{pageId}/meta.json` under `properties`.

```json
{
  "properties": {
    "tags": ["FAQ", "重要"],
    "status": "進行中",
    "assignee": "shibata",
    "dueDate": "2026-06-30",
    "priority": "High"
  }
}
```

The local SQLite cache also has `properties_json`. Existing databases are migrated automatically with `ALTER TABLE`.
