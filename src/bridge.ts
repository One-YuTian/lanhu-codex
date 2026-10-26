import { AppError, checkLoginCookie, lanhuUrl, manualCookieSchema } from './shared';
import { DraftInbox } from './draft-inbox';

export class Bridge {
  readonly drafts = new DraftInbox();
  private cookie = '';
  private updatedAt: string | null = null;
  constructor(options: { cookie?: string } = {}) {
    if (options.cookie?.trim()) this.setCookie(options.cookie);
  }
  status() {
    return { mode: 'manual' as const, hasCookie: Boolean(this.cookie), lastSyncAt: this.updatedAt, login: this.loginStatus() };
  }
  loginStatus() { return checkLoginCookie(this.cookie); }
  async checkLogin(_openLoginIfNeeded = false) { return { login: this.loginStatus(), loginPageOpened: false }; }
  settingsCookie() { return this.cookie; }
  cookieUpdatedAt() { return this.updatedAt; }
  getCookie(value?: string) {
    const url = value === undefined ? null : lanhuUrl(value);
    return { cookie: this.cookie, mode: 'manual' as const, url: url?.href ?? null };
  }
  setCookie(cookie: string) {
    const parsed = manualCookieSchema.safeParse(cookie);
    if (!parsed.success) throw new AppError('INVALID_COOKIE', '请输入非空、无换行的 Cookie Header');
    this.cookie = parsed.data; this.updatedAt = new Date().toISOString(); return this.status();
  }
  clearCookie() { this.cookie = ''; this.updatedAt = null; return this.status(); }
  async close() { this.drafts.dispose(); }
}
