import fs from 'fs-extra';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { createAtomicTempPath } from '../../shared/persistence/atomicPath';

export function atomicTempPath(file: string, instanceId = String(process.pid)): string {
  return createAtomicTempPath(file, instanceId, Date.now(), nanoid(6));
}

export async function atomicWriteText(file: string, data: string, instanceId?: string): Promise<void> {
  await fs.ensureDir(path.dirname(file));
  const tmp = atomicTempPath(file, instanceId);
  await fs.writeFile(tmp, data, 'utf8');
  await fs.move(tmp, file, { overwrite: true });
}

export async function atomicWriteJson(file: string, data: unknown, instanceId?: string): Promise<void> {
  await atomicWriteText(file, JSON.stringify(data, null, 2), instanceId);
}
