import type { DatabaseAggregateRequest, DatabaseAggregateResult, DatabasePerformanceInfo, DatabaseQueryResult } from '../../../shared/types';

/**
 * Database index/query service boundary for SQLite-backed row search and
 * performance metadata. The implementation can be moved out of VaultService
 * independently from CRUD and lock/conflict handling.
 */
export class DatabaseIndexQueryService {
  constructor(private readonly core: any) {}

  rebuild(id: string): Promise<DatabasePerformanceInfo> { return this.core.rebuildDatabaseIndexCore(id); }
  performance(id: string): Promise<DatabasePerformanceInfo> { return this.core.getDatabasePerformanceCore(id); }
  queryRows(id: string, input: { viewId?: string; q?: string; page?: number; pageSize?: number; cursor?: string }): Promise<DatabaseQueryResult> {
    return this.core.queryDatabaseRowsCore(id, input);
  }
  aggregateRows(id: string, input: DatabaseAggregateRequest): Promise<DatabaseAggregateResult> {
    return this.core.aggregateDatabaseRowsCore(id, input);
  }
}
