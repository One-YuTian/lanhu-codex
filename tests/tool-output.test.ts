import { expect, it, vi } from 'vitest';
import { compactToolOutput, designElements } from '../src/tool-output';
import { readFile, mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadSlices } from '../skills/lanhu-slice-assets/scripts/download-slices.mjs';

it('过滤重复图层快照，保留样式、分页终止值且不修改画布源数据', () => {
  const source = { next_offset: null, layers: [{ id: 1, sliceBackData: 'large tree', generatorSettings: false,
    text: '你好', style: { fontSize: 24, opacity: 0, visible: false }, images: { png: 'signed-url' } }], members: [{ name: 'user' }] };
  expect(compactToolOutput(source)).toEqual({ next_offset: null, layers: [{ id: 1, text: '你好',
    style: { fontSize: 24, opacity: 0, visible: false }, images: { png: 'signed-url' } }] });
  expect(source.layers[0].sliceBackData).toBe('large tree');
});

it('PS 图层结构可精确读取标记对象，保留画板偏移，未命中不回退其他层', async () => {
  const source = JSON.parse(await readFile('tests/fixtures/photoshop-elements.json', 'utf8'));
  const result = designElements(source, ['775', 'missing']);
  expect(result.missing_ids).toEqual(['missing']);
  expect(result.elements).toHaveLength(1);
  expect(result.elements[0]).toMatchObject({ id: '775', parent_id: '284', name: 'finger' });
  expect(result.elements[0]).not.toHaveProperty('sliceBackData');
  expect(result.elements[0]).not.toHaveProperty('layers');
  expect(designElements(source, ['284']).elements[0]).toHaveProperty('artboard.artboardRect.left', 1778);
});

it('默认导出真实 WebP，仅保存图片，不生成 JSON，保留缩放和签名参数', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lanhu-slices-'));
  const webp = Buffer.from('RIFF0000WEBPfixture');
  const fetcher = vi.fn(async () => new Response(webp));
  const item = { slice_id: '775', name: 'finger', url: 'https://alipic.lanhuapp.com/a?signature=test&x-oss-process=image/resize,w_100/format,png', filename: 'hand.png' };
  try {
    expect(await downloadSlices([item], root, fetcher)).toMatchObject([{ status: 'saved', filename: 'hand.webp' }]);
    expect(await readFile(path.join(root, 'hand.webp'))).toEqual(webp);
    expect(await readdir(root)).toEqual(['hand.webp']);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get('signature')).toBe('test');
    expect(url.searchParams.get('x-oss-process')).toBe('image/resize,w_100/format,webp');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Referer: 'https://lanhuapp.com/web/' }, redirect: 'manual' });
    await expect(downloadSlices([item], root, fetcher)).rejects.toThrow('已存在');
    await expect(downloadSlices([{ ...item, url: 'https://evil.test/a' }], path.join(root, 'bad'), fetcher)).rejects.toThrow('来源');
    await expect(downloadSlices([item, item], path.join(root, 'duplicate'), fetcher)).rejects.toThrow('重复');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('默认不创建目录，只有显式选项才创建；其他格式必须显式选择', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lanhu-slices-'));
  const directory = path.join(root, 'requested');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const fetcher = vi.fn(async () => new Response(png));
  const item = { url: 'https://alipic.lanhuapp.com/a', filename: 'bg.png' };
  try {
    await expect(downloadSlices([item], directory, fetcher)).rejects.toThrow('不自动创建');
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await downloadSlices([item], directory, fetcher, { createDirectory: true, originalFormat: true }))
      .toMatchObject([{ status: 'saved', filename: 'bg.png' }]);
    expect(await readdir(directory)).toEqual(['bg.png']);
    expect(fetcher.mock.calls[0][0]).toBe(item.url);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('CDN 未返回真实 WebP 时不伪装后缀，也不留下 JSON 或中间文件', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lanhu-slices-'));
  try {
    const fetcher = vi.fn(async () => new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    expect(await downloadSlices([{ url: 'https://alipic.lanhuapp.com/a', filename: 'bg.webp' }], root, fetcher))
      .toMatchObject([{ status: 'failed' }]);
    expect(await readdir(root)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
