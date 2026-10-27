export type PreviewChunk = { base64: string; mime: string; total: number; offset: number; next: number; revision: string };
const placeholder = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><g fill="none" stroke="#adb7c5"><rect x="9" y="9" width="18" height="18" rx="3"/><path d="m9 24 6-6 4 4 3-5 5 6"/></g></svg>')}`;
export function imageDataUrl(blob: Blob, name: string): Promise<string> {
  const mime = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('预览读取失败'));
    reader.readAsDataURL(new Blob([blob], { type: mime }));
  });
}
export class CompressionThumbnails {
  private cache = new Map<string, string>();
  private pending = new Set<string>();
  private attempts = new Map<string, number>();
  private jobs: { id: string; name: string }[] = [];
  private live = new Set<string>();
  private active = 0;
  private observer: IntersectionObserver;
  private waiting = new WeakMap<HTMLImageElement, { id: string; name: string }>();
  constructor(private read: (id: string, offset: number) => Promise<PreviewChunk>, root: HTMLElement) {
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        this.observer.unobserve(entry.target);
        const job = this.waiting.get(entry.target as HTMLImageElement); if (job) this.enqueue(job);
      }
    }, { root, rootMargin: '80px' });
  }
  reset() { this.observer.disconnect(); }
  forget(id: string) { this.cache.delete(id); this.live.delete(id); this.attempts.delete(id); this.jobs = this.jobs.filter(job => job.id !== id); }
  attach(image: HTMLImageElement, id: string, name: string) {
    this.live.add(id); image.dataset.previewId = id; image.alt = ''; image.className = 'thumb'; image.src = this.cache.get(id) || placeholder;
    if (!this.cache.has(id)) { this.waiting.set(image, { id, name }); this.observer.observe(image); }
  }
  private enqueue(job: { id: string; name: string }) {
    if (this.pending.has(job.id) || this.cache.has(job.id) || !this.live.has(job.id) || (this.attempts.get(job.id) || 0) >= 3) return;
    this.pending.add(job.id); this.jobs.push(job); this.pump();
  }
  private pump() {
    while (this.active < 2 && this.jobs.length) {
      const job = this.jobs.shift()!;
      if (!this.live.has(job.id)) { this.pending.delete(job.id); continue; }
      this.active++; this.attempts.set(job.id, (this.attempts.get(job.id) || 0) + 1);
      void this.generate(job.id, job.name).catch(() => {
        // A transient tool/decoder error must not permanently cache a placeholder.
        setTimeout(() => this.enqueue(job), 500);
      }).finally(() => { this.active--; this.pending.delete(job.id); this.pump(); });
    }
  }
  private async generate(id: string, name: string) {
    let blob: Blob;
    {
      let offset = 0, total = 0, revision = ''; const parts: Uint8Array<ArrayBuffer>[] = [];
      do {
        const chunk = await this.read(id, offset);
        if (chunk.offset !== offset || chunk.total > 32 * 1024 * 1024 || (revision && chunk.revision !== revision)) throw new Error('预览内容已变化');
        const bytes = Uint8Array.from(atob(chunk.base64), char => char.charCodeAt(0));
        if (chunk.next !== offset + bytes.length || (chunk.next <= offset && chunk.next < chunk.total)) throw new Error('预览数据不完整');
        parts.push(bytes); offset = chunk.next; total = chunk.total; revision = chunk.revision;
      } while (offset < total);
      blob = new Blob(parts);
    }
    // data: URLs are supported by the MCP sandbox, whereas blob: may be blocked.
    const source = await imageDataUrl(blob, name), image = new Image(); image.src = source; await image.decode();
    let thumbnail = source;
    try {
      const scale = Math.min(72 / image.naturalWidth, 72 / image.naturalHeight, 1), canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d'); if (context) { context.drawImage(image, 0, 0, canvas.width, canvas.height); thumbnail = canvas.toDataURL('image/webp', .8); }
    } catch { /* A decoded source is still a usable preview if canvas is unavailable. */ }
    if (!this.live.has(id)) return;
    this.cache.set(id, thumbnail);
    for (const element of document.querySelectorAll<HTMLImageElement>('img[data-preview-id]')) if (element.dataset.previewId === id) element.src = thumbnail;
  }
}
