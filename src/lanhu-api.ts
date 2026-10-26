import { AppError, checkLoginCookie, errorInfo, lanhuUrl } from './shared';
import type { Bridge } from './bridge';
import { extractLanhuLinks, localLanhuRoute } from '../panel/canvas/lanhu-links.js';

// Adapted from lanhu-mcp 1.8.7 swagger/server.py (MIT); see THIRD_PARTY_NOTICES.md.
type ObjectData = Record<string, any>;
type Params = Record<string, string | number | undefined>;
export type ProjectParams = { project_id: string; team_id?: string };
export type Page = { offset?: number; limit?: number };
const object = (value: unknown): ObjectData => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const array = (value: unknown): ObjectData[] => Array.isArray(value) ? value.map(object) : [];
const data = (value: ObjectData) => object(value.data ?? value.result);
const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
export function documentTime(value: unknown) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') : value;
}
const page = <T>(items: T[], options: Page) => {
  const offset = options.offset ?? 0, limit = options.limit ?? 100;
  return { offset, limit, next_offset: offset + limit < items.length ? offset + limit : null, items: items.slice(offset, offset + limit) };
};

export function parseLanhuLink(value: string) {
  let query = value.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(query)) {
    const url = lanhuUrl(query);
    query = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : url.search.slice(1);
  } else query = query.slice(query.indexOf('?') + 1);
  const params = new URLSearchParams(query);
  const get = (...names: string[]) => names.map(name => params.get(name)).find(Boolean) ?? null;
  const result = { project_id: get('pid', 'project_id'), team_id: get('tid', 'team_id'),
    doc_id: get('docId', 'image_id'), image_id: get('image_id', 'docId'),
    version_id: get('versionId', 'version_id'), page_id: get('pageId', 'page_id') };
  if (!Object.values(result).some(Boolean)) throw new AppError('INVALID_LINK', '链接中没有蓝湖项目、团队、文档或版本参数');
  return result;
}

export function resourceUrl(value: string): URL {
  let url: URL;
  const normalized = value.trim();
  try { url = new URL(normalized.startsWith('//') ? `https:${normalized}` : normalized); }
  catch { throw new AppError('INVALID_RESOURCE_URL', '资源地址必须为蓝湖 HTTPS URL'); }
  // Only known Lanhu resource origins; never forward credentials to a resource URL.
  const allowed = ['lanhuapp.com', 'dds.lanhuapp.com', 'axure-file.lanhuapp.com', 'img.lanhuapp.com',
    'alipic.lanhuapp.com', 'assets.lanhuapp.com', 'lanhu-oss-proxy.lanhuapp.com', 'lanhu-oss-2537-2.lanhuapp.com',
    'lanhu.oss-cn-beijing.aliyuncs.com', 'lanhu-dds-backend.oss-cn-beijing.aliyuncs.com'];
  if (!allowed.includes(url.hostname) || url.protocol !== 'https:' || url.port || url.username || url.password)
    throw new AppError('INVALID_RESOURCE_URL', '仅支持蓝湖及其已知 OSS 资源域名的标准 HTTPS 地址');
  url.hash = '';
  return url;
}

export function normalizeSectors(raw: unknown) {
  const sectors = array(raw).filter(item => typeof item.id === 'string');
  const byId = new Map(sectors.map(item => [item.id, item]));
  const pathFor = (item: ObjectData) => {
    const names: string[] = [], visited = new Set<string>();
    let current: ObjectData | undefined = item;
    while (current && !visited.has(current.id)) {
      if (visited.size >= 256) throw new AppError('INVALID_DESIGN_DATA', '设计稿分组层级过深');
      visited.add(current.id); names.unshift(String(current.name ?? '')); current = byId.get(current.parent_id);
    }
    return names.filter(Boolean).join('/');
  };
  const normalized = sectors.map(item => ({ id: item.id, parent_id: item.parent_id || null, name: item.name,
    path: pathFor(item), order: item.order ?? 0, image_count: Array.isArray(item.images) ? item.images.length : 0 }));
  const images = new Map<string, typeof normalized>();
  sectors.forEach((item, index) => {
    for (const entry of Array.isArray(item.images) ? item.images : []) {
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (typeof id === 'string') images.set(id, [...(images.get(id) ?? []), normalized[index]]);
    }
  });
  return { sectors: normalized, images };
}

export function scaleUrls(value: string, width: number, height: number, scale: number) {
  if (!(width > 0 && height > 0 && scale > 0)) return {};
  const url = resourceUrl(value), w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const make = (x: number, y: number) => {
    const copy = new URL(url);
    x = Math.max(1, Math.round(x)); y = Math.max(1, Math.round(y));
    if (x !== w * scale || y !== h * scale) copy.searchParams.set('x-oss-process', `image/resize,w_${x},h_${y}/format,png`);
    return copy.href;
  };
  return Object.fromEntries(Object.entries({ '1x': 1, '2x': 2, '3x': 3,
    ios_1x: scale / 4, ios_2x: scale / 2, ios_3x: scale * 3 / 4,
    android_mdpi: scale / 4, android_hdpi: scale * 1.5 / 4, android_xhdpi: scale / 2,
    android_xxhdpi: scale * 3 / 4, android_xxxhdpi: scale }).map(([key, factor]) => [key, make(w * factor, h * factor)]));
}

export class LanhuApi {
  constructor(private readonly bridge: Pick<Bridge, 'getCookie' | 'loginStatus' | 'checkLogin'>,
    private readonly fetcher: typeof fetch = fetch) {}

  private async credential(url: URL) {
    if (!this.bridge.loginStatus().loggedIn) {
      const checked = await this.bridge.checkLogin();
      if (!checked.login.loggedIn) throw new AppError('LOGIN_REQUIRED', checked.loginPageOpened
        ? '蓝湖凭据缺失或格式无效，已打开登录页；请登录后重试'
        : '蓝湖凭据缺失或格式无效，请在蓝湖面板手动填写 Cookie');
    }
    const cookie = this.bridge.getCookie(url.href).cookie;
    // A valid token on an unrelated path/subdomain must not authorize this URL.
    if (!checkLoginCookie(cookie).loggedIn) throw new AppError('COOKIE_SCOPE_MISMATCH', '此接口没有可用的 user_token，请重新同步对应蓝湖域名的 Cookie');
    return cookie;
  }

  private async bytes(url: URL, headers: Record<string, string>, maximum: number, body?: string) {
    try {
      const response = await this.fetcher(url, { method: body ? 'POST' : 'GET', body, headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) throw new AppError(headers.Cookie ? 'LOGIN_REJECTED' : 'RESOURCE_ACCESS_DENIED', headers.Cookie
          ? '蓝湖服务端拒绝凭据，请在蓝湖面板手动填写 Cookie' : '蓝湖资源拒绝访问，请重新获取资源地址');
        if (response.status === 403) throw new AppError('ACCESS_DENIED', '蓝湖服务端拒绝访问，请检查项目权限或重新登录');
        throw new AppError('UPSTREAM_HTTP_ERROR', `蓝湖接口返回 HTTP ${response.status}`);
      }
      if (Number(response.headers.get('content-length')) > maximum) {
        await response.body?.cancel(); throw new AppError('RESOURCE_TOO_LARGE', '接口响应超出大小限制');
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (reader) try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > maximum) { await reader.cancel(); throw new AppError('RESOURCE_TOO_LARGE', '接口响应超出大小限制'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      return { bytes: Buffer.concat(chunks), mimeType: (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim() };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('UPSTREAM_REQUEST_FAILED', '蓝湖请求失败或超过 30 秒，请检查网络后重试');
    }
  }

  private json(bytes: Buffer): ObjectData {
    try { const parsed: unknown = JSON.parse(bytes.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      return parsed;
    } catch { throw new AppError('INVALID_UPSTREAM_JSON', '蓝湖接口未返回有效的 JSON 对象'); }
  }

  async request(endpoint: string, params: Params) {
    const dds = endpoint === '/api/dds/image/store_schema_revise';
    const paths = ['/api/account/user_teams', '/api/project/team_projects', '/api/project/folder', '/api/account/folder_projects', '/api/account/user/detail', '/api/project/multi_info', '/api/project/product_documents', '/api/project/image',
      '/api/project/images', '/api/project/project_sectors', '/api/dds/image/store_schema_revise'];
    if (!paths.includes(endpoint)) throw new AppError('INVALID_ENDPOINT', '不支持此蓝湖接口');
    const url = new URL(endpoint, dds ? 'https://dds.lanhuapp.com' : 'https://lanhuapp.com');
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
    const cookie = await this.credential(url);
    const result = this.json((await this.bytes(url, { Cookie: cookie, Accept: 'application/json, text/plain, */*',
      'User-Agent': userAgent, 'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
      'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"macOS"',
      Referer: dds ? 'https://dds.lanhuapp.com/' : 'https://lanhuapp.com/web/',
      ...(dds ? { Authorization: 'Basic dW5kZWZpbmVkOg==' } : { 'request-from': 'web', 'real-path': '/item/project/product' }) }, 32 * 1024 * 1024)).bytes);
    if (result.code !== undefined && !['0', '00000', '200'].includes(String(result.code))) {
      if (String(result.code) === '401') throw new AppError('LOGIN_REJECTED', '蓝湖服务端拒绝凭据，请在蓝湖面板手动填写 Cookie');
      const code = /^-?\d{1,10}$/.test(String(result.code)) ? `（代码 ${result.code}）` : '';
      throw new AppError('UPSTREAM_API_ERROR', `蓝湖业务接口返回失败${code}，请检查项目、版本 ID、访问权限或重新登录`);
    }
    return result;
  }

  project(params: ProjectParams & { doc_info?: number; img_limit?: number; detach?: number }) {
    return this.request('/api/project/multi_info', { doc_info: 1, img_limit: 500, detach: 1, ...params });
  }
  async resolveLink(value: string) {
    const direct = localLanhuRoute(value); if (direct) return direct;
    const link = extractLanhuLinks(value)[0]; if (!link) return null;
    const source = new URL(link), hash = new URLSearchParams(source.hash.split('?')[1] || '');
    const short_id = hash.get('sid') || source.searchParams.get('sid');
    if (!short_id || !/^[\w-]{1,256}$/.test(short_id)) return null;
    const endpoint = new URL('https://lanhuapp.com/api/share/url/resolve');
    const cookie = await this.credential(endpoint);
    const sign = hash.get('sign') || source.searchParams.get('sign') || undefined;
    const response = this.json((await this.bytes(endpoint, { Cookie: cookie, Referer: 'https://lanhuapp.com/link/', 'User-Agent': userAgent,
      'Content-Type': 'application/json', Accept: 'application/json' }, 1024 * 1024, JSON.stringify({ short_id, ...(sign ? { sign } : {}) }))).bytes);
    if (Number(response.code) !== 0 || typeof response.data?.url !== 'string') return null;
    // Resolve only; never invoke member_add or any team/project invitation action.
    return localLanhuRoute(response.data.url);
  }
  documents(params: ProjectParams) { return this.request('/api/project/product_documents', params); }
  design({ project_id, ...params }: ProjectParams & { image_id: string; dds_status?: number }) {
    return this.request('/api/project/image', { pid: project_id, dds_status: 1, ...params });
  }
  designs(params: ProjectParams & { dds_status?: number; position?: number; show_cb_src?: number; comment?: number }) {
    return this.request('/api/project/images', { dds_status: 1, position: 1, show_cb_src: 1, comment: 1, ...params });
  }
  sectors(project_id: string) { return this.request('/api/project/project_sectors', { project_id }); }
  async teams() {
    const raw = await this.request('/api/account/user_teams', {});
    return { teams: array(raw.result ?? raw.data).map(team => ({ id: team.id, name: team.name })) };
  }
  async projects(team_id: string, folder_id?: string) {
    const normalize = (project: ObjectData) => ({ id: project.id, name: project.name, team_id,
      folder_id: folder_id || project.folder_id, cover: object(project.cover).url || '', order: project.order_index });
    if (folder_id) {
      // Match the folder browser used by the current SDK, including pagination
      // and ordering arguments. The older one_folder_projects endpoint rejects
      // requests for some teams with HTTP 400.
      const raw = await this.request('/api/account/folder_projects', { team_id, folder_id, default_order: 'desc', pageNo: 1, pageSize: 999999 });
      const payload = raw.data ?? raw.result ?? raw;
      return { projects: array(Array.isArray(payload) ? payload : object(payload).projects_info).map(normalize) };
    }
    const [raw, folders] = await Promise.all([
      this.request('/api/project/team_projects', { team_id }),
      this.request('/api/project/folder', { team_id, all_folder: 'true' })
    ]);
    const teams = array(data(raw).team_projects);
    const projects = array(teams.find(team => team.tid === team_id)?.projects);
    return { projects: projects.map(normalize),
      folders: array(data(folders).folders_info).map(folder => ({ id: folder.id, name: folder.name, parent_id: folder.parent_id })) };
  }
  async profile(team_id?: string) {
    const raw = await this.request('/api/account/user/detail', { team_id });
    const user = object(raw.data ?? raw.result ?? raw);
    return { name: String(user.nickname || user.name || ''), avatar: typeof user.avatar === 'string' ? user.avatar : '', color: typeof user.color === 'string' ? user.color : '' };
  }
  schema(version_id: string) { return this.request('/api/dds/image/store_schema_revise', { version_id }); }

  async listDocuments(params: ProjectParams & Page) {
    const { offset, limit, ...query } = params;
    const resources = array(data(await this.documents(query)).resources).filter(item => item.id);
    const documents = resources.map(item => ({ doc_id: item.id, name: item.name, type: item.type,
      size_bytes: item.size, update_time: documentTime(item.update_time), latest_version: item.latest_version,
      doc_url: `https://lanhuapp.com/web/#/item/project/product?${new URLSearchParams({ pid: params.project_id, tid: params.team_id ?? '', docId: String(item.id) })}` }));
    const { items, ...pagination } = page(documents, params);
    return { status: 'success', ...query, total_documents: documents.length, ...pagination, documents: items };
  }

  async listDesigns(params: ProjectParams & Page) {
    const { offset, limit, ...query } = params;
    const [imageResult, sectorResult] = await Promise.allSettled([this.designs(query), this.sectors(params.project_id)]);
    if (imageResult.status === 'rejected') throw imageResult.reason;
    const project = data(imageResult.value);
    const groups = normalizeSectors(sectorResult.status === 'fulfilled' ? data(sectorResult.value).sectors : []);
    const designs = array(project.images).map((item, index) => ({ index: index + 1, id: item.id, name: item.name,
      width: item.width, height: item.height, url: item.url, has_comment: item.has_comment ?? false, update_time: item.update_time,
      sectors: (groups.images.get(item.id) ?? []).map(group => group.name), sector_paths: (groups.images.get(item.id) ?? []).map(group => group.path) }));
    const { items, ...pagination } = page(designs, params);
    return { status: 'success', project_name: project.name, total_sectors: groups.sectors.length,
      sectors: groups.sectors, ungrouped_design_count: designs.filter(item => !item.sectors.length).length,
      total_designs: designs.length, ...pagination, designs: items,
      ...(sectorResult.status === 'rejected' ? { sector_warning: errorInfo(sectorResult.reason) } : {}) };
  }

  async resource(value: string) {
    const url = resourceUrl(value);
    return { url: url.href, ...await this.bytes(url, { Accept: '*/*', 'User-Agent': userAgent, Referer: 'https://lanhuapp.com/web/' }, 8 * 1024 * 1024) };
  }

  async slices(params: ProjectParams & Page & { image_id: string }) {
    const { offset, limit, ...query } = params;
    const versions = array(data(await this.design(query)).versions);
    const url = versions[0]?.json_url;
    if (typeof url !== 'string' || !url) throw new AppError('DESIGN_DATA_MISSING', '设计稿没有可读取的版本 json_url');
    const sketch = this.json((await this.resource(url)).bytes);
    const scale = Number(sketch.sliceScale ?? object(sketch.meta).sliceScale ?? 2);
    if (!Number.isFinite(scale) || scale <= 0 || scale > 16) throw new AppError('INVALID_DESIGN_DATA', '设计稿 sliceScale 无效');
    if (!['layers', 'children', 'info', 'assets', 'artboards'].some(key => Array.isArray(sketch[key])) && !sketch.board && !sketch.artboard && !sketch.imageUrl)
      throw new AppError('INVALID_DESIGN_DATA', '设计稿 JSON 缺少可识别的图层结构，请使用原始设计数据工具检查');
    const slices: ObjectData[] = [], stack: unknown[] = [sketch], seen = new Set<string>(); let visited = 0;
    while (stack.length) {
      if (++visited > 200_000) throw new AppError('DESIGN_TOO_COMPLEX', '设计图层超过处理上限');
      const node = object(stack.pop());
      const bounds = object(node.frame ?? node.bounds ?? node);
      const exports = object(node.images);
      const image = node.imageUrl ?? object(node.image).imageUrl ?? node.url ?? exports.png_xxxhd ?? exports.png ?? exports.svg;
      const width = Number(bounds.width ?? (bounds.right !== undefined ? bounds.right - (bounds.left ?? 0) : 0));
      const height = Number(bounds.height ?? (bounds.bottom !== undefined ? bounds.bottom - (bounds.top ?? 0) : 0));
      const x = Number(bounds.x ?? bounds.left ?? 0), y = Number(bounds.y ?? bounds.top ?? 0);
      const identity = JSON.stringify([node.id ?? node.objectID, image]);
      if ((node.isSlice || node.isAsset || node.exportable || node.hasExportImage || node.imageUrl) && typeof image === 'string' && !seen.has(identity)) {
        if (![width, height, x, y].every(Number.isFinite))
          throw new AppError('INVALID_DESIGN_DATA', '切图坐标或尺寸无效');
        seen.add(identity);
        slices.push({ slice_id: String(node.id ?? node.objectID ?? slices.length + 1), name: node.name ?? 'slice',
          url: resourceUrl(image).href, logical_size: { width, height },
          bounds: { x, y, width, height }, scale_urls: scaleUrls(image, width, height, scale) });
      }
      const children = ['layers', 'children', 'info', 'artboards', 'assets'].flatMap(key => Array.isArray(node[key]) ? node[key] : []);
      if (node.board && typeof node.board === 'object') children.unshift(node.board);
      if (node.artboard && typeof node.artboard === 'object') children.unshift(node.artboard);
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
    const { items, ...pagination } = page(slices, params);
    return { status: 'success', image_id: params.image_id, slice_scale: scale, total_slices: slices.length, ...pagination, slices: items };
  }
}
