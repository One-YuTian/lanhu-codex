import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, realpath, readdir, readFile, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

export const MAX_IMAGE_BYTES = 5_200_000;
export const imageExtension = /\.(jpe?g|png|webp)$/i;
export type Phase = 'waiting' | 'uploading' | 'downloading' | 'replacing' | 'done' | 'unchanged' | 'error';
export type ImageItem = { id: string; path: string; name: string; originalSize: number; size?: number; status: Phase; progress?: number; revision?: number; error?: string };
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

// Validate the complete container as well as the provider's advertised byte count.
export function validateImage(data: Buffer, name: string) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') {
    if (!data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('PNG 文件头无效');
    let offset = 8, ended = false, header = false; const idat: Buffer[] = [];
    while (offset + 12 <= data.length) {
      const size = data.readUInt32BE(offset), end = offset + size + 12;
      if (end > data.length) throw new Error('PNG 数据不完整');
      const type = data.toString('ascii', offset + 4, offset + 8);
      if (!header && (type !== 'IHDR' || size !== 13)) throw new Error('PNG 缺少 IHDR');
      header = true;
      let crc = 0xffffffff;
      for (const byte of data.subarray(offset + 4, end - 4)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      if (((crc ^ 0xffffffff) >>> 0) !== data.readUInt32BE(end - 4)) throw new Error('PNG 校验失败');
      if (type === 'IDAT') idat.push(data.subarray(offset + 8, end - 4));
      offset = end;
      if (type === 'IEND') { ended = size === 0 && offset === data.length; break; }
    }
    if (!ended || !idat.length) throw new Error('PNG 数据不完整');
    inflateSync(Buffer.concat(idat), { maxOutputLength: 128 * 1024 * 1024 });
  } else if (ext === '.webp') {
    if (data.length < 20 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP' || data.readUInt32LE(4) + 8 !== data.length) throw new Error('WebP 数据不完整');
    let offset = 12, image = false;
    while (offset + 8 <= data.length) {
      const type = data.toString('ascii', offset, offset + 4), size = data.readUInt32LE(offset + 4);
      offset += 8 + size + (size % 2);
      if (offset > data.length) throw new Error('WebP 分块不完整');
      if (['VP8 ', 'VP8L', 'ANMF'].includes(type)) image = true;
    }
    if (offset !== data.length || !image) throw new Error('WebP 图片数据无效');
  } else if (ext === '.jpg' || ext === '.jpeg') {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) throw new Error('JPEG 数据不完整');
  } else throw new Error('仅支持 JPG、JPEG、PNG、WebP');
}

async function limitedBody(response: Response, limit: number, progress?: (received: number, total: number) => void) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`TinyPNG 返回 HTTP ${response.status}${response.status === 429 ? '，请稍后重试' : ''}`); }
  const advertised = response.headers.get('content-length');
  if (advertised && Number(advertised) > limit) { await response.body?.cancel(); throw new Error('响应超过允许大小'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('第三方返回空响应');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.length;
      if (size > limit) throw new Error('响应超过允许大小');
      chunks.push(result.value); progress?.(size, Number(advertised) || 0);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  if (advertised && !response.headers.get('content-encoding') && Number(advertised) !== size) throw new Error('下载长度不匹配');
  return Buffer.concat(chunks);
}

export async function compressImage(input: Buffer, name: string, phase: (value: Phase) => void = () => {}, fetcher: typeof fetch = fetch, progress: (value: number) => void = () => {}) {
  if (!input.length || input.length > MAX_IMAGE_BYTES) throw new Error('图片为空或超过 TinyPNG 网页接口的 5.2 MB 上限');
  validateImage(input, name);
  phase('uploading'); progress(10);
  // Per-request headers, following super-tinypng; no shared mutable request options.
  const ip = Array.from(randomBytes(4), value => 1 + value % 254).join('.');
  const response = await fetcher('https://tinypng.com/backend/opt/shrink', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
    headers: { 'Content-Type': 'application/octet-stream', 'User-Agent': 'Mozilla/5.0', 'X-Forwarded-For': ip }, body: new Uint8Array(input)
  });
  const payload = JSON.parse((await limitedBody(response, 64 * 1024)).toString('utf8'));
  if (payload.error) throw new Error(String(payload.message || payload.error).slice(0, 300));
  const output = payload.output;
  if (!output || !Number.isSafeInteger(output.size) || output.size <= 0 || output.size > MAX_IMAGE_BYTES) throw new Error('压缩服务返回无效大小');
  const url = new URL(output.url);
  if (url.protocol !== 'https:' || !['tinypng.com', 'www.tinypng.com'].includes(url.hostname) || url.port || url.username || url.password || !/^\/(?:web\/output|backend\/opt\/output)\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw new Error('压缩服务返回无效下载地址');
  phase('downloading'); progress(50);
  const binary = await limitedBody(await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) }), MAX_IMAGE_BYTES, (received, total) => progress(50 + Math.min(1, received / (total || output.size)) * 38));
  if (binary.length !== output.size) throw new Error('压缩结果尚未下载完整，保留原图');
  validateImage(binary, name);
  return { binary, size: binary.length, originalSize: input.length, unchanged: binary.length >= input.length };
}

export class CompressionQueue {
  private items = new Map<string, ImageItem>();
  private active = new Set<string>();
  private revision = 0;
  private identities = new Map<string, string>();
  snapshot() { return [...this.items.values()].map(item => ({ ...item })); }
  async preview(id: string) {
    const item = this.items.get(id);
    if (!item) throw new Error('图片不在列表中');
    const handle = await open(item.path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('图片不支持预览');
      const bytes = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error('图片预览不完整');
        offset += bytesRead;
      }
      return bytes;
    } finally { await handle.close(); }
  }
  async previewChunk(id: string, offset = 0, length = 192 * 1024) {
    const item = this.items.get(id); if (!item) throw new Error('图片不在列表中');
    const handle = await open(item.path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024 || offset > stat.size) throw new Error('图片不支持预览');
      const bytes = Buffer.alloc(Math.min(length, stat.size - offset));
      let received = 0;
      while (received < bytes.length) {
        const result = await handle.read(bytes, received, bytes.length - received, offset + received);
        if (!result.bytesRead) throw new Error('图片预览不完整'); received += result.bytesRead;
      }
      const extension = path.extname(item.name).toLowerCase();
      return { base64: bytes.toString('base64'), total: stat.size, offset, next: offset + received,
        revision: `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.size}`, mime: extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg' };
    } finally { await handle.close(); }
  }
  async add(paths: string[]) {
    const errors: { path: string; error: string }[] = []; let duplicates = 0, visited = 0;
    const seenDirectories = new Set<string>();
    const visit = async (input: string): Promise<void> => {
      if (++visited > 100_000) throw new Error('目录过大，请分批添加');
      const candidate = input.startsWith('file:') ? fileURLToPath(input) : input;
      if (!path.isAbsolute(candidate)) throw new Error('请提供本机绝对路径');
      const stat = await lstat(candidate);
      if (stat.isSymbolicLink()) return;
      const resolved = await realpath(candidate);
      const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      if (stat.isDirectory()) {
        if (seenDirectories.has(key)) return; seenDirectories.add(key);
        for (const entry of await readdir(resolved)) {
          if (visited >= 100_000 || this.items.size >= 5000) { errors.push({ path: resolved, error: '达到扫描或列表上限，请分批添加' }); break; }
          try { await visit(path.join(resolved, entry)); }
          catch (error) { if (errors.length < 100) errors.push({ path: path.join(resolved, entry), error: String((error as Error).message) }); }
        }
      } else if (stat.isFile() && imageExtension.test(resolved)) {
        const identity = `${stat.dev}:${stat.ino}`;
        if (this.items.has(key) || this.identities.has(identity)) { duplicates++; return; }
        if (this.items.size >= 5000) throw new Error('列表最多 5000 张，请分批处理');
        this.identities.set(identity, key);
        this.items.set(key, { id: key, path: resolved, name: path.basename(resolved), originalSize: stat.size, status: 'waiting', progress: 0, revision: ++this.revision });
      }
    };
    for (const input of paths) { try { await visit(input); } catch (error) { errors.push({ path: input, error: (error as Error).message }); } }
    return { items: this.snapshot(), errors, duplicates };
  }
  remove(ids: string[]) {
    for (const id of ids) if (!this.active.has(id)) {
      this.items.delete(id);
      for (const [identity, key] of this.identities) if (key === id) this.identities.delete(identity);
    }
    return this.snapshot();
  }
  async process(id: string, fetcher: typeof fetch = fetch) {
    const item = this.items.get(id);
    if (!item) throw new Error('图片不在列表中，请先添加');
    if (this.active.has(id)) throw new Error('图片正在处理');
    if (['done', 'unchanged'].includes(item.status)) return { ...item };
    this.active.add(id); item.error = undefined; item.progress = 0; item.status = 'uploading'; item.revision = ++this.revision;
    let temporary: string | undefined;
    try {
      const before = await lstat(item.path);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1) throw new Error('仅替换普通文件；符号链接或硬链接请先复制为独立文件');
      if (before.size > MAX_IMAGE_BYTES) throw new Error('图片超过 5.2 MB 上限');
      const input = await readFile(item.path); item.originalSize = input.length;
      const result = await compressImage(input, item.name, value => { item.status = value; item.revision = ++this.revision; }, fetcher, value => { item.progress = value; item.revision = ++this.revision; });
      item.size = result.size;
      if (result.unchanged) { item.status = 'unchanged'; item.progress = 100; item.revision = ++this.revision; return { ...item }; }
      item.status = 'replacing'; item.progress = 92;
      temporary = path.join(path.dirname(item.path), `.${item.name}.${randomUUID()}.lanhu-compress.tmp`);
      const handle = await open(temporary, 'wx', before.mode & 0o777);
      try { await handle.writeFile(result.binary); await handle.sync(); } finally { await handle.close(); }
      const current = await lstat(item.path);
      if (!current.isFile() || current.isSymbolicLink() || current.nlink > 1 || current.dev !== before.dev || current.ino !== before.ino || current.mtimeMs !== before.mtimeMs || digest(await readFile(item.path)) !== digest(input)) throw new Error('原图片已被外部修改，取消替换');
      // Same-directory rename commits the complete file. Never unlink the original first.
      await rename(temporary, item.path); temporary = undefined; item.status = 'done'; item.progress = 100; item.revision = ++this.revision;
    } catch (error) { item.status = 'error'; item.error = (error as Error).message; item.revision = ++this.revision; }
    finally {
      try {
        if (temporary) await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
      } catch {
        item.status = 'error'; item.revision = ++this.revision; item.error = `${item.error ? item.error + '；' : ''}临时文件清理失败：${temporary}`;
      } finally { this.active.delete(id); }
    }
    return { ...item };
  }
}

