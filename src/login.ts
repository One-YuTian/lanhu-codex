import { AppError, checkLoginCookie, errorInfo, LANHU_LOGIN_URL } from './shared';
import { Bridge } from './bridge';
import { LanhuApi } from './lanhu-api';

export const loginAction = () => ({ method: 'manual_cookie', url: LANHU_LOGIN_URL });

// Share in-flight checks and briefly cache their result while the canvas polls.
// A newly saved/cleared credential invalidates the cache immediately.
export function canvasLoginStatus(bridge: Bridge) {
  let credential: string | undefined, expires = 0;
  let pending: Promise<{ mode: string; loggedIn: boolean; login_action?: ReturnType<typeof loginAction> }> | undefined;
  const read = () => {
    const cookie = bridge.settingsCookie();
    if (pending && credential === cookie && Date.now() < expires) return pending;
    credential = cookie; expires = Date.now() + 30_000;
    pending = verifyLogin(cookie).then(() => ({ mode: 'mcp', loggedIn: true }), error => {
      const info = errorInfo(error);
      if (['LOGIN_REQUIRED', 'LOGIN_REJECTED', 'COOKIE_SCOPE_MISMATCH', 'LOGIN_UNVERIFIED'].includes(info.code))
        return { mode: 'mcp', loggedIn: false, login_action: loginAction() };
      throw error;
    });
    return pending;
  };
  return Object.assign(read, { invalidate: () => { expires = 0; } });
}

export async function verifyLogin(cookie: string, fetcher: typeof fetch = fetch) {
  if (!checkLoginCookie(cookie).loggedIn) throw new AppError('LOGIN_REQUIRED', '蓝湖 Cookie 缺失或格式无效，请在蓝湖面板手动填写 Cookie');
  const candidate = new Bridge({ cookie });
  try {
    const raw = await new LanhuApi(candidate, fetcher).request('/api/account/user/detail', {});
    const user = raw.data ?? raw.result;
    if (!user || typeof user !== 'object' || Array.isArray(user)
      || ![user.id, user.user_id, user.uid].some(value => typeof value === 'string' && value.trim() || typeof value === 'number' && value > 0)) {
      throw new AppError('LOGIN_UNVERIFIED', '蓝湖未返回可确认的用户身份，未保存 Cookie');
    }
    return { loggedIn: true, verification: 'upstream' as const, checkedAt: Date.now() };
  } finally { await candidate.close(); }
}
