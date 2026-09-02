import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInitialState } from '../../packages/studio-core/index.mjs';

export async function createRepository(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const statePath = join(dataDir, 'state.json');
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    state = createInitialState();
    await persist(state);
  }

  async function persist(next) {
    const tmp = join(dataDir, `.state-${process.pid}-${randomUUID()}.tmp`);
    const payload = `${JSON.stringify(next, null, 2)}\n`;
    await writeFile(tmp, payload, 'utf8');
    await rename(tmp, statePath);
  }

  return {
    getState() { return structuredClone(state); },
    async replace(next) { await persist(next); state = structuredClone(next); return this.getState(); },
    async update(mutator) {
      const current = structuredClone(state);
      const next = await mutator(current);
      if (!next || typeof next !== 'object') throw new Error('Repository update 必须返回完整 state');
      return this.replace(next);
    },
    statePath,
  };
}
