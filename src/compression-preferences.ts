import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { settingsFile } from './settings';
const writes = new Map<string, Promise<unknown>>();
export type CompressionSettings = { auto_start: boolean; concurrency: number };
function normalize(value: Partial<CompressionSettings>): CompressionSettings {
  return { auto_start: value.auto_start !== false, concurrency: Number.isInteger(value.concurrency) && value.concurrency! >= 1 && value.concurrency! <= 20 ? value.concurrency! : 5 };
}
export async function compressionPreferences(update?: boolean | Partial<CompressionSettings>, file = path.join(path.dirname(settingsFile()), 'compression-state.json')) {
  const read = async () => { try { return normalize(JSON.parse(await readFile(file, 'utf8'))); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return normalize({}); throw error; } };
  if (update !== undefined) {
    const patch = typeof update === 'boolean' ? { auto_start: update } : update;
    if (patch.concurrency !== undefined && (!Number.isInteger(patch.concurrency) || patch.concurrency < 1 || patch.concurrency > 20)) throw new Error('并发数需为 1–20 的整数');
    const task = (writes.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        const state = { ...await read(), ...patch };
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 }); await rename(temporary, file);
      } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
    });
    writes.set(file, task); try { await task; } finally { if (writes.get(file) === task) writes.delete(file); }
  }
  await writes.get(file); return read();
}
