export type StorageScope = 'private' | 'shared';

// Keep this module dependency-light while allowing callers that use WorkspaceScope.
type WorkspaceScope = StorageScope;

/** Select the storage root that matches the data owner's scope. */
export function selectScopedRoot(scope: StorageScope | undefined, sharedRoot: string, privateRoot: string): string {
  return scope === 'private' ? privateRoot : sharedRoot;
}

/** Explicit alias used by attachment tests and services. */
export function attachmentRootForScope(scope: WorkspaceScope, sharedRoot: string, privateRoot: string): string {
  return selectScopedRoot(scope, sharedRoot, privateRoot);
}
