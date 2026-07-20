import type { WorkspaceDatabase, DatabaseAggregateRequest, DatabaseAggregateResult, DatabaseQueryResult } from "../../../../shared/types";
import type { ApiTransport } from "./transport";
export class DatabaseApi {
  constructor(private readonly transport: ApiTransport) {}
  list = () => this.transport.getJson<WorkspaceDatabase[]>("/databases");
  get = (id: string) => this.transport.getJson<WorkspaceDatabase>(`/databases/${this.transport.pathId(id)}`);
  save = (database: WorkspaceDatabase) => this.transport.putJson<WorkspaceDatabase>(`/databases/${this.transport.pathId(database.id)}`, database);
  query = (id: string, params: {viewId?:string;q?:string;page?:number;pageSize?:number}={}) => { const qs=new URLSearchParams(); Object.entries(params).forEach(([k,v])=>{ if(v!==undefined && v!=="") qs.set(k,String(v));}); return this.transport.getJson<DatabaseQueryResult>(`/databases/${this.transport.pathId(id)}/query${qs.toString()?`?${qs}`:""}`); };
  aggregate = (id:string, input:DatabaseAggregateRequest) => this.transport.postJson<DatabaseAggregateResult>(`/databases/${this.transport.pathId(id)}/aggregates`, input);
}
