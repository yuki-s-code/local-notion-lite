# v139 FAQ Shared Storage

## 目的

v138ではFAQ Builderの試作としてFAQを`localStorage`へ保存していました。v139では、FAQを共有すべき知識データとして扱うため、共有フォルダ側へ保存する方式に変更しました。

## 保存先

```txt
<shared-root>/smart-assist/
  ├─ faq-items.json
  ├─ faq-index.json
  └─ faq-trash.json
```

## 追加API

```txt
GET    /smart-assist/faqs
PUT    /smart-assist/faqs
POST   /smart-assist/faqs
DELETE /smart-assist/faqs/:id
```

## 動作

- FAQ本体は共有フォルダの`smart-assist/faq-items.json`に保存されます。
- FAQの質問・回答・ステータス変更は自動保存されます。
- FAQ削除時は`faq-trash.json`へ退避します。
- v138でlocalStorageに作られたFAQがあり、共有FAQが空の場合は初回表示時に自動移行します。
- localStorageは今後、画面状態や一時入力などPC個別設定に限定する方針です。

## 方針

FAQはチャット回答の根拠として複数端末で共有されるべきデータです。そのため、ページ・DB・Journalと同じように共有フォルダ管理へ寄せています。
