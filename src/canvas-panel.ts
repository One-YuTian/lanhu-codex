import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Bridge } from './bridge';
import type { OpenAIUiToolMetadata } from '@openai/mcp-extensions/server';
import { errorInfo } from './shared';
import { canvasReader } from './canvas';
import { processedAssetUrl } from './assets.mjs';
import { registerCanvasPreferences } from './canvas-preferences';
import { canvasLoginStatus } from './login';
import { clipboardLinks } from './canvas-clipboard';
import { MCP_VERSION } from './runtime-version';

export const CANVAS_URI = `ui://lanhu/canvas/${MCP_VERSION}`;
export function registerCanvas(server: McpServer, bridge: Bridge) {
  registerCanvasPreferences(server);
  server.registerResource('lanhu-canvas', CANVAS_URI, { mimeType: 'text/html;profile=mcp-app' }, async () => {
    const root = /[\\/]src$/.test(__dirname) ? path.resolve(__dirname, '../dist') : /[\\/]dev$/.test(__dirname) ? path.resolve(__dirname, '..') : __dirname;
    return { contents: [{ uri: CANVAS_URI, mimeType: 'text/html;profile=mcp-app', text: await readFile(path.join(root, 'canvas.html'), 'utf8'),
      _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [], frameDomains: [] } },
        'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'inline' } } }] };
  });
  const id = z.string().trim().min(1).max(256).regex(/^[\w-]+$/);
  server.registerTool('lanhu_open_canvas', { title: '蓝湖',
    description: '打开蓝湖 UI，从对话调用时默认内联显示，与对话共存，可手动切换全屏；也支持会话侧边标签入口。不传参数时恢复最近项目，首次打开显示项目管理面板，可浏览团队文件夹和项目或粘贴蓝湖链接；也可按项目、团队及可选设计稿 ID 浏览最新设计与标注。无需 Chrome 扩展，可使用配置中保存的 Cookie。',
    inputSchema: { project_id: id.optional(), team_id: id.optional(), image_id: id.optional() }, annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: CANVAS_URI }, 'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }], preferredModelDisplayMode: 'inline' } satisfies OpenAIUiToolMetadata }
  }, async args => {
    if (!args.project_id && (args.team_id || args.image_id)) return { isError: true, content: [{ type: 'text', text: '指定团队或设计稿时请同时提供项目 ID。' }] };
    return { content: [{ type: 'text', text: '蓝湖已打开。' }], _meta: { 'lanhu/route': args } };
  });
  const read = canvasReader(bridge);
  const loginStatus = canvasLoginStatus(bridge);
  const routes = { teams: 'lanhu_get_teams', projects: 'lanhu_get_projects', profile: 'lanhu_get_profile', project: 'lanhu_get_project', images: 'lanhu_get_project_images', sectors: 'lanhu_get_project_sectors', design: 'lanhu_get_design', schema: 'lanhu_get_design_schema', slices: 'lanhu_get_design_slices' };
  server.registerTool('lanhu_canvas_request', {
    title: '蓝湖数据通道', description: '仅供内嵌画布读取项目、图层、头像与资源，通过 MCP 直接访问后端，不依赖本机 HTTP 端口。',
    inputSchema: { endpoint: z.enum(['clipboard', 'resolve', 'teams', 'projects', 'profile', 'status', 'project', 'images', 'sectors', 'design', 'schema', 'slices', 'resource']), url: z.string().max(8192).optional(),
      project_id: id.optional(), team_id: id.optional(), folder_id: id.optional(), image_id: id.optional(), version_id: id.optional(),
      offset: z.number().int().min(0).max(1_000_000).optional(), target_url: z.string().min(1).max(8192).optional(),
      width: z.number().int().min(1).max(16383).optional(), height: z.number().int().min(1).max(16383).optional(), format: z.enum(['png', 'webp']).optional() },
    annotations: { readOnlyHint: true, openWorldHint: true }, _meta: { ui: { visibility: ['app'] } }
  }, async ({ endpoint, ...args }) => {
    try {
      if (endpoint === 'clipboard') return { content: [], _meta: { 'lanhu/response': { data: { links: await clipboardLinks() } } } };
      if (endpoint === 'resolve') return { content: [], _meta: { 'lanhu/response': { data: { route: args.url ? await read('lanhu_resolve_link', { url: args.url }) : null } } } };
      if (endpoint === 'status') {
        return { content: [], _meta: { 'lanhu/response': { data: await loginStatus() } } };
      }
      if (endpoint === 'resource') {
        if (!args.target_url) throw new Error('缺少资源地址');
        const target = processedAssetUrl(args.target_url, { width: args.width, height: args.height, format: args.format });
        const result = await read('lanhu_get_resource', { target_url: target });
        const asset = result as { binary: Buffer; mime: string };
        return { content: [], _meta: { 'lanhu/response': { mime: asset.mime, base64: asset.binary.toString('base64') } } };
      }
      const required = endpoint === 'schema' ? ['version_id'] : ['design', 'slices'].includes(endpoint) ? ['project_id', 'image_id'] : endpoint === 'projects' ? ['team_id'] : ['profile', 'teams'].includes(endpoint) ? [] : ['project_id'];
      if (required.some(key => !(args as Record<string, unknown>)[key])) throw new Error(`缺少 ${required.join('、')}`);
      const data = await read(routes[endpoint], args);
      return { content: [], _meta: { 'lanhu/response': { data } } };
    } catch (error) {
      const info = errorInfo(error);
      if (['LOGIN_REQUIRED', 'LOGIN_REJECTED', 'COOKIE_SCOPE_MISMATCH'].includes(info.code)) loginStatus.invalidate();
      return { isError: true, content: [], _meta: { 'lanhu/error': info } };
    }
  });
}
