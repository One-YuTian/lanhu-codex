import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Bridge } from './bridge';
import type { OpenAIUiToolMetadata } from '@openai/mcp-extensions/server';
import { CompressionQueue } from './compression';
import { MCP_VERSION } from './runtime-version';
import { compressionPreferences } from './compression-preferences';
import { pickImages } from './compression-import';

export const COMPRESSION_URI = `ui://lanhu/compression/${MCP_VERSION}`;
const queues = new WeakMap<Bridge, CompressionQueue>();
export function registerCompression(server: McpServer, bridge: Bridge) {
  let queue = queues.get(bridge);
  if (!queue) { queue = new CompressionQueue(); queues.set(bridge, queue); }
  const state = queue;
  server.registerResource('lanhu-compression', COMPRESSION_URI, { mimeType: 'text/html;profile=mcp-app' }, async () => {
    const root = /[\\/]src$/.test(__dirname) ? path.resolve(__dirname, '../package') : /[\\/]dev$/.test(__dirname) ? path.resolve(__dirname, '..') : __dirname;
    return { contents: [{ uri: COMPRESSION_URI, mimeType: 'text/html;profile=mcp-app', text: await readFile(path.join(root, 'compression.html'), 'utf8'),
      _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [], frameDomains: [] } }, 'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'inline' } } }] };
  });
  server.registerTool('lanhu_compressed_picture', {
    title: '蓝湖图片压缩', description: '打开内联图片压缩面板。可用 paths 添加用户指定的图片或目录绝对路径。仅需打开面板时，调用后结束，不追加说明。',
    inputSchema: { paths: z.array(z.string().min(1).max(32768)).max(100).optional() }, annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: COMPRESSION_URI }, 'openai/ui': { entrypoints: [{ type: 'thread' }], preferredModelDisplayMode: 'inline' } satisfies OpenAIUiToolMetadata }
  }, async ({ paths }) => ({ content: [], _meta: { 'lanhu/compression': paths?.length ? await state.add(paths) : { items: state.snapshot() } } }));
  server.registerTool('lanhu_compression_list', { title: '添加或查看待压缩图片', description: '添加用户指定的图片或目录，或读取当前任务列表。传 paths 添加路径；不传时只查询。已开启自动开始的面板会处理新增项。',
    inputSchema: { paths: z.array(z.string().min(1).max(32768)).max(100).optional() }, annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ paths }) => ({ content: [{ type: 'text', text: JSON.stringify(paths?.length ? await state.add(paths) : { items: state.snapshot() }) }] }));
  server.registerTool('lanhu_compression_run', { title: '压缩并安全替换图片', description: '按用户指令将列表中的一张图片发送至压缩服务处理并同名替换原图。id 必须取自任务列表，返回 status 表示结果。',
    inputSchema: { id: z.string().min(1).max(32768) }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
  }, async ({ id }) => { try { const item = await state.process(id); return { isError: item.status === 'error' || undefined, content: [{ type: 'text', text: JSON.stringify(item) }] }; } catch (error) { return { isError: true, content: [{ type: 'text', text: (error as Error).message }] }; } });
  server.registerTool('lanhu_compression_preferences', { title: '图片压缩设置', description: '读取或保存自动开始（默认是）和并发数（默认 5，范围 1–20）。',
    inputSchema: { auto_start: z.boolean().optional(), concurrency: z.number().int().min(1).max(20).optional() }, _meta: { ui: { visibility: ['app'] } }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  }, async ({ auto_start, concurrency }) => {
    try { return { content: [], _meta: { 'lanhu/compression': await compressionPreferences(auto_start === undefined && concurrency === undefined ? undefined : { ...(auto_start !== undefined ? { auto_start } : {}), ...(concurrency !== undefined ? { concurrency } : {}) }) } }; }
    catch { return { isError: true, content: [{ type: 'text', text: '无法读取或保存自动开始设置' }] }; }
  });
  server.registerTool('lanhu_compression_thumbnail', { title: '读取图片缩略图源', description: '返回列表图片的预览数据，供面板显示。',
    inputSchema: { id: z.string().min(1).max(32768), offset: z.number().int().min(0).max(32 * 1024 * 1024).optional() }, _meta: { ui: { visibility: ['app'] } }, annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ id, offset }) => {
    try { return { content: [], _meta: { 'lanhu/compression': await state.previewChunk(id, offset) } }; }
    catch { return { isError: true, content: [{ type: 'text', text: '无法读取图片预览' }] }; }
  });
  server.registerTool('lanhu_compression_import', { title: '添加图片', description: '通过系统原生文件选择器多选图片并添加队列，取消不报错；不支持目录或拖入。',
    inputSchema: {}, _meta: { ui: { visibility: ['app'] } }, annotations: { readOnlyHint: true, openWorldHint: false }
  }, async () => {
    try {
      const selected = await pickImages();
      return { content: [], _meta: { 'lanhu/compression': selected.length ? await state.add(selected) : { cancelled: true } } };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: (error as Error).message }] }; }
  });
  server.registerTool('lanhu_compression_remove', { title: '移除压缩列表项', description: '仅移除待压缩列表中的项目，不删除磁盘文件。', inputSchema: { ids: z.array(z.string()).max(5000) },
    _meta: { ui: { visibility: ['app'] } }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ ids }) => ({ content: [], _meta: { 'lanhu/compression': { items: state.remove(ids) } } }));
}
