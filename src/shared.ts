import { z } from 'zod';

export const LANHU_LOGIN_URL = 'https://lanhuapp.com/web/#/user/login';
const loginSchema = z.object({
  loggedIn: z.boolean(), reason: z.string(), expiresAt: z.number().nullable(),
  // Accept the previous marker during browser/MCP rolling upgrades.
  checkedAt: z.number(), verification: z.enum(['payload_format_only', 'payload_exp_only'])
});
export type LoginStatus = z.infer<typeof loginSchema>;

// Only validate token/payload format. Never inspect exp or infer server validity.
// Never return the token or other payload fields to status tools or logs.
export function checkLoginCookie(header: string, now = Date.now()): LoginStatus {
  const result = (reason: string): LoginStatus => ({
    loggedIn: reason === 'valid', reason, expiresAt: null, checkedAt: now, verification: 'payload_format_only'
  });
  const values = [...new Set(header.split(';').flatMap(part => {
    const equal = part.indexOf('=');
    return equal >= 0 && part.slice(0, equal).trim() === 'user_token' ? [part.slice(equal + 1).trim()] : [];
  }))];
  if (!values.length || !values[0]) return result('missing_token');
  if (values.length !== 1) return result('ambiguous_token');
  try {
    const segments = values[0].split('.');
    if (segments.length !== 3 || segments.some(segment => !segment)) return result('invalid_token');
    const payload = segments[1];
    if (payload.length > 262144 || !/^[A-Za-z0-9_-]+={0,2}$/.test(payload) || payload.replace(/=+$/, '').length % 4 === 1) return result('invalid_token');
    const base64 = payload.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), character => character.charCodeAt(0));
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return result('invalid_token');
    return result('valid');
  } catch { return result('invalid_token'); }
}

export function isLanhuDomain(domain: string): boolean {
  const host = domain.replace(/^\./, '').toLowerCase();
  return host === 'lanhuapp.com' || host.endsWith('.lanhuapp.com');
}

export function lanhuUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError('INVALID_URL', '请输入有效的蓝湖 HTTPS URL'); }
  if (url.protocol !== 'https:' || !isLanhuDomain(url.hostname) || url.username || url.password || url.port) {
    throw new AppError('INVALID_URL', '仅支持蓝湖域名下的标准 HTTPS URL');
  }
  return url;
}

export function isLanhuPage(value?: string): boolean {
  if (!value) return false;
  try { lanhuUrl(value); return true; } catch { return false; }
}

export class AppError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function errorInfo(error: unknown): { code: string; message: string; login_action?: { skill: string } } {
  return error instanceof AppError
    ? { code: error.code, message: error.message, ...(['LOGIN_REQUIRED', 'LOGIN_REJECTED', 'COOKIE_SCOPE_MISMATCH'].includes(error.code) ? { login_action: { skill: 'lanhu-login' } } : {}) }
    : { code: 'INTERNAL_ERROR', message: '操作失败，请检查服务状态' };
}

// Preserve partition identity so snapshots do not silently lose CHIPS cookies.
export const cookieSchema = z.object({
  name: z.string().max(4096).regex(/^[^\x00-\x20\x7f()<>@,;:\\"/\[\]?={}]*$/),
  value: z.string().max(65536).regex(/^[^\x00-\x1f\x7f;]*$/),
  domain: z.string().max(253).regex(/^\.?[a-zA-Z0-9.-]+$/).refine(isLanhuDomain),
  path: z.string().startsWith('/').max(4096),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  hostOnly: z.boolean(),
  session: z.boolean(),
  expirationDate: z.number().finite().nonnegative().optional(),
  sameSite: z.enum(['no_restriction', 'lax', 'strict', 'unspecified']),
  storeId: z.string().max(128),
  partitionKey: z.object({
    topLevelSite: z.string().url().max(4096),
    hasCrossSiteAncestor: z.boolean().optional()
  }).strict().optional()
}).strict();
export type CookieRecord = z.infer<typeof cookieSchema>;

export const manualCookieSchema = z.string().trim().min(1).max(262144).refine(
  value => !/[\r\n\x00-\x1f\x7f]/.test(value) && value.split(';').every(part => {
    const equals = part.indexOf('=');
    return equals > 0 && /^[^\s()<>@,;:\\"/\[\]?={}]+$/.test(part.slice(0, equals).trim());
  }), '请输入有效的 Cookie Header，不包含 Cookie: 前缀或换行'
);

export function cookieHeader(cookies: CookieRecord[], url: URL, now = Date.now()): string {
  return cookies.filter(cookie => {
    const domain = cookie.domain.replace(/^\./, '').toLowerCase();
    const hostMatches = cookie.hostOnly ? url.hostname === domain
      : url.hostname === domain || url.hostname.endsWith(`.${domain}`);
    const pathMatches = url.pathname === cookie.path || (url.pathname.startsWith(cookie.path)
      && (cookie.path.endsWith('/') || url.pathname[cookie.path.length] === '/'));
    const partitionMatches = !cookie.partitionKey || (cookie.partitionKey.topLevelSite === 'https://lanhuapp.com'
      && cookie.partitionKey.hasCrossSiteAncestor !== true);
    return hostMatches && pathMatches && partitionMatches && (!cookie.secure || url.protocol === 'https:')
      && (cookie.expirationDate === undefined || cookie.expirationDate * 1000 > now);
  }).sort((a, b) => b.path.length - a.path.length)
    .map(cookie => cookie.name ? `${cookie.name}=${cookie.value}` : cookie.value).join('; ');
}

// A snapshot preview preserves every domain/path/partition, including same-name
// entries. Use cookieHeader for an actual request to a specific URL.
export function cookieSnapshotHeader(cookies: CookieRecord[], now = Date.now()): string {
  return cookies.filter(cookie => cookie.expirationDate === undefined || cookie.expirationDate * 1000 > now)
    .map(cookie => cookie.name ? `${cookie.name}=${cookie.value}` : cookie.value).join('; ');
}

export type ComposerItem = { title: string; prompt: string };
