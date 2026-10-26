import { afterEach, expect, it, vi } from 'vitest';
import { assignImage, configureTransport } from '../panel/canvas/transport.js';

afterEach(() => { configureTransport(undefined); vi.unstubAllGlobals(); });

it('原生面板图片通过 MCP 返回的字节生成内嵌数据 URL，不直连 CDN 或使用 blob URL', async () => {
  class DataReader {
    result = '';
    onload?: () => void;
    async readAsDataURL(blob: Blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
      this.onload?.();
    }
  }
  vi.stubGlobal('FileReader', DataReader);
  const direct = vi.fn(() => { throw new Error('禁止 HTTP'); });
  vi.stubGlobal('fetch', direct);
  const request = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }));
  configureTransport({ fetch: request });
  const image = new EventTarget() as EventTarget & { src: string };
  const url = '/api/resource?url=https%3A%2F%2Falipic.lanhuapp.com%2Ffixture.png';
  await assignImage(image, url);
  expect(image.hidden).toBe(true);
  expect(image.loading).toBe('eager');
  expect(image.src).toBe('data:image/png;base64,AQID');
  image.dispatchEvent(new Event('load')); expect(image.hidden).toBe(false);
  await assignImage(image, url);
  expect(request).toHaveBeenCalledTimes(1);
  expect(direct).not.toHaveBeenCalled();
});

it('浏览器模式也先隐藏图片，失败时保持隐藏，不显示原生烂图', async () => {
  const image = new EventTarget() as EventTarget & { src: string; hidden: boolean };
  await assignImage(image, '/api/resource?url=fixture');
  expect(image.hidden).toBe(true);
  image.dispatchEvent(new Event('error')); expect(image.hidden).toBe(true);
});
