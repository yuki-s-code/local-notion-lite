import type { JournalEntry, JournalSummary } from "../../../../shared/types";
import type { ApiTransport } from "./transport";
export class JournalApi { constructor(private readonly transport: ApiTransport) {} list=(month?:string)=>this.transport.getJson<JournalSummary[]>(`/journals${month?`?month=${encodeURIComponent(month)}`:""}`); get=(date:string)=>this.transport.getJson<JournalEntry>(`/journals/${this.transport.pathId(date)}`); }
