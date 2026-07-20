# V291 Semantic Ranking Weighting

## Summary

V291 improves Workspace Semantic related results by separating title, body, and metadata signals instead of treating every text field as one flat search string.

The goal is to make related results more useful in actual work: if a page, FAQ, database row, or journal shares a strong title, intent, tag, database, or property relationship, it should rank above a result that is only vaguely close by semantic embedding.

## What changed

### 1. Engine version bump

The workspace semantic engine was bumped to:

```txt
workspace-semantic-ruri-v3-v2
```

This intentionally invalidates the previous workspace semantic index so the app rebuilds it with the new metadata-aware embedding text.

### 2. Metadata-aware chunks

Semantic chunks now support:

```ts
semanticMetaText?: string;
```

This field is generated from operational metadata such as:

- FAQ category / domain / intent / tags
- Page properties / title / parent page
- Database title / row title / property names and values
- Journal date / title / mood / weather / tags

### 3. Weighted ranking

Search result scoring now uses multiple signals:

```txt
semantic similarity: 58%
title match:         18%
body match:          12%
metadata match:       7%
relation boost:      up to +20
```

The relation boost is applied only when a target item exists, such as when showing related content for a page, DB row, FAQ, or journal.

Boost examples:

```txt
same FAQ intent
same database
same parent page
shared tags
shared keywords
same document type
```

### 4. Better explanations

Related results can now include:

```txt
meaning similarity
title match
metadata match
relation boost
```

The UI can show these signals without exposing too much technical detail.

## Why this matters

In work use, titles and metadata are often more reliable than pure semantic similarity.

Examples:

```txt
通勤手当
通勤経路
勤務日数
給与支給日
休暇申請
```

These may all be somewhat semantically close because they are personnel-related topics. With V291, the result that matches the title, intent, database, or properties should rank higher than a generic personnel-related result.

## Current behavior

Related panels still show the same groups:

```txt
related pages
related FAQ
related database rows
related journals
related attachments
```

The difference is ranking quality, not screen complexity.

## Recommended next step

Add a Smart Assist admin panel card for Workspace Semantic Index status:

```txt
index availability
engine version
model ID
indexed count
type counts
last generated time
rebuild button
```
