import type { DatabasePropertyType, WorkspaceDatabase, WorkspaceScope } from '../../../shared/types';

/**
 * Database CRUD service boundary.
 *
 * The heavy implementation is still provided by the legacy VaultService core
 * methods while the refactor is in progress, but the public workspace service
 * now delegates CRUD responsibilities here instead of calling the core directly.
 * This lets the implementation move method-by-method without changing API
 * routes or renderer contracts.
 */
export class DatabaseCrudService {
  constructor(private readonly core: any) {}

  list(): Promise<WorkspaceDatabase[]> { return this.core.listDatabasesCore(); }
  listTrashed(): Promise<WorkspaceDatabase[]> { return this.core.listTrashedDatabasesCore(); }
  get(id: string): Promise<WorkspaceDatabase | null> { return this.core.getDatabaseCore(id); }
  create(title?: string, scope?: WorkspaceScope): Promise<WorkspaceDatabase> { return this.core.createDatabaseCore(title, scope); }
  save(input: WorkspaceDatabase): Promise<WorkspaceDatabase> { return this.core.saveDatabaseCore(input); }
  addRow(id: string): Promise<WorkspaceDatabase> { return this.core.addDatabaseRowCore(id); }
  addProperty(id: string, name: string, type: DatabasePropertyType): Promise<WorkspaceDatabase> { return this.core.addDatabasePropertyCore(id, name, type); }
  moveToTrash(id: string): Promise<{ ok: true; id: string }> { return this.core.deleteDatabaseCore(id); }
  restore(id: string): Promise<WorkspaceDatabase> { return this.core.restoreTrashedDatabaseCore(id); }
  deletePermanently(id: string): Promise<{ ok: true; id: string }> { return this.core.deleteTrashedDatabasePermanentlyCore(id); }
  emptyTrash(): Promise<{ ok: true; deletedIds: string[]; failedIds: string[] }> { return this.core.emptyTrashedDatabasesCore(); }
}
