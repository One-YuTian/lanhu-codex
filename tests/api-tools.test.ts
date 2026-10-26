import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerApiTools } from '../src/api-tools';
import { LanhuApi } from '../src/lanhu-api';
import { checkLoginCookie } from '../src/shared';

describe('业务工具 MCP 协议联调', () => {
  it('按标记 ID 读取和分页，原文开关不传给上游，JSON 资源也过滤重复数据', async () => {
    const api = {
      design: vi.fn(async () => ({ code: '00000', data: { members: ['private'], versions: [{ id: 'v1', json_url: 'https://alipic.lanhuapp.com/design.json' }] } })),
      resource: vi.fn(async () => ({ url: 'https://alipic.lanhuapp.com/design.json', mimeType: 'application/json',
        bytes: Buffer.from(JSON.stringify({ board: { id: 1, layers: [{ id: 2, name: 'btn', text: '领取', sliceBackData: 'huge' }, { id: 3, name: 'bg' }] } })) }))
    };
    const server = new McpServer({ name: 'api-test', version: '1' });
    registerApiTools(server, api as any);
    const client = new Client({ name: 'test', version: '1' });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(st); await client.connect(ct);
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).not.toBe(true);
        return JSON.parse((result.content as any)[0].text);
      };
      expect(await call('lanhu_get_elements', { project_id: 'p', image_id: 'i', object_ids: ['2', 'absent'] }))
        .toMatchObject({ missing_ids: ['absent'], next_offset: null, elements: [{ id: '2', name: 'btn', text: '领取', parent_id: '1' }] });
      const first = await call('lanhu_get_elements', { project_id: 'p', image_id: 'i', limit: 1 });
      expect(first).toMatchObject({ total_elements: 3, next_offset: 1, elements: [{ id: '1' }] });
      const clean = await call('lanhu_get_design', { project_id: 'p', image_id: 'i' });
      expect(clean.data).not.toHaveProperty('members');
      const raw = await call('lanhu_get_design', { project_id: 'p', image_id: 'i', raw: true });
      expect(raw.data.members).toEqual(['private']);
      expect(api.design.mock.calls.at(-1)?.[0]).not.toHaveProperty('raw');
      const resource = await client.callTool({ name: 'lanhu_get_resource', arguments: { target_url: 'https://alipic.lanhuapp.com/design.json' } });
      expect((resource.content as any)[0].resource.text).not.toContain('sliceBackData');
      expect((await client.callTool({ name: 'lanhu_get_elements', arguments: { project_id: 'p', image_id: 'i', version_id: 'absent' } })).isError).toBe(true);
    } finally { await client.close(); await server.close(); }
  });
  it('通过 SDK 调用原始及精简接口，参数校验拒绝无效 ID 与越界分页', async () => {
    const token = `head.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.sig`;
    const cookie = `user_token=${token}`;
    const bridge = { getCookie: () => ({ cookie, mode: 'manual' as const, url: null }),
      loginStatus: () => checkLoginCookie(cookie), checkLogin: async () => ({ login: checkLoginCookie(cookie), loginPageOpened: false }) };
    const fetcher = vi.fn(async () => Response.json({ code: '00000', data: { resources: [{ id: 'd', name: '文档' }] } }));
    const server = new McpServer({ name: 'api-test', version: '1' });
    registerApiTools(server, new LanhuApi(bridge, fetcher));
    const client = new Client({ name: 'test', version: '1' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
      const raw = await call('lanhu_get_project_documents', { project_id: 'p', team_id: 't' });
      expect(JSON.parse((raw.content as any)[0].text)).toMatchObject({ code: '00000' });
      const cleaned = await call('lanhu_list_product_documents', { project_id: 'p', team_id: 't', limit: 1 });
      expect(JSON.parse((cleaned.content as any)[0].text)).toMatchObject({ total_documents: 1, documents: [{ doc_id: 'd' }] });
      expect((await call('lanhu_get_design', { project_id: 'p', image_id: '../x' })).isError).toBe(true);
      expect((await call('lanhu_get_designs', { project_id: 'p', limit: 501 })).isError).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(new URL(fetcher.mock.calls[1][0] as any).searchParams.has('limit')).toBe(false);
    } finally { await client.close(); await server.close(); }
  });

  it('图片、文本和二进制资源内容能经 MCP SDK 返回，错误具有 isError 标记', async () => {
    const fetcher = vi.fn(async (url: any) => {
      const path = new URL(url).pathname;
      return new Response(path === '/data.json' ? '{"fixture":true}' : 'fixture-binary', {
        headers: { 'content-type': path === '/data.json' ? 'application/json' : path === '/image.png' ? 'image/png' : 'application/octet-stream' }
      });
    });
    const bridge = { getCookie: vi.fn(), loginStatus: vi.fn(), checkLogin: vi.fn() };
    const server = new McpServer({ name: 'api-test', version: '1' });
    registerApiTools(server, new LanhuApi(bridge, fetcher));
    const client = new Client({ name: 'test', version: '1' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport); await client.connect(clientTransport);
      const resource = (file: string) => client.callTool({ name: 'lanhu_get_resource', arguments: { target_url: `https://lanhu.oss-cn-beijing.aliyuncs.com/${file}` } });
      expect((await resource('image.png')).content).toEqual([{ type: 'image', mimeType: 'image/png', data: Buffer.from('fixture-binary').toString('base64') }]);
      expect((await resource('data.json')).content).toMatchObject([{ type: 'resource', resource: { mimeType: 'application/json', text: '{"fixture":true}' } }]);
      expect((await resource('file.bin')).content).toMatchObject([{ type: 'resource', resource: { mimeType: 'application/octet-stream', blob: Buffer.from('fixture-binary').toString('base64') } }]);
      const failed = await client.callTool({ name: 'lanhu_get_resource', arguments: { target_url: 'https://evil.test/file' } });
      expect(failed.isError).toBe(true); expect(JSON.parse((failed.content as any)[0].text).code).toBe('INVALID_RESOURCE_URL');
      expect(bridge.getCookie).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
});
