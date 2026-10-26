import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { type CookieRecord } from '../src/shared';

export const origin = `chrome-extension://${'a'.repeat(32)}`;
export const cookie = (changes: Partial<CookieRecord> = {}): CookieRecord => ({
  name: 'session', value: 'fixture-only', domain: '.lanhuapp.com', path: '/',
  secure: true, httpOnly: true, hostOnly: false, session: true, sameSite: 'lax', storeId: '0', ...changes
});
export async function reserve(port = 0): Promise<{ port: number; close(): Promise<void>; server: Server }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { port: (server.address() as AddressInfo).port, server, close: () => new Promise(resolve => server.close(() => resolve())) };
}
export async function freePort(): Promise<number> { const held = await reserve(); await held.close(); return held.port; }
