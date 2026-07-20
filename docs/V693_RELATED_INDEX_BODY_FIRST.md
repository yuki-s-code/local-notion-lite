# v693: Related Index — body-first ranking

## Purpose

Related recommendations now prioritize similarity of the document body rather than similarity of page titles.

## Changes

- Embedding input contains the title once only; the duplicate title section was removed.
- More of the embedding input budget is reserved for body text.
- Related queries sample body passages first and append the title only as a compact disambiguator.
- Related-panel reranking uses body lexical evidence more heavily than title overlap.
- Title-only matches need stronger evidence before appearing in passive recommendations.
- The embedding profile is part of the text hash, so a Semantic Index diff rebuild progressively replaces legacy title-weighted vectors.

## Operation after update

Run a Semantic Index diff update (or a full rebuild) once after deploying this version. The diff screen should report existing chunks as changed because their embedding profile has been updated.

Explicit workspace search retains its prior balanced ranking profile; the body-first adjustment applies only to passive related recommendations.
