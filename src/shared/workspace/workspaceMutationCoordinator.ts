import { createWorkspaceMutationDetail, type WorkspaceMutationDetail } from "./workspaceMutation";

export type SemanticRefreshTarget = {
  targetKey: string;
  preferredChunkId: string;
};

const uniqueTargets = (targets: ReadonlyArray<SemanticRefreshTarget>) => {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const targetKey = String(target?.targetKey || "").trim();
    const preferredChunkId = String(target?.preferredChunkId || "").trim();
    if (!targetKey || !preferredChunkId) return false;
    const key = `${targetKey}\u0000${preferredChunkId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((target) => ({
    targetKey: String(target.targetKey).trim(),
    preferredChunkId: String(target.preferredChunkId).trim(),
  }));
};

/**
 * Single renderer-side publish boundary for workspace writes.
 * Mutation identity and semantic refresh requests are emitted together so write
 * surfaces cannot update one cache while silently missing the other. Events stay
 * synchronous because workspace tab fallback selection relies on that behavior.
 */
export class WorkspaceMutationCoordinator {
  publish(
    input: Partial<WorkspaceMutationDetail> & { kind: WorkspaceMutationDetail["kind"] },
    semanticTargets: ReadonlyArray<SemanticRefreshTarget> = [],
  ): WorkspaceMutationDetail {
    const detail = createWorkspaceMutationDetail(input);
    if (typeof window === "undefined") return detail;

    window.dispatchEvent(new CustomEvent("local-notion:workspace-graph-mutated", { detail }));
    window.dispatchEvent(new CustomEvent("local-notion:workspace-data-mutated", { detail }));
    this.requestSemanticRefresh(semanticTargets);
    return detail;
  }

  requestSemanticRefresh(targets: ReadonlyArray<SemanticRefreshTarget>): void {
    if (typeof window === "undefined") return;
    for (const target of uniqueTargets(targets)) {
      window.dispatchEvent(
        new CustomEvent("local-notion:semantic-refresh-request", { detail: target }),
      );
    }
  }

  pageTarget(pageId: string): SemanticRefreshTarget {
    const id = String(pageId || "").trim();
    return { targetKey: `page::${id}`, preferredChunkId: `page:${id}` };
  }

  databaseRowTarget(databaseId: string, rowId: string): SemanticRefreshTarget {
    const database = String(databaseId || "").trim();
    const row = String(rowId || "").trim();
    return {
      targetKey: `database_row:${database}:${row}`,
      preferredChunkId: `database_row:${database}:${row}`,
    };
  }
}

export const workspaceMutationCoordinator = new WorkspaceMutationCoordinator();
