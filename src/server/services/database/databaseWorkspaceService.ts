import type { DatabaseAggregateRequest, DatabaseAggregateResult, DatabasePerformanceInfo, DatabasePropertyType, DatabaseQueryResult, WorkspaceDatabase, WorkspaceScope } from '../../../shared/types';
import { DatabaseCrudService } from './databaseCrudService';
import { DatabaseIndexQueryService } from './databaseIndexQueryService';

/**
 * Database-domain facade extracted from VaultService.
 *
 * V254 splits the database domain into CRUD and index/query sub-services so the
 * remaining legacy VaultService `*Core` implementations can be moved out one by
 * one without touching app.ts or renderer API contracts.
 */
export class DatabaseWorkspaceService {
  private readonly crud: DatabaseCrudService;
  private readonly indexQuery: DatabaseIndexQueryService;

  constructor(private readonly core: any) {
    this.crud = new DatabaseCrudService(core);
    this.indexQuery = new DatabaseIndexQueryService(core);
  }

  listDatabases(): Promise<WorkspaceDatabase[]> { return this.crud.list(); }
  listTrashedDatabases(): Promise<WorkspaceDatabase[]> { return this.crud.listTrashed(); }
  getDatabase(id: string): Promise<WorkspaceDatabase | null> { return this.crud.get(id); }
  createDatabase(title?: string, scope?: WorkspaceScope): Promise<WorkspaceDatabase> { return this.crud.create(title, scope); }
  saveDatabase(input: WorkspaceDatabase): Promise<WorkspaceDatabase> { return this.crud.save(input); }
  addDatabaseRow(id: string): Promise<WorkspaceDatabase> { return this.crud.addRow(id); }
  addDatabaseProperty(id: string, name: string, type: DatabasePropertyType): Promise<WorkspaceDatabase> { return this.crud.addProperty(id, name, type); }
  deleteDatabase(id: string): Promise<{ ok: true; id: string }> { return this.crud.moveToTrash(id); }
  restoreTrashedDatabase(id: string): Promise<WorkspaceDatabase> { return this.crud.restore(id); }
  deleteTrashedDatabasePermanently(id: string): Promise<{ ok: true; id: string; deletedRowIds: string[] }> { return this.crud.deletePermanently(id); }
  emptyTrashedDatabases(): Promise<{ ok: true; deletedIds: string[]; failedIds: string[] }> { return this.crud.emptyTrash(); }
  rebuildDatabaseIndex(id: string): Promise<DatabasePerformanceInfo> { return this.indexQuery.rebuild(id); }
  getDatabasePerformance(id: string): Promise<DatabasePerformanceInfo> { return this.indexQuery.performance(id); }
  queryDatabaseRows(id: string, input: { viewId?: string; q?: string; page?: number; pageSize?: number; cursor?: string }): Promise<DatabaseQueryResult> { return this.indexQuery.queryRows(id, input); }
  aggregateDatabaseRows(id: string, input: DatabaseAggregateRequest): Promise<DatabaseAggregateResult> { return this.indexQuery.aggregateRows(id, input); }
}
