import { expect, it } from 'vitest';
import { Bridge } from '../src/bridge';

it('Cookie 管理没有网络监听或 Chrome 连接，状态不返回凭据', async () => {
  const bridge = new Bridge({ cookie: 'session=fixture' });
  expect(bridge.getCookie().cookie).toBe('session=fixture');
  expect(bridge.status()).toMatchObject({ mode: 'manual', hasCookie: true });
  for (const key of ['actualPort', 'preferredPort', 'connected', 'browserReady']) expect(bridge.status()).not.toHaveProperty(key);
  for (const key of ['start', 'setPort', 'refreshCookie', 'openLogin', 'setMode']) expect(bridge).not.toHaveProperty(key);
  expect(JSON.stringify(bridge.status())).not.toContain('session=fixture');
  expect(() => bridge.getCookie('https://evil.test')).toThrow();
  expect(() => bridge.setCookie('private\nheader')).toThrow();
  bridge.clearCookie(); expect(bridge.getCookie().cookie).toBe('');
  await bridge.close();
});
it.each([{ exp: 1 }, { user: 'fixture' }])('本机登录检查只验证格式，不检查 JWT 到期或打开浏览器 %j', async payload => {
  const cookie = `user_token=head.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
  const bridge = new Bridge({ cookie });
  expect(await bridge.checkLogin()).toMatchObject({ login: { loggedIn: true, verification: 'payload_format_only' }, loginPageOpened: false });
  bridge.clearCookie();
  expect(await bridge.checkLogin()).toMatchObject({ login: { loggedIn: false }, loginPageOpened: false });
  await bridge.close();
});
