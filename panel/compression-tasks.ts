export class ConcurrentTasks {
  private pending = new Set<string>();
  private active = new Set<string>();
  private limit = 5;
  paused = false;
  constructor(private execute: (id: string) => Promise<void>, private changed: () => void = () => {}) {}
  get activeCount() { return this.active.size; }
  get queuedCount() { return this.pending.size; }
  isScheduled(id: string) { return this.pending.has(id) || this.active.has(id); }
  isActive(id: string) { return this.active.has(id); }
  setConcurrency(value: number) { if (!Number.isInteger(value) || value < 1 || value > 20) throw new Error('并发数需为 1–20 的整数'); this.limit = value; this.pump(); }
  enqueue(ids: string[]) { for (const id of ids) if (!this.active.has(id)) this.pending.add(id); this.pump(); this.changed(); }
  remove(id: string) { this.pending.delete(id); }
  pause() { this.paused = true; this.pending.clear(); this.changed(); }
  resume() { this.paused = false; this.pump(); }
  private pump() {
    while (!this.paused && this.active.size < this.limit && this.pending.size) {
      const id = this.pending.values().next().value!; this.pending.delete(id); this.active.add(id);
      void Promise.resolve().then(() => this.execute(id)).catch(() => undefined).finally(() => { this.active.delete(id); this.pump(); this.changed(); });
    }
  }
}
