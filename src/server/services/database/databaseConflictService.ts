import fs from 'fs-extra';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { sanitizeSegment, vaultPaths } from '../../utils/paths';
import type { WorkspaceDatabase } from '../../../shared/types';

export class DatabaseConflictService {
  constructor(
    private sharedRoot: string,
    private userLabel: () => string,
  ) {}

  async writeSnapshot(input: WorkspaceDatabase, current: WorkspaceDatabase, reason: string): Promise<void> {
    const paths = vaultPaths(this.sharedRoot);
    const conflictId = `database_${sanitizeSegment(input.id)}_${Date.now()}_${nanoid(6)}`;
    const conflictDir = path.join(paths.conflicts, conflictId);
    await fs.ensureDir(conflictDir);
    await this.atomicWriteJson(path.join(conflictDir, 'incoming-database.json'), input);
    await this.atomicWriteJson(path.join(conflictDir, 'current-database.json'), current);
    await this.atomicWriteJson(path.join(conflictDir, 'meta.json'), {
      id: conflictId,
      databaseId: input.id,
      createdAt: new Date().toISOString(),
      createdBy: this.userLabel(),
      reason,
      incomingBaseUpdatedAt: (input as any).baseUpdatedAt ?? null,
      currentUpdatedAt: current.updatedAt ?? null,
    });
  }

  private async atomicWriteJson(file: string, data: unknown): Promise<void> {
    await fs.ensureDir(path.dirname(file));
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeJson(tmp, data, { spaces: 2 });
    await fs.move(tmp, file, { overwrite: true });
  }
}
