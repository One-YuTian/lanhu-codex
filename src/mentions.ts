import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppError } from './shared';
import type { DraftInbox } from './draft-inbox';

export function registerMentions(server: McpServer, inbox: DraftInbox) {
  server.registerTool('lanhu_prepare_annotations', {
    title: '准备标注指令块', description: '仅供画布将每条标注登记为独立带标题的资源引用；不会发送消息。',
    inputSchema: { items: z.array(z.object({ title: z.string().trim().min(1).max(1024), prompt: z.string().trim().min(1).max(60000) }).strict()).min(1).max(200) },
    _meta: { ui: { visibility: ['app'] } }
  }, async ({ items }) => {
    if (items.reduce((length, item) => length + item.prompt.length, 0) > 60000) throw new AppError('ANNOTATIONS_TOO_LARGE', '标注内容过长');
    return { content: [], _meta: { 'lanhu/annotationLinks': inbox.register(items) } };
  });
  server.registerResource('lanhu-selection', new ResourceTemplate('lanhu://selection/{selection_id}/{item_index}', { list: undefined }),
    { mimeType: 'application/json', description: '用户从蓝湖追加到 Composer 的页面或对象引用，完整内容按引用范围读取。' },
    async uri => {
      const match = /^lanhu:\/\/selection\/([a-f\d-]+)\/(0|[1-9]\d{0,2})$/i.exec(uri.href);
      if (!match || !z.string().uuid().safeParse(match[1]).success) throw new AppError('INVALID_SELECTION_URI', '蓝湖资源引用格式不正确');
      const selection = inbox.getSelection(match[1]);
      const item = (selection.items?.length ? selection.items : [selection])[Number(match[2])];
      if (!item) throw new AppError('INVALID_SELECTION_URI', '蓝湖资源引用中不存在此对象');
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({
        selection_id: selection.selection_id, item_index: Number(match[2]), title: item.title,
        prompt: item.prompt, expires_at: selection.expires_at
      }) }] };
    });
}
