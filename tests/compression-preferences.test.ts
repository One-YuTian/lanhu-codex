import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compressionPreferences } from '../src/compression-preferences';
import { CompressionQueue } from '../src/compression';
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function directory() { await mkdir('.cache', { recursive: true }); const result = await mkdtemp(path.resolve('.cache/compression-settings-')); directories.push(result); return result; }
it('自动压缩默认开启，显式关闭跨读取保留且设置临时文件被清理', async () => {
  const root = await directory(), file = path.join(root, 'state.json');
  expect(await compressionPreferences(undefined, file)).toEqual({ auto_start: true, concurrency: 5 });
  await compressionPreferences(true, file);
  expect(await compressionPreferences(undefined, file)).toEqual({ auto_start: true, concurrency: 5 });
  await compressionPreferences(false, file);
  expect(await compressionPreferences(undefined, file)).toEqual({ auto_start: false, concurrency: 5 });
  expect(await readdir(root)).toEqual(['state.json']);
});
it('并发设置按顺序保存，未知旧配置使用新的默认值', async () => {
  const root = await directory(), file = path.join(root, 'state.json');
  await Promise.all([compressionPreferences(true, file), compressionPreferences(false, file)]);
  expect(await compressionPreferences(undefined, file)).toEqual({ auto_start: false, concurrency: 5 });
  await writeFile(file, '{"auto_start":"true"}');
  expect(await compressionPreferences(undefined, file)).toEqual({ auto_start: true, concurrency: 5 });
});
it('预览仅读取已入队图片，不处理任务、不生成文件，超限拒绝', async () => {
  const root = await directory(), file = path.join(root, 'sample.png'), bytes = Buffer.from('preview fixture');
  await writeFile(file, bytes); const queue = new CompressionQueue(); const { items } = await queue.add([file]);
  expect(await queue.preview(items[0].id)).toEqual(bytes);
  expect(queue.snapshot()[0].status).toBe('waiting');
  expect(await readFile(file)).toEqual(bytes); expect(await readdir(root)).toEqual(['sample.png']);
  await expect(queue.preview('not-in-queue')).rejects.toThrow('不在列表');
  await writeFile(file, Buffer.alloc(5_200_001));
  await expect(queue.preview(items[0].id)).rejects.toThrow('不支持预览');
});

it('部分更新保留另一设置，旧配置补足默认并发 5', async () => {
 const root = await directory(), file = path.join(root, 'state.json');
 await writeFile(file, '{"auto_start":false}');
 expect(await compressionPreferences(undefined,file)).toEqual({ auto_start:false, concurrency:5 });
 await compressionPreferences({ concurrency:3 },file);
 expect(await compressionPreferences(undefined,file)).toEqual({ auto_start:false, concurrency:3 });
 await compressionPreferences({ auto_start:true },file);
 expect(await compressionPreferences(undefined,file)).toEqual({ auto_start:true, concurrency:3 });
 await expect(compressionPreferences({ concurrency:0 },file)).rejects.toThrow('1–20');
 await expect(compressionPreferences({ concurrency:1.5 },file)).rejects.toThrow('1–20');
});
