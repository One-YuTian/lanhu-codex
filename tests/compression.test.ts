import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, link } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { CompressionQueue, compressImage, validateImage } from '../src/compression';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  await mkdir('.cache', { recursive: true });
  const directory = await mkdtemp(path.resolve('.cache/compression-')); directories.push(directory);
  const image = sharp({ create: { width: 20, height: 20, channels: 4, background: '#489afe' } });
  const input = await image.clone().png({ compressionLevel: 0 }).toBuffer();
  const output = await image.clone().png({ compressionLevel: 9 }).toBuffer();
  const file = path.join(directory, '原图.png'); await writeFile(file, input);
  const queue = new CompressionQueue(); const added = await queue.add([file]);
  return { directory, file, input, output, queue, id: added.items[0].id };
}
function provider(output: Buffer, options: { size?: number; url?: string; download?: () => Promise<Response> } = {}) {
  return vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') return Response.json({ output: { size: options.size ?? output.length, url: options.url ?? 'https://tinypng.com/web/output/test-only' } });
    return options.download ? options.download() : new Response(new Uint8Array(output), { headers: { 'content-length': String(output.length) } });
  });
}
it('递归扫描所有支持扩展名，重复路径和硬链接只添加一次，同名不同目录保留', async () => {
  const { directory, input, queue } = await fixture();
  await mkdir(path.join(directory, 'nested'));
  for (const name of ['a.JPG', 'b.jpeg', 'c.webp', 'ignored.svg']) await writeFile(path.join(directory, 'nested', name), input);
  await writeFile(path.join(directory, 'nested/原图.png'), input);
  await link(path.join(directory, '原图.png'), path.join(directory, 'linked.png'));
  const added = await queue.add([directory, path.join(directory, 'nested'), 'relative.png', path.join(directory, 'missing')]);
  expect(added.items).toHaveLength(5); expect(added.duplicates).toBeGreaterThan(1); expect(added.errors).toHaveLength(2);
  expect(added.items.filter(item => item.name === '原图.png')).toHaveLength(2);
});
it('完整下载后才同名替换，删除临时文件并记录体积和阶段', async () => {
  const { file, input, output, directory, queue, id } = await fixture();
  const fetcher = provider(output, { download: async () => {
    expect(await readFile(file)).toEqual(input); expect(queue.snapshot()[0].status).toBe('downloading');
    return new Response(new Uint8Array(output));
  } });
  const result = await queue.process(id, fetcher);
  expect(result).toMatchObject({ status: 'done', originalSize: input.length, size: output.length, name: '原图.png' });
  expect(await readFile(file)).toEqual(output); expect(await readdir(directory)).toEqual(['原图.png']);
  expect(await sharp(await readFile(file)).metadata()).toMatchObject({ format: 'png', width: 20, height: 20 });
  expect(fetcher.mock.calls[0][1]?.headers).toHaveProperty('X-Forwarded-For');
});
it.each(['截断', '流中断', '损坏图片', '错误类型', '不可信下载域名', 'HTTP 失败'])('%s 保留原图且不留下临时文件', async mode => {
  const { file, input, output, directory, queue, id } = await fixture();
  let fetcher = provider(output);
  if (mode === '截断') fetcher = provider(output.subarray(0, -4), { size: output.length });
  if (mode === '流中断') fetcher = provider(output, { download: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(output.subarray(0, 10))); controller.error(new Error('connection reset')); } })) });
  if (mode === '损坏图片') { const corrupt = Buffer.from(output); corrupt[45] ^= 0xff; fetcher = provider(corrupt); }
  if (mode === '错误类型') fetcher = provider(Buffer.from('<html>gateway error</html>'));
  if (mode === '不可信下载域名') fetcher = provider(output, { url: 'https://example.com/web/output/data' });
  if (mode === 'HTTP 失败') fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Rate limit', { status: 429 }));
  expect(await queue.process(id, fetcher)).toMatchObject({ status: 'error' });
  expect(await readFile(file)).toEqual(input); expect(await readdir(directory)).toEqual(['原图.png']);
});
it('下载时外部修改原图则取消提交，保留外部修改内容', async () => {
  const { file, output, queue, id, directory } = await fixture();
  const edited = Buffer.from('external edit');
  const result = await queue.process(id, provider(output, { download: async () => { await writeFile(file, edited); return new Response(new Uint8Array(output)); } }));
  expect(result).toMatchObject({ status: 'error', error: expect.stringContaining('外部修改') });
  expect(await readFile(file)).toEqual(edited); expect(await readdir(directory)).toEqual(['原图.png']);
});
it('无体积收益保留原图，完成项不重复上传，失败项可以重试', async () => {
  const { file, input, output, queue, id } = await fixture();
  const failed = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
  expect((await queue.process(id, failed)).status).toBe('error');
  const fetcher = provider(input);
  expect((await queue.process(id, fetcher)).status).toBe('unchanged');
  expect(await readFile(file)).toEqual(input);
  await queue.process(id, provider(output)); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('同一文件并发处理被拒绝，处理中不能移除，队列移除不删除磁盘文件', async () => {
  const { file, output, queue, id } = await fixture();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const processing = queue.process(id, provider(output, { download: async () => { await barrier; return new Response(new Uint8Array(output)); } }));
  await expect(queue.process(id, provider(output))).rejects.toThrow('正在处理');
  expect(queue.remove([id])).toHaveLength(1); release(); await processing;
  expect(queue.remove([id])).toEqual([]); expect((await readFile(file)).length).toBe(output.length);
});
it('硬链接不原地替换，超大文件在上传前拒绝', async () => {
  const { file, directory, queue, id, output } = await fixture();
  const fetcher = provider(output); await link(file, path.join(directory, 'alias.png'));
  expect((await queue.process(id, fetcher)).error).toContain('硬链接'); expect(fetcher).not.toHaveBeenCalled();
  await expect(compressImage(Buffer.alloc(5_200_001), 'large.png', () => {}, fetcher)).rejects.toThrow('上限');
});
it.each(['jpg', 'jpeg', 'webp'])('保持 %s 格式及原名，拒绝截断容器', async extension => {
  const { directory } = await fixture();
  const image = sharp({ create: { width: 32, height: 32, channels: 3, background: '#4888cc' } });
  const input = extension === 'webp' ? await image.clone().webp({ lossless: true }).toBuffer() : await image.clone().jpeg({ quality: 100 }).toBuffer();
  const output = extension === 'webp' ? await image.clone().webp({ quality: 20 }).toBuffer() : await image.clone().jpeg({ quality: 20 }).toBuffer();
  validateImage(input, `test.${extension}`); expect(() => validateImage(output.subarray(0, -3), `test.${extension}`)).toThrow();
  const file = path.join(directory, `保持原名.${extension}`); await writeFile(file, input);
  const queue = new CompressionQueue(); const { items } = await queue.add([file]); const result = await queue.process(items[0].id, provider(output));
  expect(['done', 'unchanged']).toContain(result.status); expect(result.path).toBe(file);
  expect((await sharp(await readFile(file)).metadata()).format).toBe(extension === 'webp' ? 'webp' : 'jpeg');
});
it.runIf(process.env.LANHU_TEST_TINYPNG === '1').each(['png', 'jpg', 'jpeg', 'webp'])('真实 TinyPNG 服务生成 %s 图片冒烟测试', async extension => {
  const { directory } = await fixture();
  const image = sharp({ create: { width: 20, height: 20, channels: 4, background: '#489afe' } });
  const input = extension === 'png' ? await image.clone().png({ compressionLevel: 0 }).toBuffer() : extension === 'webp' ? await image.clone().webp({ quality: 100 }).toBuffer() : await image.clone().jpeg({ quality: 100 }).toBuffer();
  const file = path.join(directory, `实际接口.${extension}`); await writeFile(file, input);
  const queue = new CompressionQueue(); const { items } = await queue.add([file]);
  const result = await queue.process(items[0].id);
  expect(result.error).toBeUndefined(); expect(['done', 'unchanged']).toContain(result.status);
  expect((await sharp(await readFile(file)).metadata()).width).toBe(20);
  console.log(`TinyPNG smoke: ${result.status}, ${input.length} -> ${result.size} bytes`);
}, 150_000);

it('任务进度按阶段及下载字节递增，完成状态带较新版本避免旧轮询覆盖', async () => {
  const { queue, id, output } = await fixture(); const seen: number[] = [], revisions: number[] = [];
  const fetcher = provider(output, { download: async () => {
    const bytes = new Uint8Array(output), half = Math.floor(bytes.length / 2);
    return new Response(new ReadableStream({ async start(controller) {
      controller.enqueue(bytes.subarray(0, half));
      await new Promise(resolve => setTimeout(resolve, 10));
      seen.push(queue.snapshot()[0].progress!); revisions.push(queue.snapshot()[0].revision!);
      controller.enqueue(bytes.subarray(half)); controller.close();
    } }), { headers: { 'content-length': String(output.length) } });
  } });
  const before = queue.snapshot()[0].revision!; const result = await queue.process(id, fetcher);
  expect(seen[0]).toBeGreaterThan(50); expect(seen[0]).toBeLessThan(88);
  expect(result).toMatchObject({ status: 'done', progress: 100 });
  expect(revisions[0]).toBeGreaterThan(before); expect(result.revision).toBeGreaterThan(revisions[0]);
});
