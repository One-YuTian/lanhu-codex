import { randomUUID } from 'node:crypto';
import { AppError, type ComposerItem } from './shared';
import { selectionLinks } from './selection-links';

export type Draft = { id: string; title: string; prompt: string; items?: ComposerItem[] };
const SELECTION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SELECTIONS = 200;
/** In-memory annotation resources for Composer mentions. */
export class DraftInbox {
  private selections = new Map<string, { draft: Draft; expiresAt: number }>();
  constructor(private readonly options: { now?: () => number } = {}) {}
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
  dispose() { this.selections.clear(); }
}
