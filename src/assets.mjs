export function assetUrl(value) {
  const url = new URL(value.startsWith('//') ? `https:${value}` : value);
  const hosts = ['lanhuapp.com', 'dds.lanhuapp.com', 'img.lanhuapp.com', 'alipic.lanhuapp.com', 'assets.lanhuapp.com', 'axure-file.lanhuapp.com', 'lanhu-oss-proxy.lanhuapp.com', 'lanhu-oss-2537-2.lanhuapp.com', 'lanhu.oss-cn-beijing.aliyuncs.com', 'lanhu-dds-backend.oss-cn-beijing.aliyuncs.com'];
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.port || url.username || url.password) throw new Error('资源地址不在蓝湖域名白名单内');
  return url.href;
}
export async function readAsset(value, fetcher = fetch) {
  const response = await fetcher(assetUrl(value), { headers: { Referer: 'https://lanhuapp.com/', Accept: '*/*', 'User-Agent': 'Mozilla/5.0 Chrome/142.0.0.0 Safari/537.36' }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`蓝湖资源返回 HTTP ${response.status}`); }
  const maximum = 32 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new Error('资源超过 32 MiB 限制'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > maximum) throw new Error('资源超过 32 MiB 限制');
    chunks.push(chunk);
  }
  return { binary: Buffer.concat(chunks), mime: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' };
}
export function processedAssetUrl(value, dimensions = {}) {
  const url = new URL(assetUrl(value));
  const format = dimensions.format;
  if (format != null && !['png', 'webp'].includes(format)) throw new Error('仅支持 PNG、WebP 格式');
  const compression = dimensions.compression;
  if (compression != null) throw new Error('请使用蓝湖 OSS 默认压缩');
  const width = Number(dimensions.width), height = Number(dimensions.height);
  const resize = dimensions.width != null || dimensions.height != null;
  if (resize && (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16383 || height > 16383 || width * height > 16_777_216)) throw new Error('切图尺寸无效或超出 OSS 限制');
  if (resize || format) {
    const operations = ['image'];
    if (resize) operations.push(`resize,m_fill,w_${width},h_${height},limit_0`);
    if (format) operations.push(`format,${format}`);
    url.searchParams.set('x-oss-process', operations.join('/'));
  }
  return url.href;
}
export function extractSlices(payload) {
  const slices = [], seen = new Set(), stack = [payload]; let visited = 0;
  while (stack.length) {
    if (++visited > 200000) throw new Error('设计图层超过处理上限');
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) { stack.push(...node); continue; }
    const bounds = node.frame || node.bounds || node;
    const url = node.imageUrl || node.image?.imageUrl || node.url || node.images?.png_xxxhd || node.images?.png || node.images?.svg;
    const width = Number(bounds.width ?? (bounds.right - bounds.left)), height = Number(bounds.height ?? (bounds.bottom - bounds.top));
    const x = Number(bounds.x ?? bounds.left ?? 0), y = Number(bounds.y ?? bounds.top ?? 0);
    const id = String(node.id ?? node.objectID ?? slices.length);
    if ((node.isSlice || node.isAsset || node.exportable || node.hasExportImage || node.imageUrl) && typeof url === 'string' && width > 0 && height > 0 && !seen.has(id)) {
      try {
        const source = assetUrl(url); seen.add(id);
        slices.push({ slice_id: id, name: node.name || '切图', url: source, logical_size: { width, height }, bounds: { x, y, width, height }, source_scale: Number(payload.sliceScale ?? payload.meta?.sliceScale) || 1 });
      } catch {}
    }
    for (const key of ['layers', 'children', 'info', 'assets', 'artboard', 'artboards', 'board']) if (node[key]) stack.push(node[key]);
  }
  return slices;
}
