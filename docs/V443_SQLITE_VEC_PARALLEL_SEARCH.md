# v443 sqlite-vec parallel semantic search

## Goal
Use `sqlite-vec` only as a local, regenerable acceleration layer for workspace semantic retrieval. The shared JSON Semantic Index remains the source of truth and existing JavaScript cosine search remains the compatibility fallback.

## Storage
`workspace-semantic-cache.sqlite` now keeps:

- `workspace_semantic_items`: existing searchable metadata and JSON embeddings
- `workspace_semantic_vec_map`: item id, hash, model, dimension, and vec0 row id
- `workspace_semantic_vec_<dimension>`: local `vec0` virtual table

The vector table is never placed in the shared folder.

## Update behavior
After a successful full/diff index write, only changed, new, or removed chunks change vector rows. Unchanged hashes retain their existing vec0 rows. A model or dimension change recreates the local vec0 table.

## Search behavior
1. Create the query embedding as before.
2. Attempt sqlite-vec KNN retrieval for a generous candidate pool.
3. Preserve existing tag/title/body/meta reranking for those candidates.
4. If the extension cannot load, the vector table is missing, or any SQL query fails, automatically use the prior JavaScript full-scan cosine search.

## Packaging
`sqlite-vec` must be installed as a production dependency. It publishes platform-specific optional packages, including Windows x64. Validate a Windows packaged build before enabling it as the default acceleration path.

## Verification completed in the development environment
- sqlite-vec v0.1.9 loaded successfully with Node's local SQLite test connection.
- vec0 insert, KNN query, map join, and row deletion were verified with 3-dimensional test vectors.
- Modified TypeScript and TSX files were transpiled for syntax checking.

## Required first run after upgrade
Run one Semantic Index diff update or full rebuild. This populates the local vec0 table from existing embeddings. Until then, searches continue with the JavaScript fallback.
