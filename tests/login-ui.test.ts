import { afterEach, expect, it, vi } from 'vitest';
import { nativeTransport } from '../panel/canvas-transport';
import { Bridge } from '../src/bridge';
import { canvasLoginStatus } from '../src/login';
import { renderLoginState } from '../panel/canvas/login-state.js';
afterEach(() => { vi.restoreAllMocks(); });

it('登录页只有手动 Cookie 入口，防止重复弹窗，取消或失败后允许重试', async () => {
  let nodes: any[] = [];
  const root = { querySelector: () => ({ replaceChildren: (...children: any[]) => { nodes = children; } }),
    createElement: () => ({ textContent: '', addEventListener(_name: string, handler: any) { this.click = handler; } }) };
  let finish!: () => void;
  const manual = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const flow = renderLoginState(root, vi.fn(), manual);
  expect(nodes.map(node => node.textContent).join('')).not.toContain('新对话');
  const button = nodes[2]; expect(button.textContent).toBe('填写 Cookie');
  const pending = button.click(); await button.click();
  expect(manual).toHaveBeenCalledOnce(); expect(flow.manual).toBe(true);
  finish(); await pending; expect(button.disabled).toBe(false); expect(flow.manual).toBe(false);
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

it('手动 Cookie 校验成功只返回确认，不回传 Cookie', async () => {
  const callServerTool = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ login: { loggedIn: true, verification: 'upstream' } }) }] }));
  const transport = nativeTransport({ callServerTool } as any);
  expect(await transport.setLoginCookie('secret-cookie')).toEqual({ loggedIn: true });
  expect(callServerTool.mock.calls[0][0]).toEqual({ name: 'set_cookie', arguments: { cookie: 'secret-cookie', verify: true } });
  callServerTool.mockResolvedValueOnce({ isError: true, content: [] } as any);
  await expect(transport.setLoginCookie('invalid')).rejects.toThrow('未通过登录校验');
});
