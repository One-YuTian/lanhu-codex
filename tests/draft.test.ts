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
it('宿主未声明资源引用能力时，调用者获得明确失败，不退回普通文本', async () => {
  const inbox = new DraftInbox(); const token = inbox.open(); inbox.poll(token, false, false);
  await expect(inbox.push('private')).rejects.toMatchObject({ code: 'COMPOSER_MENTIONS_UNSUPPORTED' }); inbox.dispose();
});
it('草稿确认和面板隐藏后，选区引用仍能读取完整信息，过期时明确报错', async () => {
  let now = 0;
  const inbox = new DraftInbox({ now: () => now });
  const token = inbox.open(); inbox.poll(token, false);
  const items = [{ title: '首页', prompt: 'home-id' }, { title: '详情', prompt: 'detail-id' }];
  const pending = inbox.push('complete-project-and-selection', '首页、详情', items);
  const draft = inbox.poll(token, false)!;
  inbox.ack(token, draft.id, true); await pending; inbox.closePanel(token);
  expect(inbox.getSelection(draft.id)).toMatchObject({ selection_id: draft.id, prompt: 'complete-project-and-selection', items });
  now = 24 * 60 * 60 * 1000;
  expect(() => inbox.getSelection(draft.id)).toThrow('引用已失效');
  inbox.dispose();
});
it('未确认添加的引用仍保留，服务关闭后清理内存记录', async () => {
  const inbox = new DraftInbox(); const token = inbox.open(); inbox.poll(token, false);
  const pending = inbox.push('full-content'); const draft = inbox.poll(token, false)!;
  const check = expect(pending).rejects.toMatchObject({ code: 'DRAFT_NOT_CONFIRMED' });
  inbox.ack(token, draft.id, false); await check;
  expect(inbox.getSelection(draft.id).prompt).toBe('full-content');
  inbox.dispose(); expect(() => inbox.getSelection(draft.id)).toThrow('引用已失效');
});
it('仅向唯一可见面板投递，等待正确面板的草稿确认，不重复确认', async () => {
  const inbox = new DraftInbox();
  const a = inbox.open(), b = inbox.open();
  await expect(inbox.push('private')).rejects.toMatchObject({ code: 'PANEL_NOT_OPEN' });
  inbox.poll(a, true); inbox.poll(b, true);
  await expect(inbox.push('private')).rejects.toMatchObject({ code: 'PANEL_AMBIGUOUS' });
  inbox.poll(b, false);
  const pending = inbox.push('private', 'summary');
  const draft = inbox.poll(a, true)!;
  expect(draft).toMatchObject({ prompt: 'private', title: 'summary' });
  expect(inbox.poll(b, true)).toBeNull();
  expect(inbox.ack(b, draft.id, true)).toEqual({ accepted: false });
  inbox.poll(b, false);
  await expect(inbox.push('other')).rejects.toMatchObject({ code: 'COMPOSER_BUSY' });
  inbox.ack(a, draft.id, true);
  await expect(pending).resolves.toEqual({ draftId: draft.id });
  expect(inbox.ack(a, draft.id, true)).toEqual({ accepted: false });
  expect(inbox.poll(a, true)).toBeNull(); inbox.dispose();
});
it('过期面板不会收到新请求，超时和关闭结束等待', async () => {
  vi.useFakeTimers();
  const inbox = new DraftInbox({ timeoutMs: 50 });
  const token = inbox.open(); inbox.poll(token, true);
  const pending = inbox.push('p');
  const check = expect(pending).rejects.toMatchObject({ code: 'DRAFT_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(50); await check;
  const next = inbox.push('p');
  const closed = expect(next).rejects.toMatchObject({ code: 'PANEL_CLOSED' });
  inbox.closePanel(token); await closed;
  const second = inbox.open(); inbox.poll(second, true);
  await vi.advanceTimersByTimeAsync(75_001);
  await expect(inbox.push('p')).rejects.toMatchObject({ code: 'PANEL_NOT_OPEN' });
  inbox.dispose();
});
it('隐藏面板可用长轮询立即接收，并保留最后确认的会话而不受后台心跳顺序影响', async () => {
  const inbox = new DraftInbox();
  const a = inbox.open(); inbox.poll(a, true);
  const b = inbox.open(); inbox.poll(b, true);
  await expect(inbox.push('ambiguous')).rejects.toMatchObject({ code: 'PANEL_AMBIGUOUS' });
  inbox.poll(a, false); inbox.poll(b, true); inbox.poll(b, false); inbox.poll(a, false);
  const receiving = inbox.receive(b, false, 25_000);
  const pending = inbox.push('background-content', '首页');
  const draft = (await receiving)!;
  expect(draft).toMatchObject({ prompt: 'background-content', title: '首页' });
  expect(inbox.poll(a, false)).toBeNull();
  inbox.ack(b, draft.id, true);
  await expect(pending).resolves.toEqual({ draftId: draft.id }); inbox.dispose();
});
it('后台长轮询超时会正常续约，关闭时释放等待', async () => {
  vi.useFakeTimers();
  const inbox = new DraftInbox(); const token = inbox.open();
  const receiving = inbox.receive(token, false, 25_000);
  await vi.advanceTimersByTimeAsync(25_000);
  await expect(receiving).resolves.toBeNull();
  const pending = inbox.push('after-heartbeat'); const draft = inbox.poll(token, false)!;
  inbox.ack(token, draft.id, true); await pending;
  const stopped = inbox.receive(token, false, 25_000);
  const check = expect(stopped).rejects.toMatchObject({ code: 'PANEL_EXPIRED' });
  inbox.closePanel(token); await check; inbox.dispose();
});
it('最后的接收目标失联时，不回退到另一个后台会话', async () => {
  let now = 0; const inbox = new DraftInbox({ now: () => now });
  const a = inbox.open(); inbox.poll(a, true); inbox.poll(a, false);
  const b = inbox.open(); inbox.poll(b, true); inbox.poll(b, false);
  now = 75_001; inbox.poll(a, false);
  await expect(inbox.push('private')).rejects.toMatchObject({ code: 'PANEL_AMBIGUOUS' });
  inbox.dispose();
});
it('宿主拒绝添加时向调用者返回失败', async () => {
  const inbox = new DraftInbox(); const token = inbox.open(); inbox.poll(token, true);
  const pending = inbox.push('p');
  const check = expect(pending).rejects.toMatchObject({ code: 'DRAFT_NOT_CONFIRMED' });
  inbox.ack(token, inbox.poll(token, true)!.id, false); await check; inbox.dispose();
});
