import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Bridge } from '../src/bridge';
import { FileCookiePreferences, Settings, formatCookieUpdatedAt } from '../src/settings';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith('lanhu-cookie-')) throw new Error('Unsafe cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
it('原生设置仅有 COOKIE，拒绝端口及无效输入且不回显秘密', async () => {
  const bridge = new Bridge({ cookie: 'session=original' });
  const preferences = { loadCookie: async () => undefined, saveCookie: vi.fn(async () => {}) };
  const settings = new Settings(bridge, preferences);
  expect(Object.keys(settings.read().schema.properties)).toEqual(['COOKIE']);
  expect(settings.read().schema.required).toEqual(['COOKIE']);
  expect(settings.read()).not.toHaveProperty('layout');
  for (const value of [{}, { PORT: 19989 }, { COOKIE: 'private\nfixture' }, { COOKIE: 1 }]) await expect(settings.update(value)).rejects.toThrow();
  expect(preferences.saveCookie).not.toHaveBeenCalled();
  expect(bridge.getCookie().cookie).toBe('session=original');
  await settings.update({ COOKIE: 'session=updated' });
  expect(preferences.saveCookie).toHaveBeenCalledWith('session=updated');
  expect(settings.read().values).toEqual({ COOKIE: 'session=updated' });
  await settings.update({ COOKIE: '' }); expect(bridge.status().hasCookie).toBe(false);
  await bridge.close();
});
it('保存失败保留旧 Cookie，连续更新按顺序完成', async () => {
  const bridge = new Bridge({ cookie: 'session=original' });
  const preferences = { loadCookie: async () => undefined, saveCookie: vi.fn(async () => {}) };
  const settings = new Settings(bridge, preferences);
  preferences.saveCookie.mockRejectedValueOnce(new Error('save failed'));
  await expect(settings.update({ COOKIE: 'session=new' })).rejects.toThrow('save failed');
  expect(bridge.getCookie().cookie).toBe('session=original');
  await Promise.all([settings.update({ COOKIE: 'session=first' }), settings.update({ COOKIE: 'session=last' })]);
  expect(bridge.getCookie().cookie).toBe('session=last');
  await bridge.close();
});
it('迁移旧 PORT 配置时保留 Cookie，新保存文件不包含 PORT，损坏配置不泄露内容', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lanhu-cookie-')); directories.push(directory);
  const file = path.join(directory, 'settings.json'), preferences = new FileCookiePreferences(file);
  await writeFile(file, JSON.stringify({ version: 1, PORT: 19989, COOKIE: 'session=persisted' }));
  expect(await preferences.loadCookie()).toBe('session=persisted');
  await preferences.saveCookie('session=updated');
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 2, COOKIE: 'session=updated' });
  const restarted = new Bridge({ cookie: await preferences.loadCookie() });
  expect(restarted.getCookie().cookie).toBe('session=updated');
  await preferences.saveCookie(''); expect(await preferences.loadCookie()).toBeUndefined();
  await writeFile(file, 'private-corrupted-fixture'); expect(await preferences.loadCookie()).toBeUndefined();
  await restarted.close();
});

it('Cookie 更新时间使用北京时间中文格式，无 UTC 或连接端口文案', async () => {
 expect(formatCookieUpdatedAt('2026-10-27T04:09:28.000Z')).toBe('2026年10月27日12:09:28');
 expect(formatCookieUpdatedAt('2026-10-27T16:00:00.000Z')).toBe('2026年10月28日00:00:00');
 expect(formatCookieUpdatedAt(null)).toBe('尚未更新');
 const bridge = new Bridge(); const settings = new Settings(bridge,{ loadCookie:async()=>undefined,saveCookie:async()=>{} });
 expect(settings.read().schema.properties.COOKIE.description).toBe('蓝湖 Cookie，Cookie 未登录，上一次更新时间：尚未更新。');
 expect(settings.read().schema.properties.COOKIE.description).not.toMatch(/Chrome|端口|UTC|留空/); await bridge.close();
});
it('状态来自上游登录校验，保存新 Cookie 后重新校验，描述不泄露凭据', async () => {
 const fetcher = vi.fn(async()=>Response.json({code:'00000',result:{id:'test-user'}})); vi.stubGlobal('fetch',fetcher);
 const bridge = new Bridge({cookie:'user_token=header.e30.private-fixture'}); vi.spyOn(bridge,'cookieUpdatedAt').mockReturnValue('2026-10-27T04:09:28.000Z');
 const settings = new Settings(bridge,{loadCookie:async()=>undefined,saveCookie:async()=>{}});
 expect((await settings.readVerified()).schema.properties.COOKIE.description).toBe('蓝湖 Cookie，Cookie 已登录，上一次更新时间：2026年10月27日12:09:28。');
 expect((await settings.readVerified()).schema.properties.COOKIE.description).not.toContain('private-fixture'); expect(fetcher).toHaveBeenCalledTimes(1);
 await settings.update({COOKIE:'user_token=header.e30.invalid-fixture'}); fetcher.mockResolvedValueOnce(new Response('',{status:401}));
 expect((await settings.readVerified()).schema.properties.COOKIE.description).toContain('Cookie 未登录'); expect(fetcher).toHaveBeenCalledTimes(2);
 await settings.update({COOKIE:''}); await settings.readVerified(); expect(fetcher).toHaveBeenCalledTimes(2); await bridge.close();
});
