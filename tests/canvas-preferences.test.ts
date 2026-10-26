import { expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerCanvasPreferences } from '../src/canvas-preferences';
import { savedProject } from '../panel/canvas/project-memory.js';

it('项目记忆单独落盘，不含 Cookie，重新创建 MCP 会话仍可恢复，不接受任意链接', async () => {
  await mkdir('.cache', { recursive: true }); const directory = await mkdtemp(path.resolve('.cache/preferences-test-'));
  vi.stubEnv('PLUGIN_DATA', directory);
  const connect = async () => {
    const server = new McpServer({ name: 'preferences', version: '1' }); registerCanvasPreferences(server);
    const client = new Client({ name: 'test', version: '1' }); const [left, right] = InMemoryTransport.createLinkedPair();
    await server.connect(left); await client.connect(right); return { server, client };
  };
  let current = await connect();
  const route = { project_id: 'project', team_id: 'team', image_id: 'image' };
  try {
    expect((await current.client.callTool({ name: 'lanhu_canvas_preferences', arguments: {} }))._meta?.['lanhu/savedRoute']).toBeNull();
    const saved = await current.client.callTool({ name: 'lanhu_canvas_preferences', arguments: { route } });
    expect(saved.isError).not.toBe(true);
    expect(JSON.parse(await readFile(path.join(directory, 'canvas-state.json'), 'utf8'))).toEqual({ route });
    await current.client.close(); await current.server.close(); current = await connect();
    expect((await current.client.callTool({ name: 'lanhu_canvas_preferences', arguments: {} }))._meta?.['lanhu/savedRoute']).toEqual(route);
    const hash = 'a'.repeat(64);
    await Promise.all([
      current.client.callTool({ name: 'lanhu_canvas_preferences', arguments: { group: { project_id: 'project', team_id: 'team', group_id: 'sector-b' } } }),
      current.client.callTool({ name: 'lanhu_canvas_preferences', arguments: { seen_link: hash } })
    ]);
    await current.client.callTool({ name: 'lanhu_canvas_preferences', arguments: { route: { project_id: 'other' } } });
    await current.client.close(); await current.server.close(); current = await connect();
    const restored = await current.client.callTool({ name: 'lanhu_canvas_preferences', arguments: {} });
    expect(restored._meta?.['lanhu/groups']).toEqual({ 'team:project': 'sector-b' });
    expect(restored._meta?.['lanhu/seenLinks']).toEqual([hash]);
    expect(restored._meta?.['lanhu/savedRoute']).toEqual({ project_id: 'other' });
    expect(await readFile(path.join(directory, 'canvas-state.json'), 'utf8')).not.toContain('lanhuapp.com');
    expect((await current.client.callTool({ name: 'lanhu_canvas_preferences', arguments: { route: { project_id: 'https://evil' } } })).isError).toBe(true);
    expect(savedProject({ project_id: '../private' })).toBeNull();
    expect(savedProject({ project_id: 'p', COOKIE: 'never-propagated' })).toEqual({ project_id: 'p' });
  } finally {
    await current.client.close(); await current.server.close(); vi.unstubAllEnvs();
    if (path.dirname(directory) !== path.resolve('.cache') || !path.basename(directory).startsWith('preferences-test-')) throw new Error('Unsafe cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
