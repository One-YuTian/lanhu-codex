import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, manualCookieSchema } from './shared';
import type { Bridge } from './bridge';
import { canvasLoginStatus } from './login';

export const SETTINGS_CAPABILITY = { readTool: 'settings_read', updateTool: 'settings_update' };
export interface CookiePreferences { loadCookie(): Promise<string | undefined>; saveCookie(cookie: string): Promise<void> }
const preferencesSchema = z.object({ version: z.union([z.literal(1), z.literal(2)]), COOKIE: z.union([z.literal(''), manualCookieSchema]).optional() });

export function settingsFile(env: NodeJS.ProcessEnv = process.env): string {
  const directory = env.PLUGIN_DATA?.trim() || path.join(homedir(), '.lanhu-codex');
  return path.join(directory, 'settings.json');
}

export class FileCookiePreferences implements CookiePreferences {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly file = settingsFile()) {}
  async loadCookie(): Promise<string | undefined> {
    try { return preferencesSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))).COOKIE || undefined; }
    catch { return undefined; }
  }
  saveCookie(cookie: string): Promise<void> {
    const parsed = z.union([z.literal(''), manualCookieSchema]).safeParse(cookie);
    if (!parsed.success) return Promise.reject(new AppError('INVALID_COOKIE', 'Cookie 格式无效'));
    const task = this.writes.then(async () => {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(temporary, JSON.stringify({ version: 2, COOKIE: parsed.data }), { mode: 0o600, flag: 'wx' });
        await rename(temporary, this.file);
      } catch {
        await unlink(temporary).catch(() => undefined);
        throw new AppError('SETTINGS_SAVE_FAILED', '无法保存本地设置；请检查设置目录权限');
      }
    });
    this.writes = task.catch(() => undefined);
    return task;
  }
}

export function formatCookieUpdatedAt(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '尚未更新';
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get('year')}年${get('month')}月${get('day')}日${get('hour')}:${get('minute')}:${get('second')}`;
}

export class Settings {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly login: ReturnType<typeof canvasLoginStatus>;
  private verifiedCookie: string | undefined;
  private loggedIn = false;
  constructor(private readonly bridge: Bridge, private readonly preferences: CookiePreferences) { this.login = canvasLoginStatus(bridge); }
  async readVerified() {
    const cookie = this.bridge.settingsCookie();
    try {
      const result = await this.login();
      if (cookie === this.bridge.settingsCookie()) { this.loggedIn = result.loggedIn; this.verifiedCookie = cookie; }
    } catch { /* A network error does not invalidate a previously verified credential. */ }
    return this.read();
  }
  read() {
    return {
      schema: { type: 'object' as const, properties: {
        COOKIE: { type: 'string' as const, title: 'COOKIE', description: `蓝湖 Cookie，Cookie ${this.loggedIn && this.verifiedCookie === this.bridge.settingsCookie() ? '已登录' : '未登录'}，上一次更新时间：${formatCookieUpdatedAt(this.bridge.cookieUpdatedAt())}。` }
      }, required: ['COOKIE'] },
      values: { COOKIE: this.bridge.settingsCookie() }
    };
  }
  update(set: Record<string, unknown>, hooks: { beforeSave?: () => void; afterSave?: () => void } = {}): Promise<{ values: { COOKIE: string } }> {
    const task = this.queue.then(async () => {
      if (Object.keys(set).length !== 1 || !Object.hasOwn(set, 'COOKIE')) throw new AppError('INVALID_SETTINGS', '只允许更新 COOKIE');
      if (typeof set.COOKIE !== 'string') throw new AppError('INVALID_COOKIE', 'COOKIE 必须为字符串');
      const parsed = z.union([z.literal(''), manualCookieSchema]).safeParse(set.COOKIE.trim());
      if (!parsed.success) throw new AppError('INVALID_COOKIE', '格式应为 session=abc; token=xyz，不包含 Cookie: 前缀或换行');
      hooks.beforeSave?.();
      await this.preferences.saveCookie(parsed.data);
      if (parsed.data) this.bridge.setCookie(parsed.data); else this.bridge.clearCookie();
      this.login.invalidate(); this.loggedIn = false; this.verifiedCookie = undefined;
      process.env.COOKIE = parsed.data;
      hooks.afterSave?.();
      return { values: this.read().values };
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
