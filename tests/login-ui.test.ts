import { afterEach, expect, it, vi } from 'vitest';
import { OpenAIMessageParamsSchema } from '@openai/mcp-extensions/app';
import { sendLoginMessage } from '../panel/login-message';
import { nativeTransport } from '../panel/canvas-transport';
import { Bridge } from '../src/bridge';
import { canvasLoginStatus } from '../src/login';
import { renderLoginState, renderLoginSuccess } from '../panel/canvas/login-state.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp';

afterEach(() => { vi.restoreAllMocks(); });

it('登录按钮使用宿主消息扩展向新对话直接发送精确提示词', async () => {
  const send = vi.fn(async () => ({}));
  const app = { getHostCapabilities: () => ({ message: { text: {} } }) } as any;
  const transport = nativeTransport({} as any, undefined, () => sendLoginMessage({ send } as any, app));
  await transport.requestLogin!();
  const message = send.mock.calls[0][0] as any;
  expect(OpenAIMessageParamsSchema.parse(message)).toMatchObject({ role: 'user',
    content: [{ type: 'text', text: '登录蓝湖设计网站。' }], _meta: { 'openai/message': { target: 'new', send: true } } });
  await expect(sendLoginMessage(undefined, app)).rejects.toThrow('不支持');
  await expect(sendLoginMessage({ send: async () => ({ isError: true }) } as any, app)).rejects.toThrow('未能确认');
});

it('点击即切换 loading 并防止重复新建对话；发送失败仍显示复制提示词兜底', async () => {
  let nodes: any[] = [];
  const root = { querySelector: () => ({ replaceChildren: (...children: any[]) => { nodes = children; } }),
    createElement: () => ({ textContent: '', children: [], setAttribute() {}, append(...children: any[]) { this.children.push(...children); },
      addEventListener(_name: string, handler: any) { this.click = handler; } }) };
  let fail!: (error: Error) => void;
  const request = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
  const report = vi.fn();
  const flow = renderLoginState(root, request, report);
  const button = nodes[2];
  expect(button.textContent).toBe('登录'); expect(request).not.toHaveBeenCalled();
  const pending = button.click(); await button.click();
  expect(request).toHaveBeenCalledTimes(1); expect(button.disabled).toBe(true);
  expect(flow.pending).toBe(true); expect(nodes[0].className).toBe('login-spinner');
  expect(nodes[1].textContent).toBe('登录中');
  expect(nodes[3].children[1].textContent).toBe('登录蓝湖设计网站。');
  fail(new Error('fixture-failure')); await pending;
  expect(report).toHaveBeenCalledWith('fixture-failure'); expect(flow.pending).toBe(true);
  expect(nodes[3].children[0].textContent).toContain('手动创建对话');
  renderLoginSuccess(root);
  expect(nodes[1].textContent).toBe('登录成功');
  expect(nodes.some(node => node.className === 'login-spinner')).toBe(false);
});

it('UI 轮询实际调用 check_login 并以服务端校验结果为准', async () => {
  const callServerTool = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ login: { loggedIn: true, verification: 'upstream' } }) }] }));
  const transport = nativeTransport({ callServerTool } as any);
  expect(await (await transport.fetch('/api/status')).json()).toMatchObject({ loggedIn: true });
  expect(callServerTool.mock.calls[0][0]).toEqual({ name: 'check_login', arguments: { verify: true } });
  callServerTool.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ login: { loggedIn: true, verification: 'payload_format_only' } }) }] });
  expect(await (await transport.fetch('/api/status')).json()).toMatchObject({ loggedIn: false });
});

it('画布状态需服务端验证，缓存合并请求，Cookie 更新后立即重新验证，网络失败不冒充未登录', async () => {
  const token = (id: string) => `user_token=head.${Buffer.from(JSON.stringify({ id })).toString('base64url')}.sig`;
  const bridge = new Bridge();
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const read = canvasLoginStatus(bridge);
  try {
    expect(await read()).toMatchObject({ loggedIn: false }); expect(fetcher).not.toHaveBeenCalled();
    bridge.setCookie(token('old'));
    fetcher.mockResolvedValueOnce(new Response('', { status: 401 }));
    expect(await read()).toMatchObject({ loggedIn: false });
    await read(); expect(fetcher).toHaveBeenCalledTimes(1);
    bridge.setCookie(token('new'));
    fetcher.mockResolvedValueOnce(Response.json({ code: '00000', result: { id: 'user' } }));
    expect(await Promise.all([read(), read()])).toMatchObject([{ loggedIn: true }, { loggedIn: true }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    read.invalidate();
    fetcher.mockRejectedValueOnce(new Error('fixture network error'));
    await expect(read()).rejects.toMatchObject({ code: 'UPSTREAM_REQUEST_FAILED' });
    bridge.clearCookie(); expect(await read()).toMatchObject({ loggedIn: false });
  } finally { await bridge.close(); }
});

it('身份错误代码经画布通道保留以切换未登录页面', async () => {
  const transport = nativeTransport({ callServerTool: async () => ({ isError: true,
    _meta: { 'lanhu/error': { code: 'LOGIN_REJECTED', message: '登录失败' } } }) } as any);
  await expect(transport.fetch('/api/project?project_id=p')).rejects.toMatchObject({ code: 'LOGIN_REJECTED' });
});

it('手动设置只返回确认，携带原流程 ID 取消任务，不回传 Cookie', async () => {
  const callServerTool = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ login: { loggedIn: true, verification: 'upstream' } }) }] }));
  const transport = nativeTransport({ callServerTool } as any);
  expect(await transport.setLoginCookie('secret-cookie', '00000000-0000-4000-8000-000000000001')).toEqual({ loggedIn: true });
  expect(callServerTool.mock.calls[0][0]).toEqual({ name: 'set_cookie', arguments: { cookie: 'secret-cookie', verify: true,
    cancel_login_attempt_id: '00000000-0000-4000-8000-000000000001' } });
});

it('手动校验失败保留流程；成功后拒绝晚到的自动 Cookie，环境只保留手动凭据', async () => {
  const oldEnv = process.env.COOKIE;
  const cookie = (name: string) => `user_token=head.${Buffer.from(JSON.stringify({ name })).toString('base64url')}.sig`;
  const bridge = new Bridge();
  const preferences = { loadCookie: async () => undefined, saveCookie: vi.fn(async () => {}) };
  const server = createMcpServer(bridge, preferences);
  const client = new Client({ name: 'login-race', version: '1' });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const attempt = '00000000-0000-4000-8000-000000000001';
  const call = async (name: string, args: any) => {
    const response = await client.callTool({ name, arguments: args });
    return { ...response, value: JSON.parse((response.content as any)[0].text) };
  };
  try {
    await server.connect(st); await client.connect(ct);
    await call('lanhu_login_attempt', { action: 'start', attempt_id: attempt });
    fetcher.mockResolvedValueOnce(new Response('', { status: 401 }));
    expect((await call('set_cookie', { cookie: cookie('invalid'), verify: true, cancel_login_attempt_id: attempt })).isError).toBe(true);
    expect(bridge.loginAttempts.status(attempt).state).toBe('active');
    let finishAuto!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finishAuto = resolve; }));
    const automatic = call('set_cookie', { cookie: cookie('automatic'), verify: true, login_attempt_id: attempt });
    await vi.waitFor(() => expect(finishAuto).toBeTypeOf('function'));
    fetcher.mockResolvedValueOnce(Response.json({ code: 0, result: { id: 'fixture-user' } }));
    const manual = await call('set_cookie', { cookie: cookie('manual'), verify: true, cancel_login_attempt_id: attempt });
    expect(manual.isError).not.toBe(true);
    expect(manual.value.cancelled_attempt.state).toBe('cancelled');
    finishAuto(Response.json({ code: 0, result: { id: 'fixture-user' } }));
    expect((await automatic).value.code).toBe('LOGIN_ATTEMPT_CANCELLED');
    expect(bridge.settingsCookie()).toBe(cookie('manual')); expect(process.env.COOKIE).toBe(cookie('manual'));
    expect(preferences.saveCookie).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(manual)).not.toContain(cookie('manual'));
  } finally {
    await client.close(); await server.close(); await bridge.close();
    if (oldEnv === undefined) delete process.env.COOKIE; else process.env.COOKIE = oldEnv;
  }
});
