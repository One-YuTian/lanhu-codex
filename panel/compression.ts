import { App } from '@modelcontextprotocol/ext-apps';
import { MCP_VERSION } from '../src/runtime-version';
import { CompressionThumbnails, type PreviewChunk } from './compression-thumbnails';
import { ConcurrentTasks } from './compression-tasks';
type Row = { id: string; name: string; path: string; originalSize: number; size?: number; status: string; progress?: number; revision?: number; error?: string };
type Snapshot = { items?: Row[]; errors?: { path?: string; error: string }[]; cancelled?: boolean };
type Settings = { auto_start: boolean; concurrency: number };
const app = new App({ name: '蓝湖图片压缩', version: MCP_VERSION }, {}, { autoResize: true });
const rows = new Map<string, Row>(), removed = new Set<string>();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let connected = false, importing = false, removing = false, ready = false, saving = false, autoPaused = false;
let settings: Settings = { auto_start: true, concurrency: 5 };
let timer: ReturnType<typeof setInterval> | undefined, polling = false;
const thumbnails = new CompressionThumbnails(async (id, offset) => await call('lanhu_compression_thumbnail', { id, offset }) as PreviewChunk, $('list'));
const tasks = new ConcurrentTasks(processRow, changed);
const successful = (row: Row) => ['done', 'unchanged'].includes(row.status);
const available = (row: Row) => !tasks.isScheduled(row.id);
const labels: Record<string, string> = { waiting: '待处理', uploading: '上传中', downloading: '下载中', replacing: '保存中', done: '已完成', unchanged: '已跳过', error: '失败' };
const format = (size?: number) => size == null ? '—' : size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / 1024 / 1024).toFixed(2)} MiB`;
const notice = (text: string) => { $('notice').textContent = text; $('notice').hidden = !text; };
function icon(name: string) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg; }
function button(name: string, label: string, handler: () => void) { const element = document.createElement('button'); element.className = 'row-action'; element.title = label; element.setAttribute('aria-label', label); element.append(icon(name)); element.onclick = handler; return element; }
function disable(id: string, value: boolean) { $<HTMLButtonElement>(id).disabled = value; }
function render() {
  const scroll = $('list').scrollTop; thumbnails.reset(); $('rows').replaceChildren(); let finished = 0;
  for (const row of rows.values()) {
    if (successful(row) || row.status === 'error') finished++;
    const tr = document.createElement('tr'); tr.dataset.id = row.id; tr.dataset.status = row.status;
    const progress = successful(row) ? 100 : row.progress || 0;
    tr.style.setProperty('--progress', `${Math.max(0, Math.min(100, progress))}%`);
    tr.setAttribute('aria-label', `${row.name} ${labels[row.status]} ${Math.round(progress)}%`);
    const name = document.createElement('td'), picture = document.createElement('div'), image = document.createElement('img'), label = document.createElement('span');
    picture.className = 'picture'; label.className = 'filename'; label.textContent = row.name; label.title = row.error ? `${row.path}\n${row.error}` : row.path;
    thumbnails.attach(image, row.id, row.name); picture.append(image, label); name.append(picture); tr.append(name);
    for (const text of [format(row.originalSize), format(row.size), row.size != null && successful(row) ? `${Math.max(0, (1 - row.size / row.originalSize) * 100).toFixed(1)}%` : '—']) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
    const state = document.createElement('td'), badge = document.createElement('span'); badge.className = `status ${row.status}`; badge.textContent = row.status === 'waiting' && tasks.isScheduled(row.id) ? '排队中' : labels[row.status] || row.status;
    badge.title = row.error || (row.status === 'unchanged' ? '无体积收益，保留原图' : `${badge.textContent} ${Math.round(progress)}%`); state.append(badge); tr.append(state);
    const actions = document.createElement('td'); actions.className = 'actions';
    if (row.status === 'error') { const retry = button('retry', `重试 ${row.name}`, () => schedule('error', row.id)); retry.classList.add('retry'); retry.disabled = !available(row) || removing; actions.append(retry); }
    const remove = button('close', `移除 ${row.name}`, () => { void removeRows([row.id]).catch(showError); }); remove.disabled = !available(row) || removing; actions.append(remove); tr.append(actions); $('rows').append(tr);
  }
  $('list').scrollTop = scroll; $('empty').hidden = rows.size > 0; $('count').textContent = `${finished}/${rows.size}`;
  const waiting = [...rows.values()].some(row => row.status === 'waiting' && available(row)), failures = [...rows.values()].some(row => row.status === 'error' && available(row));
  const busy = !connected || !ready || removing;
  disable('files', !connected || importing || removing); disable('settings', !ready || saving);
  disable('clear', busy || !!tasks.activeCount || !!tasks.queuedCount || !rows.size);
  disable('clear-success', busy || ![...rows.values()].some(successful));
  disable('retry', busy || !failures);
  disable('start', busy || !waiting || (settings.auto_start && !autoPaused));
  disable('pause', busy || autoPaused || !tasks.activeCount && !tasks.queuedCount);
}
function changed() {
  if (tasks.activeCount && !timer) timer = setInterval(() => {
    if (!polling) { polling = true; void refresh().catch(() => undefined).finally(() => { polling = false; }); }
  }, 350);
  if (!tasks.activeCount && timer) { clearInterval(timer); timer = undefined; }
  render(); maybeAutoStart();
}
function maybeAutoStart() {
  if (!connected || !ready || importing || removing || saving || !settings.auto_start || autoPaused) return;
  const ids = [...rows.values()].filter(row => row.status === 'waiting' && available(row)).map(row => row.id);
  if (ids.length) { tasks.resume(); tasks.enqueue(ids); }
}
function schedule(status: 'waiting' | 'error', id?: string) {
  const ids = [...rows.values()].filter(row => row.status === status && (!id || row.id === id) && available(row)).map(row => row.id);
  if (!ids.length) return;
  if (status === 'waiting') autoPaused = false;
  tasks.resume(); tasks.enqueue(ids);
}
function showError(error: unknown) { if ((error as { name?: string })?.name !== 'AbortError') notice(error instanceof Error ? error.message : String(error)); }
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await app.callServerTool({ name, arguments: args }, { timeout: name === 'lanhu_compression_import' ? 310_000 : 180_000 });
  const text = result.content?.find(item => item.type === 'text')?.text;
  if (result.isError && name === 'lanhu_compression_run' && text) { try { const item = JSON.parse(text); if (item.id && item.status === 'error') return item; } catch { /* Plain text. */ } }
  if (result.isError) { let message = text || '处理失败，请重试'; try { message = JSON.parse(message).error || message; } catch { /* Plain text. */ } throw new Error(message); }
  return result._meta?.['lanhu/compression'] ?? (text ? JSON.parse(text) : {});
}
function merge(items: Row[] = [], restore = false) {
  for (const item of items) {
    if (restore) removed.delete(item.id); if (removed.has(item.id)) continue;
    if (tasks.isActive(item.id) && item.status === 'waiting') continue;
    if ((item.revision || 0) >= (rows.get(item.id)?.revision || 0)) rows.set(item.id, item);
  }
  render(); maybeAutoStart();
}
async function refresh() { merge((await call('lanhu_compression_list') as Snapshot).items); }
async function processRow(id: string) {
  const row = rows.get(id); if (!row || !['waiting', 'error'].includes(row.status)) return;
  row.status = 'uploading'; row.progress = 0; row.error = undefined; render();
  try { const item = await call('lanhu_compression_run', { id }) as Row; if (!removed.has(id)) rows.set(id, item); }
  catch (error) { row.status = 'error'; row.error = error instanceof Error ? error.message : String(error); rows.set(id, row); }
  render();
}
async function removeRows(ids: string[]) {
  if (removing) return; const safe = ids.filter(id => !tasks.isScheduled(id)); if (!safe.length) return;
  removing = true; render();
  try { await call('lanhu_compression_remove', { ids: safe }); for (const id of safe) { removed.add(id); rows.delete(id); thumbnails.forget(id); tasks.remove(id); } notice(''); }
  finally { removing = false; render(); maybeAutoStart(); }
}
$('files').onclick = () => {
  if (importing) return; importing = true; notice(''); render();
  void call('lanhu_compression_import').then(data => {
    const result = data as Snapshot;
    if (!result.cancelled) { merge(result.items, true); notice((result.errors || []).slice(0, 8).map(item => `${item.path || ''} ${item.error}`).join('\n')); }
  }).catch(showError).finally(() => { importing = false; render(); maybeAutoStart(); });
};
$('clear').onclick = () => { void removeRows([...rows.keys()]).catch(showError); };
$('clear-success').onclick = () => { void removeRows([...rows.values()].filter(successful).map(row => row.id)).catch(showError); };
$('retry').onclick = () => schedule('error'); $('start').onclick = () => schedule('waiting');
$('pause').onclick = () => { autoPaused = true; tasks.pause(); };
const dialog = $<HTMLDialogElement>('settings-dialog');
$('settings').onclick = () => { $('setting-auto').setAttribute('aria-checked', String(settings.auto_start)); $<HTMLInputElement>('setting-concurrency').value = String(settings.concurrency); $('settings-error').textContent = ''; dialog.showModal(); };
$('settings-cancel').onclick = () => dialog.close();
$('setting-auto').onclick = () => { if (!saving) $('setting-auto').setAttribute('aria-checked', String($('setting-auto').getAttribute('aria-checked') !== 'true')); };
$('settings-save').onclick = () => {
  if (saving) return;
  const concurrency = Number($<HTMLInputElement>('setting-concurrency').value);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) { $('settings-error').textContent = '并发数需为 1–20 的整数'; return; }
  const next = { auto_start: $('setting-auto').getAttribute('aria-checked') === 'true', concurrency };
  saving = true; disable('settings-save', true); disable('settings-cancel', true); render();
  void call('lanhu_compression_preferences', next).then(data => {
    const previous = settings.auto_start; settings = data as Settings;
    if (previous && !settings.auto_start) { autoPaused = true; tasks.pause(); }
    if (!previous && settings.auto_start) { autoPaused = false; tasks.resume(); }
    tasks.setConcurrency(settings.concurrency); dialog.close();
  }).catch(error => { $('settings-error').textContent = error instanceof Error ? error.message : String(error); }).finally(() => { saving = false; disable('settings-save', false); disable('settings-cancel', false); render(); maybeAutoStart(); });
};
dialog.oncancel = event => { if (saving) event.preventDefault(); };
// Prevent the host/browser from opening a dropped file; no import or drop target.
window.addEventListener('dragover', event => event.preventDefault()); window.addEventListener('drop', event => event.preventDefault());
app.ontoolresult = result => { const data = result._meta?.['lanhu/compression'] as Snapshot | undefined; if (data?.items) merge(data.items, true); };
render();
void app.connect().then(async () => {
  connected = true;
  try { settings = await call('lanhu_compression_preferences') as Settings; } catch (error) { showError(error); }
  tasks.setConcurrency(settings.concurrency); ready = true; await refresh(); render();
}).catch(() => notice('无法连接宿主，请重新打开图片压缩面板。'));
