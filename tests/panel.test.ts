import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ app: null as any, send: vi.fn(), tool: vi.fn(), supported: true, resourceLink: true }));
vi.mock('@modelcontextprotocol/ext-apps', () => ({
  App: class {
    ontoolresult: any;
    constructor() { state.app = this; }
    addEventListener() {}
    async connect() {}
    getHostContext() { return { platform: 'desktop' }; }
    getHostVersion() { return { version: '26.1013.40934' }; }
    getHostCapabilities() { return { message: { text: {}, ...(state.resourceLink ? { resourceLink: {} } : {}) } }; }
    callServerTool(args: any) { return state.tool(args); }
  }, applyDocumentTheme() {}, applyHostStyleVariables() {}
}));
vi.mock('@openai/mcp-extensions/app', () => ({ OpenAIExtensions: class { get message() { return state.supported ? { send: state.send } : undefined; } } }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); });
async function start(supported = true, visibility = 'visible', resourceLink = true) {
  vi.useFakeTimers(); state.supported = supported; state.resourceLink = resourceLink;
  const elements = new Map<string, any>();
  for (const id of ['status', 'preview', 'title', 'content']) elements.set(id, { textContent: '', classList: { toggle() {} } });
  vi.stubGlobal('document', { visibilityState: visibility, getElementById: (id: string) => elements.get(id), addEventListener() {} });
  await import('../panel/main');
  await vi.advanceTimersByTimeAsync(0);
  state.app.ontoolresult({ _meta: { 'lanhu/panel': { token: 'panel' } } });
  await vi.advanceTimersByTimeAsync(0);
  return elements;
}
it('不支持扩展的宿主不消费队列，不尝试标准自动发送', async () => {
  state.tool.mockResolvedValue({ content: [] });
  const elements = await start(false);
  expect(state.tool).toHaveBeenCalledWith({ name: 'lanhu_receiver_poll', arguments: { token: 'panel', visible: true, wait_ms: 0, mentions_supported: false } });
  expect(state.send).not.toHaveBeenCalled();
  expect(elements.get('status').textContent).toContain('暂不支持');
});
it('添加草稿成功但确认回执丢失时，仅重试确认，不重复插入', async () => {
  state.send.mockResolvedValue({});
  state.tool.mockImplementation(async ({ name }) => {
    if (name === 'lanhu_receiver_poll') return { content: [], _meta: { 'lanhu/draft': { id: 'draft', title: 'summary', prompt: 'full content' } } };
    throw new Error('ack lost');
  });
  await start(); await vi.advanceTimersByTimeAsync(2100);
  expect(state.send).toHaveBeenCalledTimes(1);
  expect(state.send.mock.calls[0][0]).toMatchObject({ content: [{ type: 'resource_link', name: 'summary', uri: 'lanhu://selection/draft/0' }], _meta: { 'openai/message': { target: 'active', send: false } } });
  expect(state.send.mock.calls[0][0].content[0]._meta).toBeUndefined();
  expect(state.tool.mock.calls.filter(([args]) => args.name === 'lanhu_receiver_ack').length).toBeGreaterThan(1);
});
it('只有普通文本能力的宿主不发送伪造的 mention', async () => {
  state.tool.mockResolvedValue({ content: [] });
  const elements = await start(true, 'hidden', false);
  expect(state.send).not.toHaveBeenCalled();
  expect(elements.get('status').textContent).toContain('不支持资源 mention');
  expect(state.tool).toHaveBeenCalledWith({ name: 'lanhu_receiver_poll', arguments: { token: 'panel', visible: false, wait_ms: 0, mentions_supported: false } });
});
it('宿主失败时不重试发送，也不回退自动提交', async () => {
  state.send.mockRejectedValue(new Error('unknown host outcome'));
  let received = false;
  state.tool.mockImplementation(({ name }) => {
    if (name === 'lanhu_receiver_poll') {
      if (received) return new Promise(() => {});
      received = true;
    }
    return Promise.resolve({ content: [], _meta: { 'lanhu/draft': { id: 'draft', title: 'summary', prompt: 'full content' } } });
  });
  await start(); await vi.advanceTimersByTimeAsync(2100);
  expect(state.send).toHaveBeenCalledTimes(1);
  expect(state.tool).toHaveBeenCalledWith({ name: 'lanhu_receiver_ack', arguments: { token: 'panel', draft_id: 'draft', inserted: false } });
});
it('面板隐藏时继续追加草稿，既不展开界面也不自动发送', async () => {
  state.send.mockResolvedValue({});
  let received = false;
  state.tool.mockImplementation(({ name }) => {
    if (name !== 'lanhu_receiver_poll') return Promise.resolve({ content: [] });
    if (received) return new Promise(() => {});
    received = true;
    return Promise.resolve({ content: [], _meta: { 'lanhu/draft': { id: 'hidden-draft', title: '首页', prompt: 'full content' } } });
  });
  await start(true, 'hidden');
  expect(state.tool).toHaveBeenCalledWith({ name: 'lanhu_receiver_poll', arguments: { token: 'panel', visible: false, wait_ms: 25_000 } });
  expect(state.send).toHaveBeenCalledTimes(1);
  expect(state.send.mock.calls[0][0]._meta['openai/message']).toEqual({ target: 'active', send: false });
  expect(state.tool).toHaveBeenCalledWith({ name: 'lanhu_receiver_ack', arguments: { token: 'panel', draft_id: 'hidden-draft', inserted: true } });
});
it('宿主缺少接收元数据时延迟重试，避免后台空转', async () => {
  state.tool.mockResolvedValue({ content: [] });
  await start(true, 'hidden');
  expect(state.tool).toHaveBeenCalledTimes(1);
  expect(state.send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1500);
  expect(state.tool).toHaveBeenCalledTimes(2);
});
