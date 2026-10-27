import { parseRoute } from './model.js';
import { savedProject } from './project-memory.js';

export function extractLanhuLinks(text) {
  const normalized = String(text || '').slice(0, 65536).replace(/\\&/g, '&').replace(/&amp;/gi, '&');
  const found = normalized.match(/(?<![\w.@/-])(?:https?:\/\/)?(?:www\.)?lanhuapp\.com(?![\w.-])(?:[/?#][A-Za-z0-9\-._~:/?#@!$&()*+,;=%\[\]]*)?/gi) || [];
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

export async function resolveProjectInput(value, resolve) {
  const links = extractLanhuLinks(value);
  if (!links.length) throw new Error('请输入有效的蓝湖项目、设计稿或邀请链接');
  if (links.length > 1) throw new Error('请一次导入一个蓝湖链接');
  const route = localLanhuRoute(links[0]) || savedProject(await resolve(links[0]));
  if (!route) throw new Error('未能从邀请链接获取项目地址，请检查链接或使用浏览器打开后的项目链接');
  return route;
}
