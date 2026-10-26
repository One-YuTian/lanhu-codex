import { savedProject } from './project-memory.js';
import { extractLanhuLinks, projectMemoryKey } from './lanhu-links.js';
let adapter;
let panelRoute = '';
const images = new Map();
let imageBytes = 0;
export function configureTransport(value) { adapter = value; }
export function currentUrl() { return adapter ? `https://lanhu-panel.invalid/${panelRoute}` : location.href; }
export function setPanelRoute(hash) { panelRoute = hash; window.dispatchEvent(new Event('lanhu-navigation')); }
export function updateUrl(url, replace = false) {
  if (adapter) { panelRoute = url.hash; return; }
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
}
export function canvasFetch(url, options = {}) { return adapter ? adapter.fetch(url, options) : fetch(url, options); }
export async function recallProject() {
  try { return savedProject(adapter ? await adapter.recallProject() : JSON.parse(localStorage.getItem('lanhu:last-project') || 'null')); }
  catch { return null; }
}
export async function rememberProject(value) {
  const route = savedProject(value); if (!route) return;
  if (adapter) await adapter.rememberProject(route);
  else localStorage.setItem('lanhu:last-project', JSON.stringify(route));
}
export async function recallTeam() {
  try { return adapter ? await adapter.recallTeam() : localStorage.getItem('lanhu:last-team'); }
  catch { return null; }
}
export async function rememberTeam(team_id) {
  if (!team_id) return;
  if (adapter) await adapter.rememberTeam(team_id);
  else localStorage.setItem('lanhu:last-team', team_id);
}
export async function recallGroup(route) {
  try { return adapter ? await adapter.recallGroup(route) : JSON.parse(localStorage.getItem('lanhu:groups') || '{}')[projectMemoryKey(route)]; } catch { return null; }
}
export async function rememberGroup(route, group_id) {
  if (!group_id || !route.project_id) return;
  if (adapter) return adapter.rememberGroup(route, group_id);
  const groups = JSON.parse(localStorage.getItem('lanhu:groups') || '{}'); groups[projectMemoryKey(route)] = group_id;
  localStorage.setItem('lanhu:groups', JSON.stringify(groups));
}
export async function clipboardSeen() {
  try { return adapter ? await adapter.clipboardSeen() : JSON.parse(localStorage.getItem('lanhu:clipboard-seen') || '[]'); } catch { return []; }
}
export async function markClipboardSeen(hash) {
  if (adapter) return adapter.markClipboardSeen(hash);
  const seen = new Set(await clipboardSeen()); seen.add(hash); localStorage.setItem('lanhu:clipboard-seen', JSON.stringify([...seen]));
}
export async function readClipboardLinks() {
  if (adapter) return adapter.clipboardLinks();
  try {
    const permission = await navigator.permissions.query({ name: 'clipboard-read' });
    if (permission.state !== 'granted') return [];
    return extractLanhuLinks(await navigator.clipboard.readText());
  } catch { return []; }
}
export async function appendDraft(items) {
  if (!adapter?.appendDraft) throw new Error('请在 Codex 蓝湖插件面板中提交标注。');
  return adapter.appendDraft(items);
}
export async function setLoginCookie(cookie) {
  if (!adapter?.setLoginCookie) throw new Error('请在 Codex 蓝湖插件中手动填写 Cookie。');
  return adapter.setLoginCookie(cookie);
}
export function openExternal(url) {
  if (adapter) return adapter.open(url);
  return window.open(url, '_blank', 'noopener,noreferrer');
}
export async function assignImage(image, url, { placeholder = false } = {}) {
  image.hidden = true;
  image.loading = 'eager';
  const container = image.parentElement;
  const loadingClass = placeholder ? 'manager-cover-loading' : 'image-loading';
  container?.classList.add(loadingClass);
  image.addEventListener('load', () => { image.hidden = false; container?.classList.remove(loadingClass); }, { once: true });
  image.addEventListener('error', () => { image.hidden = true; container?.classList.remove(loadingClass); }, { once: true });
  if (!adapter) { image.src = url; return; }
  let entry = images.get(url);
  if (!entry) {
    entry = { size: 0, promise: canvasFetch(url).then(async response => {
      if (!response.ok) throw new Error('图片读取失败');
      const blob = await response.blob();
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('图片解码失败'));
        reader.readAsDataURL(blob);
      });
      return { size: blob.size, source };
    }) };
    images.set(url, entry);
    entry.promise.then(asset => {
      if (images.get(url) !== entry) return;
      entry.size = asset.size; imageBytes += asset.size;
      while (images.size > 24 || imageBytes > 32 * 1024 * 1024) {
        const key = images.keys().next().value;
        if (key === undefined) break;
        imageBytes -= images.get(key).size; images.delete(key);
      }
    }, () => { if (images.get(url) === entry) images.delete(url); });
  }
  try {
    const { source } = await entry.promise;
    image.src = source;
  } catch { image.dispatchEvent(new Event('error')); }
}
export function hydrateImages(root) {
  root.querySelectorAll('img[data-resource-src]').forEach(image => { void assignImage(image, image.dataset.resourceSrc); });
}
