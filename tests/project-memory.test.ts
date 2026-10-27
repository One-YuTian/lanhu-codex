import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { configureTransport, rememberProject, recallProject, recallRecentProjects } from '../panel/canvas/transport.js';
import { nativeTransport } from '../panel/canvas-transport';
import { parseRoute, routeHash } from '../panel/canvas/model.js';
import { recentProjectRoutes, rememberRecentProject } from '../panel/canvas/project-memory.js';

it('最近项目最多保留八条，旧历史自动截断，再次打开去重置顶', () => {
 const history = Array.from({ length: 20 }, (_, i) => ({ project_id: `p${i}`, team_id: 'team' }));
 expect(recentProjectRoutes(history)).toEqual(history.slice(0, 8));
 const reordered = rememberRecentProject(history, { project_id: 'p5', team_id: 'team', image_id: 'image' });
 expect(reordered).toEqual([history[5], ...history.slice(0, 5), ...history.slice(6, 8)]);
 expect(rememberRecentProject(history, { project_id: 'new', team_id: 'team' })).toEqual([{ project_id: 'new', team_id: 'team' }, ...history.slice(0, 7)]);
});

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
it.each([false, true])('启动恢复最近项目，显式链接优先（显式=%s）', async explicit => {
  const app = await readFile('panel/canvas/app.js', 'utf8');
  const source = app.slice(app.indexOf('async function startCanvas()'), app.indexOf('installSidebarResize({ sidebar:'));
  let href = explicit ? 'https://lanhu-panel.invalid/#/item/project/stage?pid=explicit' : 'https://lanhu-panel.invalid/';
  const recall = vi.fn(async () => ({ project_id: 'saved', team_id: 'team', image_id: 'image' }));
  const onRoute = vi.fn(), context = { state: { route: parseRoute(href) }, loginRequired: false, recallProject: recall, currentUrl: () => href,
    updateUrl: (url: URL) => { href = String(url); }, parseRoute, routeHash, onRoute, loadProfile: vi.fn(), updatePanels: vi.fn(), annotations: { render: vi.fn() }, URL };
  await runInNewContext(`${source}; startCanvas();`, context);
  expect(parseRoute(href).project_id).toBe(explicit ? 'explicit' : 'saved');
  expect(onRoute).toHaveBeenCalledWith(true);
  expect(recall).toHaveBeenCalledTimes(explicit ? 0 : 1);
});

it('项目记忆读取过程中用户选择了其他项目，迟到的记忆不会覆盖新选择', async () => {
  const app = await readFile('panel/canvas/app.js', 'utf8');
  const source = app.slice(app.indexOf('async function startCanvas()'), app.indexOf('installSidebarResize({ sidebar:'));
  let href = 'https://lanhu-panel.invalid/', resolve!: (value: any) => void;
  const recall = new Promise(done => { resolve = done; });
  const state = { route: parseRoute(href), generation: 0 };
  const onRoute = vi.fn(), context = { state, loginRequired: false, recallProject: () => recall, currentUrl: () => href,
    updateUrl: (url: URL) => { href = String(url); }, parseRoute, routeHash, onRoute, loadProfile: vi.fn(), updatePanels: vi.fn(), annotations: { render: vi.fn() }, URL };
  const pending = runInNewContext(`${source}; startCanvas();`, context);
  href = 'https://lanhu-panel.invalid/#/item/project/stage?pid=new-project'; state.generation++;
  resolve({ project_id: 'old-project' }); await pending;
  expect(parseRoute(href).project_id).toBe('new-project');
});
it('没有项目记忆时保留项目管理页', async () => {
  const app = await readFile('panel/canvas/app.js', 'utf8');
  const source = app.slice(app.indexOf('async function startCanvas()'), app.indexOf('installSidebarResize({ sidebar:'));
  let href = 'https://lanhu-panel.invalid/';
  const context = { state: { route: parseRoute(href) }, loginRequired: false, recallProject: async () => null, currentUrl: () => href,
    updateUrl: (url: URL) => { href = String(url); }, parseRoute, routeHash, onRoute: vi.fn(), loadProfile: vi.fn(), updatePanels: vi.fn(), annotations: { render: vi.fn() }, URL };
  await runInNewContext(`${source}; startCanvas();`, context); expect(parseRoute(href).project_id).toBe('');
});

it('最近打开项目按访问顺序持久化并去重，不将不同设计稿重复记成项目', async () => {
 const values=new Map();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key),setItem:(key:string,value:string)=>values.set(key,value)});
 await rememberProject({project_id:'a',team_id:'team',image_id:'one'});await rememberProject({project_id:'b',team_id:'team'});await rememberProject({project_id:'a',team_id:'team',image_id:'two'});
 expect(await recallRecentProjects()).toEqual([{project_id:'a',team_id:'team'},{project_id:'b',team_id:'team'}]);
});
