import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const failure = vi.hoisted(() => ({ rename: false, unlink: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: async (...args: Parameters<typeof actual.rename>) => { if (failure.rename) throw Object.assign(new Error('rename denied'), { code: 'EPERM' }); return actual.rename(...args); },
    unlink: async (...args: Parameters<typeof actual.unlink>) => { if (failure.unlink) throw Object.assign(new Error('unlink denied'), { code: 'EACCES' }); return actual.unlink(...args); } };
});
import { CompressionQueue } from '../src/compression';
const directories: string[] = [];
afterEach(async () => { failure.rename = failure.unlink = false; for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  await mkdir('.cache', { recursive: true }); const directory = await mkdtemp(path.resolve('.cache/compression-cleanup-')); directories.push(directory);
  const image = sharp({ create: { width: 20, height: 20, channels: 4, background: '#459eff' } });
  const input = await image.clone().png({ compressionLevel: 0 }).toBuffer(), output = await image.clone().png({ compressionLevel: 9 }).toBuffer();
  const file = path.join(directory, 'original.png'); await writeFile(file, input);
  const queue = new CompressionQueue(); const { items } = await queue.add([file]);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => options?.method === 'POST' ? Response.json({ output: { size: output.length, url: 'https://tinypng.com/backend/opt/output/test' } }) : new Response(new Uint8Array(output)));
  return { directory, file, input, queue, id: items[0].id, fetcher };
}
it('临时文件已写入但提交失败时，自动删除临时文件并保留原图', async () => {
  const { directory, file, input, queue, id, fetcher } = await fixture(); failure.rename = true;
  expect((await queue.process(id, fetcher)).status).toBe('error');
  expect(await readFile(file)).toEqual(input); expect(await readdir(directory)).toEqual(['original.png']);
});
it('清理被系统拒绝时明确显示清理失败，不能报告已完成', async () => {
  const { directory, file, input, queue, id, fetcher } = await fixture(); failure.rename = failure.unlink = true;
  expect(await queue.process(id, fetcher)).toMatchObject({ status: 'error', error: expect.stringContaining('临时文件清理失败') });
  expect(await readFile(file)).toEqual(input); expect((await readdir(directory)).filter(name => name.endsWith('.lanhu-compress.tmp'))).toHaveLength(1);
});
