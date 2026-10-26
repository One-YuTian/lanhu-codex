import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, manualCookieSchema } from './shared';
import type { Bridge } from './bridge';

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

export class Settings {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly bridge: Bridge, private readonly preferences: CookiePreferences) {}
  read() {
    return {
      schema: { type: 'object' as const, properties: {
        COOKIE: { type: 'string' as const, title: 'COOKIE', description: `本机保存的蓝湖 Cookie，无需 Chrome 连接或端口。上一次更新时间：${this.bridge.cookieUpdatedAt() ?? '尚未更新'}（UTC）。留空删除保存值。` }
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
      process.env.COOKIE = parsed.data;
      hooks.afterSave?.();
      return { values: this.read().values };
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
