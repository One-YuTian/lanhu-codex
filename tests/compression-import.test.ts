import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pickImages, pickerCommand } from '../src/compression-import';
import { CompressionQueue } from '../src/compression';
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function temporary() { await mkdir('.cache', { recursive: true }); const result = await mkdtemp(path.resolve('.cache/compression-import-')); directories.push(result); return result; }
it('原生选择器取消返回空列表，不依赖浏览器 showDirectoryPicker', async () => {
  const runner = vi.fn().mockResolvedValue({ stdout: '[]' });
  expect(await pickImages(runner as any)).toEqual([]);
  const specification = pickerCommand('win32');
  const script = Buffer.from(specification.args.at(-1)!, 'base64').toString('utf16le');
  expect(script).toContain('OpenFileDialog'); expect(script).toContain("else { '[]' }");
  expect(runner.mock.calls[0][2]).toMatchObject({ windowsHide: true });
});
it('原生文件选择器支持多选，正确保留中文与空格路径', async () => {
  const directory = await temporary(), file = path.join(directory, '中文 图片.png');
  const runner = vi.fn().mockResolvedValue({ stdout: JSON.stringify([file]) });
  expect(await pickImages(runner as any)).toEqual([file]);
  const specification = pickerCommand('win32');
  expect(Buffer.from(specification.args.at(-1)!, 'base64').toString('utf16le')).toContain('$dialog.Multiselect = $true');
});
it('预览分块读取有 MIME 与版本信息，避免一次返回超大 MCP 消息', async () => {
  const root = await temporary(), file = path.join(root, '预览.jpeg'), bytes = randomBytes(500000); await writeFile(file, bytes);
  const queue = new CompressionQueue(), { items } = await queue.add([file]);
  const chunks: Buffer[] = []; let offset = 0, revision = '';
  do {
    const chunk = await queue.previewChunk(items[0].id, offset);
    expect(chunk.mime).toBe('image/jpeg'); expect(Buffer.from(chunk.base64,'base64').length).toBeLessThanOrEqual(192 * 1024);
    if (revision) expect(chunk.revision).toBe(revision); revision = chunk.revision;
    chunks.push(Buffer.from(chunk.base64,'base64')); offset = chunk.next;
  } while (offset < bytes.length);
  expect(Buffer.concat(chunks)).toEqual(bytes); expect(queue.snapshot()[0].status).toBe('waiting');
});
