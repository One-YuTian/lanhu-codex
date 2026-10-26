import { mkdir, open, access, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

const hosts = new Set(['lanhuapp.com', 'dds.lanhuapp.com', 'img.lanhuapp.com', 'alipic.lanhuapp.com',
  'assets.lanhuapp.com', 'lanhu-oss-proxy.lanhuapp.com', 'lanhu-oss-2537-2.lanhuapp.com',
  'lanhu.oss-cn-beijing.aliyuncs.com', 'lanhu-dds-backend.oss-cn-beijing.aliyuncs.com']);
const extensions = { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'],
  'image/gif': ['.gif'], 'image/svg+xml': ['.svg'] };
const maximum = 8 * 1024 * 1024;
async function writeNew(file, content) {
  const handle = await open(file, 'wx');
  try { await handle.writeFile(content); } finally { await handle.close(); }
}
function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(bytes.toString('utf8'))) return 'image/svg+xml';
  throw new Error('响应不是支持的图片文件');
}

export async function downloadSlices(items, directory, fetcher = fetch, options = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error('清单必须是非空数组');
  const root = path.resolve(directory), used = new Set();
  // Preflight every destination before requesting resources.
  const jobs = items.map(item => {
    const original = item.filename;
    if (typeof original !== 'string' || !/^[a-z][a-z0-9_@.-]*\.(png|jpe?g|webp|gif|svg)$/.test(original)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(original))
      throw new Error('文件名无效或重复');
    const filename = options.originalFormat ? original : `${path.parse(original).name}.webp`;
    if (used.has(filename.toLowerCase())) throw new Error('文件名无效或重复');
    used.add(filename.toLowerCase());
    const url = new URL(item.url.startsWith('//') ? `https:${item.url}` : item.url);
    if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port || url.username || url.password)
      throw new Error('仅允许已知蓝湖 HTTPS 图片来源');
    if (!options.originalFormat) {
      const process = url.searchParams.get('x-oss-process') || 'image';
      url.searchParams.set('x-oss-process', process.replace(/\/format,[^/]+/g, '') + '/format,webp');
    }
    return { ...item, filename, url: url.href, destination: path.join(root, filename) };
  });
  try {
    if (!(await stat(root)).isDirectory()) throw new Error('目标路径不是目录');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!options.createDirectory) throw new Error('目标目录不存在；未经用户要求，不自动创建文件夹');
    await mkdir(root, { recursive: true });
  }
  for (const filename of used) {
    try { await access(path.join(root, filename)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`文件已存在：${filename}`);
  }
  const results = [];
  for (const { destination, ...job } of jobs) {
    try {
      const response = await fetcher(job.url, { headers: { Referer: 'https://lanhuapp.com/web/' },
        redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      if (!response.ok || Number(response.headers.get('content-length')) > maximum) {
        await response.body?.cancel(); throw new Error(`图片请求失败或过大（HTTP ${response.status}）`);
      }
      const chunks = []; let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.byteLength;
        if (size > maximum) throw new Error('图片超过 8 MiB');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks), mime = imageType(bytes);
      if (!extensions[mime].includes(path.extname(job.filename))) throw new Error('真实图片格式与文件后缀不符');
      await writeNew(destination, bytes);
      results.push({ ...job, status: 'saved', bytes: bytes.length, mime });
    } catch (error) { results.push({ ...job, status: 'failed', error: error.message }); }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [, , manifest, directory, ...flags] = process.argv;
    if (!manifest || !directory || flags.some(flag => !['--create-directory', '--original-format'].includes(flag)))
      throw new Error('用法：node download-slices.mjs - <现有素材目录> [--create-directory] [--original-format]；清单通过标准输入传入');
    let input = '';
    if (manifest === '-') {
      for await (const chunk of process.stdin) { input += chunk.toString('utf8'); if (input.length > 1024 * 1024) throw new Error('清单过长'); }
    } else input = await readFile(manifest, 'utf8');
    const results = await downloadSlices(JSON.parse(input), directory, fetch, {
      createDirectory: flags.includes('--create-directory'), originalFormat: flags.includes('--original-format')
    });
    const saved = results.filter(item => item.status === 'saved').length;
    console.log(JSON.stringify({ saved, failed: results.length - saved, files: results.map(({ filename, status, error }) => ({ filename, status, ...(error ? { error } : {}) })) }));
    if (saved !== results.length) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
