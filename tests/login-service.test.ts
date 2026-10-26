import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AppError, errorInfo } from '../src/shared';
import { Bridge } from '../src/bridge';
import { createMcpServer } from '../src/mcp';
import { verifyLogin } from '../src/login';
import { LanhuApi } from '../src/lanhu-api';

const cookie = `user_token=header.${Buffer.from('{"exp":1,"id":"secret-payload"}').toString('base64url')}.signature`;
const originalCookie = process.env.COOKIE;
afterEach(() => {
  vi.restoreAllMocks();
  if (originalCookie === undefined) delete process.env.COOKIE; else process.env.COOKIE = originalCookie;
});

it('仅服务端确认用户身份才通过校验，不暴露 Cookie 或用户资料，也不检查 JWT exp', async () => {
  const fetcher = vi.fn(async () => Response.json({ code: '00000', result: { id: 'user-fixture', email: 'secret-email' } }));
  const result = await verifyLogin(cookie, fetcher);
  expect(result).toMatchObject({ loggedIn: true, verification: 'upstream' });
  expect(JSON.stringify(result)).not.toMatch(/secret|user-fixture|user_token/);
  const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe('https://lanhuapp.com/api/account/user/detail');
  expect(options.headers).toMatchObject({ Cookie: cookie, Referer: 'https://lanhuapp.com/web/' });
  expect(options.redirect).toBe('manual');
});

it('空凭据不请求网络，空身份、未登录响应、网络失败均不能伪装成登录成功', async () => {
  const fetcher = vi.fn(async () => Response.json({ code: '00000', result: {} }));
  await expect(verifyLogin('', fetcher)).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
  expect(fetcher).not.toHaveBeenCalled();
  for (const result of [{}, { id: '' }, { id: 0 }, [], null]) {
    fetcher.mockResolvedValueOnce(Response.json({ code: '00000', result }));
    await expect(verifyLogin(cookie, fetcher)).rejects.toMatchObject({ code: 'LOGIN_UNVERIFIED' });
  }
  fetcher.mockResolvedValueOnce(new Response('private-error', { status: 401 }));
  await expect(verifyLogin(cookie, fetcher)).rejects.toMatchObject({ code: 'LOGIN_REJECTED' });
  fetcher.mockResolvedValueOnce(Response.json({ code: 401, result: { id: 'fixture' } }));
  await expect(verifyLogin(cookie, fetcher)).rejects.toMatchObject({ code: 'LOGIN_REJECTED' });
  fetcher.mockRejectedValueOnce(new Error(cookie));
  await expect(verifyLogin(cookie, fetcher)).rejects.toMatchObject({ code: 'UPSTREAM_REQUEST_FAILED', message: expect.not.stringContaining(cookie) });
});

it('无 Cookie 的资源 401 不触发账号登录，避免签名资源失败导致登录循环', async () => {
  const bridge = new Bridge();
  try {
    const api = new LanhuApi(bridge, async () => new Response('', { status: 401 }));
    await expect(api.resource('https://assets.lanhuapp.com/example.png')).rejects.toMatchObject({ code: 'RESOURCE_ACCESS_DENIED' });
  } finally { await bridge.close(); }
});

it('只有身份类错误提示 Lanhu Login，权限及网络错误不触发自动登录', () => {
  for (const code of ['LOGIN_REQUIRED', 'LOGIN_REJECTED', 'COOKIE_SCOPE_MISMATCH']) {
    expect(errorInfo(new AppError(code, 'fixture'))).toMatchObject({ login_action: { skill: 'lanhu-login' } });
  }
  for (const code of ['ACCESS_DENIED', 'UPSTREAM_API_ERROR', 'UPSTREAM_REQUEST_FAILED', 'LOGIN_UNVERIFIED']) {
    expect(errorInfo(new AppError(code, 'fixture'))).not.toHaveProperty('login_action');
  }
});

it('MCP 校验后保存：失败不覆盖旧 Cookie，成功更新持久配置和服务进程环境，结果不含秘密', async () => {
  const bridge = new Bridge({ cookie: 'session=old-fixture' });
  const preferences = { loadCookie: async () => undefined, saveCookie: vi.fn(async () => {}) };
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const server = createMcpServer(bridge, preferences);
  const client = new Client({ name: 'login-test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const call = async (name: string, args = {}) => {
      const response = await client.callTool({ name, arguments: args });
      return { ...response, value: JSON.parse((response.content as any)[0].text) };
    };
    expect((await call('check_login')).value).toMatchObject({ login_action: { skill: 'lanhu-login' } });
    expect((await call('check_login', { verify: true })).value.code).toBe('LOGIN_REQUIRED');
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response('private-error', { status: 401 }));
    expect((await call('set_cookie', { cookie, verify: true })).isError).toBe(true);
    expect(preferences.saveCookie).not.toHaveBeenCalled();
    expect(bridge.settingsCookie()).toBe('session=old-fixture');
    fetcher.mockResolvedValueOnce(Response.json({ code: 0, data: { user_id: 'fixture-id' } }));
    const saved = await call('set_cookie', { cookie, verify: true });
    expect(saved.isError).not.toBe(true);
    expect(saved.value.login).toMatchObject({ loggedIn: true, verification: 'upstream' });
    expect(JSON.stringify(saved)).not.toContain(cookie);
    expect(preferences.saveCookie).toHaveBeenCalledWith(cookie);
    expect(process.env.COOKIE).toBe(cookie);
    fetcher.mockResolvedValueOnce(Response.json({ code: '200', result: { uid: 12 } }));
    expect((await call('check_login', { verify: true })).value.login.verification).toBe('upstream');
  } finally { await client.close(); await server.close(); await bridge.close(); }
});
