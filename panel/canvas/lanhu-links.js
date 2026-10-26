import { parseRoute } from './model.js';
import { savedProject } from './project-memory.js';

export function extractLanhuLinks(text) {
  const found = String(text || '').slice(0, 65536).match(/(?<![\w.@/-])(?:https?:\/\/)?(?:www\.)?lanhuapp\.com(?![\w.-])(?:[/?#][A-Za-z0-9\-._~:/?#@!$&()*+,;=%\[\]]*)?/gi) || [];
  const result = new Set();
  for (const item of found) {
    try {
      const value = item.replace(/[)\]）},，.。;；!！?？]+$/g, '');
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (!['lanhuapp.com', 'www.lanhuapp.com'].includes(url.hostname) || url.username || url.password || url.port) continue;
      url.protocol = 'https:'; url.hostname = 'lanhuapp.com'; result.add(url.href);
    } catch { /* Ignore malformed fragments. */ }
  }
  return [...result];
}
export function localLanhuRoute(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['lanhuapp.com', 'www.lanhuapp.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
    return savedProject(parseRoute(url.href));
  }
  catch { return null; }
}
export const projectMemoryKey = route => `${route.team_id || ''}:${route.project_id}`;
export function firstProjectGroup(groups, preferred) {
  if (preferred === 'ungrouped' || groups.byId.has(preferred)) return preferred;
  return groups.roots[0]?.id || 'ungrouped';
}
