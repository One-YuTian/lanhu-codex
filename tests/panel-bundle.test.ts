import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

it.each(['visible', 'hidden'])('最终 HTML 使用真实 SDK 在 %s 状态完成握手和草稿请求', async visibility => {
  const html = await readFile('dist/panel.html', 'utf8');
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeTruthy(); expect(script).not.toContain('/* SCRIPT */');
  expect(html).toContain('<details id="receiver-details">');
  const compiled = new vm.Script(script!);
  const listeners = new Set<(event: any) => void>();
  const nodes = new Map<string, any>();
  for (const name of ['status', 'preview', 'title', 'content']) nodes.set(name, { textContent: '', classList: { toggle() {} } });
  const sent: any[] = [], intervals: ReturnType<typeof setInterval>[] = [];
  const waiting: any[] = [];
  const token = '00000000-0000-4000-8000-000000000001';
  let delivered = false;
  function emit(message: any) { for (const listener of listeners) listener({ data: message, source: parent }); }
  const parent = { postMessage(message: any) {
    sent.push(message);
    if (message.id === undefined) return;
    if (message.method === 'tools/call' && message.params.name === 'lanhu_receiver_poll' && delivered) { waiting.push(message); return; }
    let result: any = {};
    if (message.method === 'ui/initialize') result = {
      protocolVersion: '2026-01-26', hostInfo: { name: 'test-host', version: '26.1013.40934' },
      hostCapabilities: { message: { text: {}, resourceLink: {} }, serverTools: {}, experimental: { 'openai/message': {} } }, hostContext: { platform: 'desktop' }
    };
    if (message.method === 'tools/call' && message.params.name === 'lanhu_receiver_poll') result = {
      content: [], _meta: { 'lanhu/draft': delivered ? null : { id: 'draft', title: '首页', prompt: 'full-design-content' } }
    };
    if (message.method === 'ui/message') delivered = true;
    queueMicrotask(() => emit({ jsonrpc: '2.0', id: message.id, result }));
    if (message.method === 'ui/initialize') setTimeout(() => emit({ jsonrpc: '2.0', method: 'ui/notifications/tool-result',
      params: { content: [], _meta: { 'lanhu/panel': { token } } } }), 0);
  } };
  const style = { setProperty() {} };
  const element = { style, setAttribute() {}, getBoundingClientRect: () => ({ width: 400, height: 240 }), scrollWidth: 400, scrollHeight: 240 };
  const window = { parent, innerWidth: 400, innerHeight: 240,
    addEventListener(name: string, fn: any) { if (name === 'message') listeners.add(fn); },
    removeEventListener(name: string, fn: any) { if (name === 'message') listeners.delete(fn); } };
  const context = vm.createContext({ window, document: { visibilityState: visibility, documentElement: element, body: element,
    getElementById: (id: string) => nodes.get(id), addEventListener() {}, fonts: { ready: Promise.resolve() } },
    console: { debug() {}, log() {}, warn: console.warn, error: console.error }, URL, TextEncoder, TextDecoder, AbortController,
    setTimeout, clearTimeout, setInterval(fn: () => void, delay: number) { const timer = setInterval(fn, delay); intervals.push(timer); return timer; }, clearInterval,
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout,
    ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }) });
  try {
    compiled.runInContext(context);
    await vi.waitFor(() => expect(sent.some(message => message.method === 'ui/message'), JSON.stringify({ methods: sent.map(message => message.method), status: nodes.get('status').textContent })).toBe(true), { timeout: 3000 });
    const message = sent.find(message => message.method === 'ui/message');
    expect(message.params._meta['openai/message']).toEqual({ target: 'active', send: false });
    expect(message.params.content[0]).toMatchObject({ type: 'resource_link', name: '首页', uri: 'lanhu://selection/draft/0' });
    expect(message.params.content[0]._meta).toBeUndefined();
    expect(JSON.stringify(message.params.content[0])).not.toContain('full-design-content');
    await vi.waitFor(() => expect(sent.some(message => message.method === 'tools/call' && message.params.name === 'lanhu_receiver_ack')).toBe(true));
    expect(nodes.get('status').textContent).toContain('已添加到当前草稿');
  } finally {
    emit({ jsonrpc: '2.0', id: 'test-teardown', method: 'ui/resource-teardown', params: {} });
    await vi.waitFor(() => expect(sent.some(message => message.method === 'tools/call' && message.params.name === 'lanhu_receiver_close')).toBe(true));
    for (const message of waiting) emit({ jsonrpc: '2.0', id: message.id, result: { content: [], _meta: { 'lanhu/draft': null } } });
    intervals.forEach(clearInterval);
  }
});
