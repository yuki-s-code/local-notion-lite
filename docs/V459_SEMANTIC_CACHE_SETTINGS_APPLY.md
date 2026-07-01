# v459 Semantic cache setting apply

- Saving transformer settings now disposes the existing `SemanticIndexService` when `localCacheDir`, `modelId`, or `modelRoot` changes.
- The next index status fetch creates a service using the new local cache directory immediately; restarting the app is no longer required for this configuration change.
- The settings screen refreshes Workspace Semantic status after saving.
