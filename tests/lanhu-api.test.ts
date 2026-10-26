import { describe, expect, it, vi } from 'vitest';
import { AppError, checkLoginCookie } from '../src/shared';
import { documentTime, LanhuApi, normalizeSectors, parseLanhuLink, resourceUrl, scaleUrls } from '../src/lanhu-api';

// All authenticated API cases use a token whose exp is already in the past.
const token = `head.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.sig`;
const secret = `user_token=${token}; session=private-fixture`;
function fixture(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const bridge = { getCookie: vi.fn((_url?: string) => ({ cookie: secret, mode: 'manual' as const, url: null })),
    loginStatus: vi.fn(() => checkLoginCookie(secret)), checkLogin: vi.fn(async () => ({ login: checkLoginCookie(secret), loginPageOpened: false })) };
  const fetcher = vi.fn(async (url: any, init?: RequestInit) => handler(new URL(url), init!));
  return { api: new LanhuApi(bridge, fetcher), bridge, fetcher };
}
const json = (value: unknown, status = 200) => Response.json(value, { status });

describe('蓝湖接口导入', () => {
  it('完整链接先本地解析，分享短链接只调用只读解析接口，不接受邀请或跨站目标', async () => {
    let destination = 'https://lanhuapp.com/web/#/item/project/stage?pid=p&tid=t';
    const { api, fetcher } = fixture((url, init) => {
      expect(url.href).toBe('https://lanhuapp.com/api/share/url/resolve');
      expect(init.method).toBe('POST'); expect(init.redirect).toBe('manual');
      expect(JSON.parse(String(init.body))).toEqual({ short_id: 'lX0dBUHa' });
      return json({ code: 0, data: { url: destination } });
    });
    expect(await api.resolveLink(destination)).toEqual({ project_id: 'p', team_id: 't' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await api.resolveLink('https://lanhuapp.com/link/#/invite?sid=lX0dBUHa')).toEqual({ project_id: 'p', team_id: 't' });
    destination = 'https://evil.example/#/item?pid=stolen';
    expect(await api.resolveLink('https://lanhuapp.com/link/#/invite?sid=lX0dBUHa')).toBeNull();
  });
  it('短链接过期或需要接受邀请时不返回具体项目', async () => {
    const { api } = fixture(() => json({ code: 30501, data: { url: 'https://lanhuapp.com/web/#/?pid=private' } }));
    expect(await api.resolveLink('https://lanhuapp.com/link/#/invite?sid=invite')).toBeNull();
  });
  it.each(['root', 'data', 'result'])('文件夹项目通过 SDK 接口读取，保留请求关联（%s 响应）', async envelope => {
    const { api, fetcher } = fixture(url => {
      expect(url.pathname).toBe('/api/account/folder_projects');
      expect(url.searchParams.get('team_id')).toBe('team');
      expect(url.searchParams.get('folder_id')).toBe('folder');
      expect(url.searchParams.get('default_order')).toBe('desc');
      expect(url.searchParams.get('pageNo')).toBe('1');
      expect(url.searchParams.get('pageSize')).toBe('999999');
      const payload = { projects_info: [{ id: 'p', name: '文件夹项目', members: ['private'] }] };
      return json(envelope === 'root' ? payload : { code: '00000', [envelope]: payload });
    });
    expect(await api.projects('team', 'folder')).toEqual({ projects: [{ id: 'p', name: '文件夹项目', team_id: 'team', folder_id: 'folder', cover: '', order: undefined }] });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('空文件夹返回空项目列表', async () => {
    const { api } = fixture(() => json({ code: '00000', data: [] }));
    expect(await api.projects('team', 'empty')).toEqual({ projects: [] });
  });
  it('项目管理读取团队、完整文件夹树和当前团队项目，裁剪无关字段', async () => {
    const { api } = fixture(url => {
      if (url.pathname === '/api/account/user_teams') return json({ result: [{ id: 'team', name: '团队', email: 'private' }] });
      expect(url.searchParams.get('team_id')).toBe('team');
      if (url.pathname === '/api/project/folder') {
        expect(url.searchParams.get('all_folder')).toBe('true');
        return json({ result: { folders_info: [{ id: 'f', name: '目录', parent_id: 'root' }] } });
      }
      expect(url.pathname).toBe('/api/project/team_projects');
      return json({ result: { team_projects: [{ tid: 'other', projects: [{ id: 'hidden' }] }, { tid: 'team', projects: [{ id: 'p', name: '项目', folder_id: 'f', cover: { url: 'https://assets.lanhuapp.com/cover' }, members: ['private'] }] }] } });
    });
    expect(await api.teams()).toEqual({ teams: [{ id: 'team', name: '团队' }] });
    expect(await api.projects('team')).toEqual({ folders: [{ id: 'f', name: '目录', parent_id: 'root' }], projects: [{ id: 'p', name: '项目', team_id: 'team', folder_id: 'f', cover: 'https://assets.lanhuapp.com/cover', order: undefined }] });
  });

  it('当前用户头像接口只返回展示所需字段，不泄漏其他用户资料或凭据', async () => {
    const { api, fetcher } = fixture(url => {
      expect(url.pathname).toBe('/api/account/user/detail');
      expect(url.searchParams.get('team_id')).toBe('team');
      return json({ code: '00000', result: { name: '测试用户', nickname: '昵称', avatar: 'https://assets.lanhuapp.com/prod/avatar/example', color: 'orange', email: 'private@example.test', token: 'private-fixture' } });
    });
    expect(await api.profile('team')).toEqual({ name: '昵称', avatar: 'https://assets.lanhuapp.com/prod/avatar/example', color: 'orange' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('UXP artboard 的 hasExportImage 切图与分区 OSS 域名可通过 MCP 读取', async () => {
    const url = 'https://lanhu-oss-2537-2.lanhuapp.com/fixture.png';
    const { api } = fixture(target => target.hostname === 'lanhuapp.com'
      ? json({ code: '00000', result: { versions: [{ json_url: 'https://alipic.lanhuapp.com/uxp.json' }] } })
      : json({ meta: { host: { name: 'photoshop-uxp' }, sliceScale: 2 }, artboard: { layers: [{ id: 'slice', hasExportImage: true, frame: { left: 27, top: 291, width: 696, height: 512 }, image: { imageUrl: url } }] } }));
    expect(await api.slices({ project_id: 'p', image_id: 'i' })).toMatchObject({ total_slices: 1, slice_scale: 2, slices: [{ slice_id: 'slice', url, bounds: { x: 27, y: 291, width: 696, height: 512 } }] });
    expect(() => resourceUrl('https://lanhu-oss-2537-2.lanhuapp.com.evil.test/a')).toThrow();
  });
  it('允许原生 alipic/assets CDN 和协议相对地址，保留签名并通过 Referer 代理读取图片', async () => {
    const { api, bridge, fetcher } = fixture((_url, init) => {
      const headers = new Headers(init.headers);
      expect(headers.get('referer')).toBe('https://lanhuapp.com/web/');
      expect(headers.has('cookie')).toBe(false);
      expect(headers.has('authorization')).toBe(false);
      expect(init.redirect).toBe('manual');
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    });
    for (const host of ['alipic.lanhuapp.com', 'assets.lanhuapp.com']) {
      const url = `https://${host}/image.png?Signature=a%2Bb%2Fc%3D&OSSAccessKeyId=fixture`;
      expect(await api.resource(url)).toMatchObject({ url, mimeType: 'image/png', bytes: Buffer.from([1, 2, 3]) });
      expect(resourceUrl(`//${host}/image.png`).href).toBe(`https://${host}/image.png`);
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(bridge.getCookie).not.toHaveBeenCalled();
    for (const url of ['https://alipic.lanhuapp.com.evil.test/x', 'https://assets.lanhuapp.com:4430/x', 'file:///x', '//127.0.0.1/x'])
      expect(() => resourceUrl(url)).toThrow(AppError);
  });
  it('解析 hash、普通查询与分离设计稿链接，拒绝伪装域名', () => {
    expect(parseLanhuLink('https://lanhuapp.com/web/#/item/project/stage?pid=p&tid=t&image_id=i&versionId=v&pageId=pg'))
      .toEqual({ project_id: 'p', team_id: 't', image_id: 'i', doc_id: 'i', version_id: 'v', page_id: 'pg' });
    expect(parseLanhuLink('https://lanhuapp.com/web/?pid=p&docId=d').doc_id).toBe('d');
    expect(parseLanhuLink('?project_id=p&team_id=t').team_id).toBe('t');
    expect(parseLanhuLink('https://lanhuapp.com/web/#/item/project/detailDetach?pid=p&image_id=i').image_id).toBe('i');
    expect(() => parseLanhuLink('https://lanhuapp.com.evil.test/?pid=p')).toThrow(AppError);
    expect(() => parseLanhuLink('https://lanhuapp.com/')).toThrow(AppError);
  });

  it('六个原始 API 映射正确，详情使用 pid，DDS 使用独立域名及请求头', async () => {
    const seen: { url: URL; headers: Headers }[] = [];
    const { api, bridge } = fixture((url, init) => { seen.push({ url, headers: new Headers(init.headers) }); return json({ code: '00000', data: {} }); });
    await api.project({ project_id: 'p', team_id: 't' });
    await api.documents({ project_id: 'p', team_id: 't' });
    await api.design({ project_id: 'p', image_id: 'i', team_id: 't' });
    await api.designs({ project_id: 'p', comment: 0 });
    await api.sectors('p'); await api.schema('v');
    expect(seen.map(item => item.url.pathname)).toEqual(['/api/project/multi_info', '/api/project/product_documents',
      '/api/project/image', '/api/project/images', '/api/project/project_sectors', '/api/dds/image/store_schema_revise']);
    expect(Object.fromEntries(seen[0].url.searchParams)).toMatchObject({ project_id: 'p', team_id: 't', img_limit: '500', detach: '1' });
    expect(Object.fromEntries(seen[2].url.searchParams)).toEqual({ pid: 'p', image_id: 'i', team_id: 't', dds_status: '1' });
    expect(seen[3].url.searchParams.get('comment')).toBe('0');
    expect(seen[5].url.origin).toBe('https://dds.lanhuapp.com');
    expect(seen[5].headers.get('authorization')).toBe('Basic dW5kZWZpbmVkOg==');
    seen.forEach(({ url, headers }) => {
      expect(bridge.getCookie).toHaveBeenCalledWith(url.href);
      expect(headers.get('cookie')).toBe(secret);
    });
  });

  it('未登录时尝试打开登录页并阻止请求；自动刷新成功后继续，按目标 URL 再校验凭据', async () => {
    const { api, bridge, fetcher } = fixture(() => json({ code: 0, data: {} }));
    bridge.loginStatus.mockReturnValue(checkLoginCookie(''));
    bridge.checkLogin.mockResolvedValue({ login: checkLoginCookie(''), loginPageOpened: true });
    await expect(api.sectors('p')).rejects.toMatchObject({ code: 'LOGIN_REQUIRED', message: expect.stringContaining('已打开登录页') });
    expect(fetcher).not.toHaveBeenCalled();
    bridge.checkLogin.mockResolvedValue({ login: checkLoginCookie(secret), loginPageOpened: false });
    await api.sectors('p'); expect(fetcher).toHaveBeenCalledTimes(1);
    bridge.getCookie.mockReturnValue({ cookie: 'session=private-scope', mode: 'manual', url: null });
    await expect(api.schema('v')).rejects.toMatchObject({ code: 'COOKIE_SCOPE_MISMATCH' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('响应 HTTP/业务错误、无效 JSON、网络异常不回显上游正文或凭据', async () => {
    for (const [response, code] of [[json({ secret }, 401), 'LOGIN_REJECTED'], [json({ secret }, 403), 'ACCESS_DENIED'],
      [json({ secret }, 500), 'UPSTREAM_HTTP_ERROR'], [json({ code: '10009', msg: secret }), 'UPSTREAM_API_ERROR'],
      [new Response(`<html>${secret}</html>`), 'INVALID_UPSTREAM_JSON'],
      [new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }), 'UPSTREAM_HTTP_ERROR']] as const) {
      const { api, fetcher } = fixture(() => response);
      const error = await api.sectors('p').catch(error => error);
      expect(error.code).toBe(code); expect(error.message).not.toContain('private-fixture');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual', method: 'GET' });
    }
    const { api } = fixture(() => { throw new Error(secret); });
    await expect(api.sectors('p')).rejects.toMatchObject({ code: 'UPSTREAM_REQUEST_FAILED', message: expect.not.stringContaining('private-fixture') });
  });

  it('产品文档清洗支持 result/data、过滤无 ID 条目、分页及编码后的链接', async () => {
    expect(documentTime('Fri, 09 Jan 2026 10:07:29 GMT')).toBe('2026-01-09 18:07:29');
    expect(documentTime('not-a-date')).toBe('not-a-date');
    expect(documentTime(null)).toBeNull();
    const { api } = fixture(() => json({ code: 0, result: { resources: [{ id: 'd1', name: 'A', size: 123 }, { name: 'invalid' }, { id: 'd2', name: 'B' }] } }));
    const first = await api.listDocuments({ project_id: 'p', team_id: 't', limit: 1 });
    expect(first).toMatchObject({ total_documents: 2, next_offset: 1, documents: [{ doc_id: 'd1', size_bytes: 123 }] });
    expect(first.documents[0].doc_url).toContain('docId=d1');
    expect(await api.listDocuments({ project_id: 'p', team_id: 't', offset: 1, limit: 1 }))
      .toMatchObject({ next_offset: null, documents: [{ doc_id: 'd2' }] });
  });

  it('分组层级关联、环防护与部分接口失败的明确警告', async () => {
    const sectors = [{ id: 'parent', name: '父', images: [] }, { id: 'child', parent_id: 'parent', name: '子', images: ['i'] }];
    const { api } = fixture(url => json({ code: '00000', data: url.pathname.endsWith('project_sectors') ? { sectors } : { name: '项目', images: [{ id: 'i', name: '稿' }, { id: 'other' }] } }));
    const result = await api.listDesigns({ project_id: 'p', limit: 1 });
    expect(result).toMatchObject({ total_designs: 2, total_sectors: 2, ungrouped_design_count: 1, next_offset: 1,
      designs: [{ sectors: ['子'], sector_paths: ['父/子'] }] });
    expect(normalizeSectors([{ id: 'a', name: 'A', parent_id: 'b' }, { id: 'b', name: 'B', parent_id: 'a' }]).sectors).toHaveLength(2);
    const broken = fixture(url => url.pathname.endsWith('project_sectors') ? json({ code: 'no', msg: secret }) : json({ code: 0, data: { images: [{ id: 'i' }] } }));
    expect(await broken.api.listDesigns({ project_id: 'p' })).toMatchObject({ total_designs: 1, sector_warning: { code: 'UPSTREAM_API_ERROR' } });
  });

  it('切图读取最新 json_url、同时遍历 layers/children、倍率保留已有签名查询、不向 OSS 发送 Cookie', async () => {
    const resource = 'https://lanhu.oss-cn-beijing.aliyuncs.com/design.json?signature=fixture';
    const image = 'https://lanhu.oss-cn-beijing.aliyuncs.com/icon.png?signature=fixture';
    const { api, fetcher } = fixture(url => url.hostname === 'lanhuapp.com'
      ? json({ code: '00000', result: { versions: [{ json_url: resource }] } })
      : json({ sliceScale: 2, layers: [{ id: 'a', imageUrl: image, frame: { x: 1, y: 2, width: 20, height: 10 } }],
        children: [{ id: 'b', exportable: true, url: image, bounds: { width: 10, height: 5 } }] }));
    const result = await api.slices({ project_id: 'p', image_id: 'i', limit: 1 });
    expect(result).toMatchObject({ total_slices: 2, next_offset: 1, slices: [{ slice_id: 'a', bounds: { x: 1, y: 2, width: 20, height: 10 } }] });
    const scale = result.slices[0].scale_urls;
    expect(scale['2x']).toBe(image);
    expect(new URL(scale['1x']).searchParams.get('signature')).toBe('fixture');
    expect(new URL(scale['1x']).searchParams.get('x-oss-process')).toBe('image/resize,w_20,h_10/format,png');
    expect(new URL(scale.android_xxxhdpi).searchParams.get('x-oss-process')).toBeNull();
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).has('cookie')).toBe(false);
    expect(scaleUrls(image, 0, 0, 2)).toEqual({});
  });

  it('切图没有源文件时明确报错，拒绝未知资源域名及重定向，资源无需登录', async () => {
    for (const value of ['http://lanhuapp.com/x', 'https://127.0.0.1/a', 'https://lanhuapp.com.evil.test/a',
      'https://lanhuapp.com:444/a', 'https://name:password@lanhuapp.com/a', 'https://other.oss-cn-beijing.aliyuncs.com/a',
      'https://lanhu.oss-cn-beijing-internal.aliyuncs.com/a']) expect(() => resourceUrl(value)).toThrow(AppError);
    const { api, bridge, fetcher } = fixture(() => json({ code: '00000', result: { versions: [] } }));
    await expect(api.slices({ project_id: 'p', image_id: 'i' })).rejects.toMatchObject({ code: 'DESIGN_DATA_MISSING' });
    bridge.loginStatus.mockReturnValue(checkLoginCookie(''));
    await api.resource('https://axure-file.lanhuapp.com/example.json');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(bridge.checkLogin).not.toHaveBeenCalled();
    const blocked = fixture(() => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }));
    await expect(blocked.api.resource('https://lanhuapp.com/x')).rejects.toMatchObject({ code: 'UPSTREAM_HTTP_ERROR' });
    expect(blocked.fetcher).toHaveBeenCalledTimes(1);
  });

  it('支持来源项目真实结构的 Sketch info 与 Photoshop board/isAsset，避免遗漏或重复', async () => {
    const image = 'https://lanhu-dds-backend.oss-cn-beijing.aliyuncs.com/export.png';
    const sketch = { sliceScale: 2, info: [{ id: 'sketch', exportable: true, left: 460, top: 709, width: 1000, height: 111,
      image: { imageUrl: image, point: { x: -999, y: -444 } } }] };
    const ps = { type: 'ps', sliceScale: 2, info: [], board: { layers: [{ id: 7423, isAsset: true, isSlice: false,
      left: 428, top: 978, width: 196, height: 57, images: { png_xxxhd: image } }] },
      assets: [{ id: 7423, isAsset: true, images: { png_xxxhd: image }, bounds: { left: 428, top: 978, right: 624, bottom: 1035 } }] };
    for (const [payload, id, bounds] of [[sketch, 'sketch', { x: 460, y: 709, width: 1000, height: 111 }],
      [ps, '7423', { x: 428, y: 978, width: 196, height: 57 }]] as const) {
      const { api } = fixture(url => url.pathname === '/api/project/image'
        ? json({ code: '00000', result: { versions: [{ json_url: 'https://lanhu.oss-cn-beijing.aliyuncs.com/design.json' }] } }) : json(payload));
      expect(await api.slices({ project_id: 'p', image_id: 'i' })).toMatchObject({ total_slices: 1, slices: [{ slice_id: id, url: image, bounds }] });
    }
  });

  it('响应头和实际流大小均受限，流读取超限会取消', async () => {
    const fixture1 = fixture(() => new Response('x', { headers: { 'content-length': String(9 * 1024 * 1024) } }));
    await expect(fixture1.api.resource('https://lanhuapp.com/x')).rejects.toMatchObject({ code: 'RESOURCE_TOO_LARGE' });
    const cancel = vi.fn();
    const fixture2 = fixture(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9 * 1024 * 1024)); }, cancel })));
    await expect(fixture2.api.resource('https://lanhuapp.com/x')).rejects.toMatchObject({ code: 'RESOURCE_TOO_LARGE' });
    expect(cancel).toHaveBeenCalled();
  });
});
