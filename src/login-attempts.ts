import { randomUUID } from 'node:crypto';
import { AppError } from './shared';

export class LoginAttempts {
  private items = new Map<string, { state: 'active' | 'cancelled' | 'completed'; created: number }>();
  start(id: string = randomUUID()) {
    for (const [key, item] of this.items) if (Date.now() - item.created > 24 * 3600_000) this.items.delete(key);
    if (this.items.size >= 200) throw new AppError('LOGIN_ATTEMPTS_FULL', '登录流程过多，请稍后重试');
    if (this.items.has(id)) throw new AppError('LOGIN_ATTEMPT_EXISTS', '此登录流程已登记');
    this.items.set(id, { state: 'active', created: Date.now() });
    return this.status(id);
  }
  status(id: string) {
    const item = this.items.get(id);
    return { attempt_id: id, state: item && Date.now() - item.created < 24 * 3600_000 ? item.state : 'expired' };
  }
  requireActive(id: string) {
    if (this.status(id).state !== 'active') throw new AppError('LOGIN_ATTEMPT_CANCELLED', '登录流程已取消或结束，请结束原登录任务，不再读取或提交 Cookie');
  }
  finish(id: string, state: 'cancelled' | 'completed') {
    const item = this.items.get(id);
    if (item?.state === 'active') item.state = state;
    return this.status(id);
  }
}
