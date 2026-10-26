import { randomUUID } from 'node:crypto';
import { AppError, type ComposerItem } from './shared';
import { selectionLinks } from './selection-links';

export type Draft = { id: string; title: string; prompt: string; items?: ComposerItem[] };
type Panel = { seenAt: number; visible: boolean; ready: boolean; mentionsSupported?: boolean };
type Receiver = { resolve: () => void; timer: ReturnType<typeof setTimeout> };
const PANEL_LEASE_MS = 75_000;
const SELECTION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SELECTIONS = 200;
type Pending = { panel: string; draft: Draft; resolve: (result: { draftId: string }) => void;
  reject: (error: AppError) => void; timer: ReturnType<typeof setTimeout> };

/** In-memory relay. No session IDs, OS windows, credentials or draft text on disk. */
export class DraftInbox {
  private panels = new Map<string, Panel>();
  private pending = new Map<string, Pending>();
  private receivers = new Map<string, Receiver>();
  private activePanel: string | undefined;
  private selections = new Map<string, { draft: Draft; expiresAt: number }>();
  constructor(private readonly options: { now?: () => number; timeoutMs?: number } = {}) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  private pruneSelections() {
    for (const [id, item] of this.selections) if (item.expiresAt <= this.now()) this.selections.delete(id);
  }
  register(items: ComposerItem[]) {
    this.pruneSelections();
    const draft: Draft = { id: randomUUID(), title: '蓝湖标注', prompt: '', items: structuredClone(items) };
    this.selections.set(draft.id, { draft, expiresAt: this.now() + SELECTION_TTL_MS });
    while (this.selections.size > MAX_SELECTIONS) this.selections.delete(this.selections.keys().next().value!);
    return selectionLinks(draft);
  }
  getSelection(selectionId: string) {
    this.pruneSelections();
    const selection = this.selections.get(selectionId);
    if (!selection) throw new AppError('SELECTION_EXPIRED', '蓝湖选区引用已失效或服务已重启，请在蓝湖重新选择并发送到 Codex');
    return { selection_id: selectionId, title: selection.draft.title, prompt: selection.draft.prompt,
      ...(selection.draft.items ? { items: structuredClone(selection.draft.items) } : {}),
      expires_at: new Date(selection.expiresAt).toISOString() };
  }
  searchMentions(query: string) {
    this.pruneSelections();
    const term = query.trim().toLocaleLowerCase();
    return [...this.selections.values()].reverse().flatMap(item => selectionLinks(item.draft))
      .filter(item => !term || (item.title ?? item.name).toLocaleLowerCase().includes(term)).slice(0, 20);
  }
  open() {
    this.prune();
    if (this.panels.size >= 32) throw new AppError('TOO_MANY_PANELS', '打开的蓝湖面板过多，请关闭不用的面板');
    const token = randomUUID();
    this.panels.set(token, { seenAt: this.now(), visible: false, ready: false });
    this.activePanel = token;
    return token;
  }
  private prune() {
    for (const [token, panel] of this.panels) if (this.now() - panel.seenAt > PANEL_LEASE_MS * 2) this.closePanel(token);
  }
  poll(token: string, visible: boolean, mentionsSupported = true): Draft | null {
    // A slow suspended iframe may renew its own existing token; unknown tokens cannot join.
    const panel = this.panels.get(token);
    if (!panel) throw new AppError('PANEL_EXPIRED', '接收面板已失效，请在目标会话重新打开');
    panel.seenAt = this.now(); panel.visible = visible; panel.ready = mentionsSupported; panel.mentionsSupported = mentionsSupported;
    if (!mentionsSupported) return null;
    const live = this.livePanels();
    // Hidden receivers retain the last unambiguous destination. Poll order is
    // never used to select a different chat.
    const foreground = live.filter(([, item]) => item.visible);
    if (visible && foreground.length === 1) this.activePanel = token;
    else if (!this.activePanel && live.length === 1) this.activePanel = token;
    return [...this.pending.values()].find(item => item.panel === token)?.draft ?? null;
  }
  private livePanels() {
    return [...this.panels].filter(([, panel]) => panel.ready && this.now() - panel.seenAt <= PANEL_LEASE_MS);
  }
  async receive(token: string, visible: boolean, waitMs = 0, mentionsSupported = true): Promise<Draft | null> {
    const draft = this.poll(token, visible, mentionsSupported);
    if (draft || !waitMs || !mentionsSupported) return draft;
    if (this.receivers.has(token)) throw new AppError('RECEIVER_BUSY', '当前面板已有接收请求');
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => this.wake(token), waitMs);
      this.receivers.set(token, { resolve, timer });
    });
    return this.poll(token, this.panels.get(token)?.visible ?? visible);
  }
  private wake(token: string) {
    const receiver = this.receivers.get(token);
    if (!receiver) return;
    this.receivers.delete(token); clearTimeout(receiver.timer); receiver.resolve();
  }
  push(prompt: string, title = '蓝湖画布', items?: ComposerItem[]): Promise<{ draftId: string }> {
    this.prune();
    const live = this.livePanels();
    const visible = live.filter(([, panel]) => panel.visible);
    if (visible.length > 1) return Promise.reject(new AppError('PANEL_AMBIGUOUS', '多个会话的蓝湖面板同时可见，请切换到目标会话以确认接收位置'));
    const candidate = visible[0] ?? live.find(([token]) => token === this.activePanel);
    if (!candidate && this.activePanel && this.panels.get(this.activePanel)?.mentionsSupported === false)
      return Promise.reject(new AppError('COMPOSER_MENTIONS_UNSUPPORTED', '当前 Codex 未声明资源 mention 追加能力，无法将蓝湖对象作为 mention 添加到 Composer'));
    if (!candidate) return Promise.reject(new AppError(live.length ? 'PANEL_AMBIGUOUS' : 'PANEL_NOT_OPEN',
      live.length ? '接收目标未明确，请在目标会话显示蓝湖面板以确认接收位置' : '当前会话的蓝湖接收器尚未连接，请先加载一次蓝湖面板；连接后可以折叠到后台'));
    if (this.pending.size) return Promise.reject(new AppError('COMPOSER_BUSY', '上一条内容仍在添加，请稍后重试'));
    const draft: Draft = { id: randomUUID(), prompt, title, ...(items ? { items } : {}) };
    this.pruneSelections();
    this.selections.set(draft.id, { draft: structuredClone(draft), expiresAt: this.now() + SELECTION_TTL_MS });
    while (this.selections.size > MAX_SELECTIONS) this.selections.delete(this.selections.keys().next().value!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(draft.id);
        reject(new AppError('DRAFT_TIMEOUT', '未收到面板的添加确认，请检查当前会话草稿后再重试'));
      }, this.options.timeoutMs ?? 10_000);
      this.activePanel = candidate[0];
      this.pending.set(draft.id, { panel: candidate[0], draft, resolve, reject, timer });
      this.wake(candidate[0]);
    });
  }
  ack(token: string, draftId: string, inserted: boolean) {
    const pending = this.pending.get(draftId);
    if (!pending || pending.panel !== token) return { accepted: false };
    clearTimeout(pending.timer); this.pending.delete(draftId);
    if (inserted) pending.resolve({ draftId });
    else pending.reject(new AppError('DRAFT_NOT_CONFIRMED', '面板未能确认草稿已添加；请检查输入框，未自动发送消息'));
    return { accepted: true };
  }
  closePanel(token: string) {
    this.panels.delete(token);
    this.wake(token);
    for (const [id, pending] of this.pending) if (pending.panel === token) {
      clearTimeout(pending.timer); this.pending.delete(id);
      pending.reject(new AppError('PANEL_CLOSED', '接收面板已关闭，请检查草稿后重新打开目标面板'));
    }
  }
  dispose() { for (const token of this.panels.keys()) this.closePanel(token); this.selections.clear(); }
}
