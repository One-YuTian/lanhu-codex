import { afterEach, expect, it, vi } from 'vitest';
import { DraftInbox } from '../src/draft-inbox';
import { draftMessage } from '../panel/draft-message';
import { OpenAIMessageParamsSchema } from '@openai/mcp-extensions/app';
import { OpenAIMentionSearchResultSchema } from '@openai/mcp-extensions/server';

afterEach(() => vi.useRealTimers());
it('多选名称以独立资源引用追加，而非普通正文或带标题文本附件', () => {
  const payload = { title: '首页、详情', prompt: 'project=p', items: [{ title: '首页', prompt: 'home-id' }, { title: '详情', prompt: 'detail-id' }] };
  const message = OpenAIMessageParamsSchema.parse(draftMessage({ ...payload, id: 'selection-id' }));
  expect(message.content).toHaveLength(2);
  expect(message.content).toMatchObject([
    { type: 'resource_link', name: '首页', uri: 'lanhu://selection/selection-id/0' },
    { type: 'resource_link', name: '详情', uri: 'lanhu://selection/selection-id/1' }
  ]);
  expect(message.content[0]._meta).toBeUndefined();
  expect(message._meta?.['openai/message']).toEqual({ target: 'active', send: false });
});
it('资源引用只包含元信息，完整内容通过资源读取', () => {
  const message = OpenAIMessageParamsSchema.parse(draftMessage({ id: 'selection-id', title: '画布摘要', prompt: '完整对象与 MCP 指令' }));
  expect(message._meta?.['openai/message']).toEqual({ target: 'active', send: false });
  expect(message.content[0]).toMatchObject({ type: 'resource_link', name: '画布摘要', uri: 'lanhu://selection/selection-id/0' });
  expect(JSON.stringify(message)).not.toContain('openai/title');
  expect(JSON.stringify(message)).not.toContain('完整对象与 MCP 指令');
});
it('多条标注分别生成可用于官方 Mentions 的引用，不合并成一个块', () => {
  const inbox = new DraftInbox();
  const links = inbox.register(Array.from({ length: 4 }, (_, index) => ({ title: `标注 ${index + 1}`, prompt: `page-${index}` })));
  expect(links).toHaveLength(4);
  expect(OpenAIMentionSearchResultSchema.parse({ items: links }).items).toHaveLength(4);
  inbox.dispose();
});
it('标注资源按 TTL 失效，释放后不可读取', () => {
  let now = 0;
  const inbox = new DraftInbox({ now: () => now });
  const links = inbox.register([{ title: '页面', prompt: 'page-data' }]);
  const id = links[0].uri.split('/')[3];
  expect(inbox.getSelection(id).items).toEqual([{ title: '页面', prompt: 'page-data' }]);
  now = 24 * 60 * 60 * 1000;
  expect(() => inbox.getSelection(id)).toThrow('引用已失效');
  inbox.dispose();
});
