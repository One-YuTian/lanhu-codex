import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Bridge } from '../src/bridge';
import { createMcpServer } from '../src/mcp';
import { CANVAS_URI } from '../src/canvas-panel';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { nativeTransport } from '../panel/canvas-transport';

const bridges: Bridge[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(bridges.splice(0).map(bridge => bridge.close())); });
describe('无端口的原生蓝湖画布', () => {
  it('没有监听任何 HTTP 端口时，原生面板仍可经 MCP 读取项目、头像、设计 JSON 和 OSS 图片', async () => {
    const secret = `user_token=head.${Buffer.from('{"sub":"fixture"}').toString('base64url')}.sig`;
    const bridge = new Bridge({ cookie: secret }); bridges.push(bridge);
    const requests: URL[] = [];
    vi.stubGlobal('fetch', async (input: any, init?: RequestInit) => {
      const url = new URL(String(input)); requests.push(url);
      expect(url.protocol).toBe('https:');
      expect(url.hostname).not.toMatch(/localhost|127\.0\.0\.1/);
      if (url.hostname === 'lanhuapp.com') {
        expect(new Headers(init?.headers).get('cookie')).toBe(secret);
        return Response.json({ code: '00000', result: { id: 'fixture-user', name: 'MCP 项目', avatar: 'https://assets.lanhuapp.com/avatar.png' } });
      }
      expect(new Headers(init?.headers).has('cookie')).toBe(false);
      expect(new Headers(init?.headers).get('referer')).toBe('https://lanhuapp.com/web/');
      return url.pathname.endsWith('.json') ? Response.json({ artboard: { layers: [] } }) : new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } });
    });
    const server = createMcpServer(bridge, { loadCookie: async () => undefined, saveCookie: async () => undefined });
    const client = new Client({ name: 'native-canvas', version: '1' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const opened = await client.callTool({ name: 'lanhu_open_canvas', arguments: { project_id: 'project' } });
      expect(opened.isError).not.toBe(true);
      expect(opened._meta?.['lanhu/route']).toEqual({ project_id: 'project' });
      expect(opened._meta).not.toHaveProperty('lanhu/canvasUrl');
      const tool = (await client.listTools()).tools.find(tool => tool.name === 'lanhu_canvas_request')!;
      expect(tool._meta?.ui).toEqual({ visibility: ['app'] });
      const transport = nativeTransport({ callServerTool: params => client.callTool(params), openLink: vi.fn() } as any);
      const project = await (await transport.fetch('/api/project?project_id=project&team_id=team')).json();
      expect(project.result.name).toBe('MCP 项目');
      const profile = await (await transport.fetch('/api/profile?team_id=team')).json();
      expect(profile.avatar).toBe('https://assets.lanhuapp.com/avatar.png');
      const schema = await (await transport.fetch('/api/resource?url=https%3A%2F%2Falipic.lanhuapp.com%2Fschema.json')).json();
      expect(schema).toEqual({ artboard: { layers: [] } });
      const image = await transport.fetch('/api/resource?url=https%3A%2F%2Falipic.lanhuapp.com%2Fslice.png&width=128&height=64&format=webp');
      expect(image.headers.get('content-type')).toBe('image/webp');
      expect([...new Uint8Array(await image.arrayBuffer())]).toEqual([1, 2, 3]);
      expect(requests.at(-1)!.searchParams.get('x-oss-process')).toBe('image/resize,m_fill,w_128,h_64,limit_0/format,webp');
      const status = await (await transport.fetch('/api/status')).json();
      expect(status).not.toHaveProperty('port');
      expect(JSON.stringify(status)).not.toContain(secret);
      await expect(transport.fetch('/api/resource?url=http%3A%2F%2F127.0.0.1%2Fprivate')).rejects.toThrow();
      await expect(transport.fetch('/api/design?project_id=project')).rejects.toThrow();
      await expect(transport.fetch('http://127.0.0.1:19989/api/status')).rejects.toThrow();
      const resource = await client.readResource({ uri: CANVAS_URI });
      const html = resource.contents[0].text as string;
      expect(html).not.toMatch(/<iframe\b|<script[^>]+src=|<link[^>]+stylesheet|<img[^>]+src="\//i);
      expect(html).toContain('id="navigation"');
      expect(html).toContain('data:image/svg+xml;base64,');
      expect(html).toContain('<symbol id="lh-icon-image-down"');
      const ids = [...html.split('<script>')[0].matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
      expect(ids.length).toBe(new Set(ids).size);
      expect(html).not.toMatch(/<symbol id="(navigation|search|share)"/);
      expect(resource.contents[0]._meta?.ui).toMatchObject({ csp: { connectDomains: [], resourceDomains: [], frameDomains: [] } });
    } finally { await client.close(); await server.close(); }
  });
  it('原生通道限制并发、转发取消信号，外链通过宿主打开', async () => {
    let active = 0, maximum = 0;
    const app = { callServerTool: vi.fn(async () => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2)); active--;
      return { content: [], _meta: { 'lanhu/response': { data: { ok: true } } } };
    }), openLink: vi.fn() };
    const transport = nativeTransport(app as any);
    await Promise.all(Array.from({ length: 12 }, () => transport.fetch('/api/status')));
    expect(maximum).toBe(4);
    const controller = new AbortController(); controller.abort();
    await expect(transport.fetch('/api/status', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(app.callServerTool).toHaveBeenCalledTimes(12);
    transport.open('https://lanhuapp.com/web/');
    expect(app.openLink).toHaveBeenCalledWith({ url: 'https://lanhuapp.com/web/' });
  });
  it('MCP UI 默认与对话共存、支持手动全屏、只传递已校验的项目参数', async () => {
    const bridge = new Bridge(); bridges.push(bridge);
    const server = createMcpServer(bridge, { loadCookie: async () => undefined, saveCookie: async () => undefined });
    const client = new Client({ name: 'canvas-test', version: '1' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const tool = (await client.listTools()).tools.find(tool => tool.name === 'lanhu_open_canvas')!;
      expect(tool._meta?.['openai/ui']).toMatchObject({ entrypoints: [{ type: 'global' }, { type: 'thread' }], preferredModelDisplayMode: 'inline' });
      expect(tool.inputSchema.required || []).not.toContain('project_id');
      const image = client.getServerVersion()!.icons![0];
      expect(image.mimeType).toBe('image/png');
      const metadata = await sharp(Buffer.from(image.src.split(',')[1], 'base64')).metadata();
      expect(metadata).toMatchObject({ width: 80, height: 80, hasAlpha: true });
      expect(image.src).toBe(`data:image/png;base64,${(await readFile('assets/sidebar-icon.png')).toString('base64')}`);
      const homepage = await client.callTool({ name: 'lanhu_open_canvas', arguments: {} });
      expect(homepage.isError).not.toBe(true);
      expect(homepage._meta).not.toHaveProperty('lanhu/canvasUrl');
      expect((await client.callTool({ name: 'lanhu_open_canvas', arguments: { image_id: 'image' } })).isError).toBe(true);
      const result = await client.callTool({ name: 'lanhu_open_canvas', arguments: { project_id: 'project', team_id: 'team', image_id: 'image' } });
      expect(result._meta?.['lanhu/route']).toEqual({ project_id: 'project', team_id: 'team', image_id: 'image' });
      const resource = await client.readResource({ uri: CANVAS_URI });
      expect(resource.contents[0]._meta?.['openai/ui']).toMatchObject({ availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'inline' });
      expect(resource.contents[0].text).toContain('width:100vw;height:100vh');
      expect((await client.callTool({ name: 'lanhu_open_canvas', arguments: { project_id: '../bad' } })).isError).toBe(true);
    } finally { await client.close(); await server.close(); }
  });
});
