import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { configureTransport, rememberProject, recallProject } from '../panel/canvas/transport.js';
import { nativeTransport } from '../panel/canvas-transport';
import { parseRoute, routeHash } from '../panel/canvas/model.js';

afterEach(() => { configureTransport(undefined); vi.unstubAllGlobals(); });
it('浏览器记住最近项目及详情链接，忽略未打开项目的空值', async () => {
  const values = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
  const route = { project_id: 'project', team_id: 'team', image_id: 'image' };
  await rememberProject(route); await rememberProject({ project_id: '' });
  expect(await recallProject()).toEqual(route);
});
it('原生项目记忆只走 MCP，不依赖 localStorage、CDN 或 HTTP', async () => {
  let saved;
  const callServerTool = vi.fn(async ({ name, arguments: args }) => {
    expect(name).toBe('lanhu_canvas_preferences');
    if (args.route) saved = args.route;
    return { content: [], _meta: { 'lanhu/savedRoute': saved } };
  });
  configureTransport(nativeTransport({ callServerTool, openLink: vi.fn() } as any));
  await rememberProject({ project_id: 'project', team_id: 'team' });
  expect(await recallProject()).toEqual({ project_id: 'project', team_id: 'team' });
  expect(callServerTool).toHaveBeenCalledTimes(2);
});
it.each([false, true])('启动自动恢复最近项目，显式链接优先（显式=%s）', async explicit => {
  const app = await readFile('panel/canvas/app.js', 'utf8');
  const source = app.slice(app.indexOf('async function startCanvas()'), app.indexOf('void startCanvas();'));
  let href = explicit ? 'https://lanhu-panel.invalid/#/item/project/stage?pid=explicit' : 'https://lanhu-panel.invalid/';
  const recall = vi.fn(async () => ({ project_id: 'saved', team_id: 'team', image_id: 'image' }));
  const onRoute = vi.fn(), context = { state: { route: parseRoute(href) }, loginRequired: false, recallProject: recall, currentUrl: () => href,
    updateUrl: (url: URL) => { href = String(url); }, parseRoute, routeHash, onRoute, loadProfile: vi.fn(), updatePanels: vi.fn(), annotations: { render: vi.fn() }, URL };
  await runInNewContext(`${source}; startCanvas();`, context);
  expect(parseRoute(href).project_id).toBe(explicit ? 'explicit' : 'saved');
  expect(onRoute).toHaveBeenCalledWith(true);
  expect(recall).toHaveBeenCalledTimes(explicit ? 0 : 1);
});
