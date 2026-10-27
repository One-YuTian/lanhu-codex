import { extractLanhuLinks, localLanhuRoute } from './lanhu-links.js';
import { savedProject, sameProject } from './project-memory.js';
import { unwrap } from './model.js';
import { canvasFetch, clipboardSeen, markClipboardSeen, readClipboardLinks } from './transport.js';
import { knownProject } from './project-manager.js';

export async function linkHash(link) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(link));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export function createClipboardDetector({ resolve, inspect, known = () => null, ask, open, seen = clipboardSeen, mark = markClipboardSeen, hash = linkHash, enabled = () => true, getRoute = () => null }) {
  let busy = false;
  const attempted = new Set();
  return async text => {
    if (busy || !enabled()) return;
    busy = true;
    try {
      const candidates = [];
      for (const link of extractLanhuLinks(text)) { const key = await hash(link); if (!attempted.has(key)) candidates.push({ link, key }); }
      if (!candidates.length) return;
      const handled = new Set(await seen());
      for (const { link, key } of candidates) {
        if (handled.has(key)) { attempted.add(key); continue; }
        attempted.add(key);
        try {
          const route = savedProject(localLanhuRoute(link) || await resolve(link));
          if (!route || sameProject(route, getRoute())) continue;
          const fallback = known(route);
          const detail = await inspect(route).catch(() => null);
          const project = detail || fallback;
          if (!project || !enabled() || sameProject(route, getRoute())) continue;
          const projectKey = await hash(`project:${route.team_id || project.team_id || ''}:${route.project_id}`);
          if (handled.has(projectKey)) continue;
          // Persist before presenting; both decisions and Escape are one-time.
          await mark(key); await mark(projectKey); handled.add(key); handled.add(projectKey);
          if (sameProject(route, getRoute())) continue;
          if (await ask(project, route)) open({ ...route, ...(project.team_id ? { team_id: project.team_id } : {}) });
          break;
        } catch { /* Invalid, inaccessible and offline links never interrupt the UI. */ }
      }
    } catch { /* Clipboard and persistence can be unavailable in a host. */ }
    finally { busy = false; }
  };
}
export function installClipboardProjects({ root = document, host = window, enabled, open, getRoute }) {
  const dialog = root.querySelector('#clipboard-project-dialog');
  const allowed = () => enabled() && root.visibilityState !== 'hidden' && !root.querySelector('dialog[open]');
  const check = createClipboardDetector({ enabled: allowed, known: knownProject, open, getRoute,
    resolve: async link => {
      const response = await canvasFetch(`/api/resolve?${new URLSearchParams({ url: link })}`);
      return response.ok ? (await response.json()).route : null;
    },
    inspect: async route => {
      const query = new URLSearchParams({ project_id: route.project_id }); if (route.team_id) query.set('team_id', route.team_id);
      const response = await canvasFetch(`/api/project?${query}`);
      if (!response.ok) return null;
      const raw = await response.json(); if (raw.error || raw.status === 'error' || raw.code !== undefined && !['0', '00000', '200'].includes(String(raw.code))) return null;
      const data = unwrap(raw), project = data.project || data;
      if (!project.id && !project.name) return null;
      return { id: route.project_id, name: project.name || '蓝湖项目', team_id: route.team_id || project.team_id };
    },
    ask: project => new Promise(resolve => {
      root.querySelector('#clipboard-project-name').textContent = project.name || '蓝湖项目';
      const finish = value => dialog.close(value);
      root.querySelector('#clipboard-project-open').onclick = () => finish('open');
      root.querySelector('#clipboard-project-dismiss').onclick = () => finish('dismiss');
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'open'), { once: true });
      dialog.returnValue = ''; dialog.showModal();
    })
  });
  let reading = false;
  const scan = async () => {
    if (reading || !allowed() || root.hasFocus && !root.hasFocus()) return;
    reading = true;
    try { await check((await readClipboardLinks()).join('\n')); } catch {} finally { reading = false; }
  };
  host.addEventListener('focus', scan);
  root.addEventListener('visibilitychange', scan);
  root.addEventListener('paste', event => { const text = event.clipboardData?.getData('text/plain'); if (text) void check(text); });
  const timer = setInterval(scan, 2500); void scan();
  host.addEventListener('pagehide', () => clearInterval(timer), { once: true });
}
