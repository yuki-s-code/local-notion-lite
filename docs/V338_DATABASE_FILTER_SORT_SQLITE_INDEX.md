# V338 Database Filter / Sort SQLite Index

## 目的

v337でDB行の通常ページング・キーワード検索は `database_row_index` から返せるようになったが、ビューに filter / sort がある場合はDB JSONを全読込してJavaScript側で全行処理する経路が残っていた。

v338では、単純なfilter/sortをSQLite Indexへ寄せ、大量DBでもDB JSON全読込を避ける。

## 追加内容

- `database_row_property_index` を追加
- DB行Index再構築時に、各行×各プロパティの検索用値を保存
  - `text_value`
  - `text_value_lower`
  - `number_value`
  - `date_value`
  - `boolean_value`
  - `empty_value`
- filter/sort付きビューでも、対応可能な条件はSQLiteで処理
- 未対応条件は従来どおり安全にJSON fallback

## SQLite処理対象

対応対象:

- contains / not_contains
- equals / not_equals
- starts_with / ends_with
- greater_than / less_than
- before / after
- today / this_week / this_month / overdue
- is_empty / is_not_empty
- text / number / select / multi_select / date / checkbox / url / formula の一部

fallback対象:

- relation
- rollup
- 複雑すぎるfilter/sort
- property index未構築の既存DB

## 注意

既存DBは、DB Index再構築またはDB保存後に `database_row_property_index` が作られる。
property indexが空の場合は、従来処理へfallbackするため表示は壊れない。
