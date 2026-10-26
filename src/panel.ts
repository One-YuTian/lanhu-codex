import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OpenAIUiToolMetadata, OpenAIUiResourceMetadata } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { errorInfo } from './shared';
import { DraftInbox } from './draft-inbox';

export const PANEL_URI = 'ui://lanhu/receiver/0.1.25';
export const PANEL_TOOL_NAMES = ['lanhu_open_receiver', 'lanhu_receiver_poll', 'lanhu_receiver_ack', 'lanhu_receiver_close'] as const;
export async function panelHtml() {
  const candidates = ['panel.html', '../panel.html', '../dist/panel.html'];
  for (const relative of candidates) {
    try { return await readFile(path.resolve(__dirname, relative), 'utf8'); } catch { /* Try source/dev/packaged layout. */ }
  }
  throw new Error('Panel bundle missing');
}
export function registerPanel(server: McpServer, inbox: DraftInbox) {
  server.registerResource('lanhu-receiver', PANEL_URI, { mimeType: 'text/html;profile=mcp-app' }, async () => ({
    contents: [{ uri: PANEL_URI, mimeType: 'text/html;profile=mcp-app', text: await panelHtml(),
      _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
        'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'inline' } satisfies OpenAIUiResourceMetadata } }]
  }));
  server.registerTool('lanhu_open_receiver', { title: '蓝湖接收面板',
    description: '初始化当前会话的蓝湖接收器，默认以紧凑内联界面显示，不主动展开。初始化后可折叠到后台继续接收；Chrome 右键发送内容会追加到当前草稿，由用户手动确认发送。',
    inputSchema: {}, annotations: { destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: PANEL_URI }, 'openai/ui': { entrypoints: [{ type: 'thread' }], preferredModelDisplayMode: 'inline' } satisfies OpenAIUiToolMetadata }
  }, async () => ({ content: [{ type: 'text' as const, text: '已返回蓝湖接收面板入口，尚未确认界面加载或 Composer 写入。请以面板连接状态及草稿添加回执为准。' }],
    _meta: { 'lanhu/panel': { token: inbox.open() } } }));
  const token = z.string().uuid();
  const appOnly = { ui: { visibility: ['app'] } };
  const wrap = async (fn: () => Record<string, unknown> | Promise<Record<string, unknown>>) => {
    try { return { content: [], _meta: await fn() }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(errorInfo(error)) }] }; }
  };
  server.registerTool('lanhu_receiver_poll', { title: '接收待添加内容', inputSchema: { token, visible: z.boolean(), wait_ms: z.number().int().min(0).max(25_000).optional(), mentions_supported: z.boolean().optional() },
    annotations: { destructiveHint: false, openWorldHint: false }, _meta: appOnly
  }, args => wrap(async () => ({ 'lanhu/draft': await inbox.receive(args.token, args.visible, args.wait_ms, args.mentions_supported) })));
  server.registerTool('lanhu_receiver_ack', { title: '确认草稿添加结果', inputSchema: { token, draft_id: z.string().uuid(), inserted: z.boolean() }, _meta: appOnly
  }, args => wrap(() => inbox.ack(args.token, args.draft_id, args.inserted)));
  server.registerTool('lanhu_receiver_close', { title: '关闭接收面板', inputSchema: { token }, _meta: appOnly
  }, args => wrap(() => { inbox.closePanel(args.token); return {}; }));
}
