import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it('手动登录成功清理认证状态并直接进入项目管理，不保留旧项目路由', async () => {
  const app = await readFile('panel/canvas/app.js', 'utf8');
  const source = app.slice(app.indexOf('function completeLogin()'), app.indexOf('async function checkCanvasLogin()'));
  const navigate = vi.fn(), remove = vi.fn(), flow = { manual: true };
  const context = { loginFlow: flow, loginRequired: true, document: { documentElement: { classList: { remove } } },
    $: () => ({ replaceChildren: vi.fn() }), projectPicker: { close: vi.fn() }, navigate, loadProfile: vi.fn() };
  runInNewContext(`${source}; completeLogin();`, context);
  expect(context.loginRequired).toBe(false); expect(flow.manual).toBe(false);
  expect(remove).toHaveBeenCalledWith('auth-checking', 'login-required');
  expect(navigate).toHaveBeenCalledWith({});
});

it.each(['project', 'layers'])('设计稿加载与图层数据返回不会改变用户当前的 %s 标签', async nav => {
  const app = await readFile('panel/canvas/app.js', 'utf8');
  const source = app.slice(app.indexOf('async function loadDetail()'), app.indexOf('function renderLayers()'));
  const state = { nav, route: { image_id: 'image' }, images: [{ id: 'image' }], filter: 'group', groups: { byImage: new Map() }, collapsedLayers: new Set() };
  const context = { state, detailGeneration: 0, Set, controller: { signal: undefined },
    $: () => ({ hidden: false, textContent: '', innerHTML: '' }), world: { replaceChildren: vi.fn(), append: vi.fn() },
    message: vi.fn(), unwrap: (value: unknown) => value,
    api: vi.fn(async endpoint => endpoint === 'design' ? { versions: [{ id: 'version', width: 375, height: 667 }] } : {}),
    createBoard: vi.fn(), renderNavigation: vi.fn(), renderProperties: vi.fn(), fit: vi.fn(),
    designSize: () => ({}), designLayers: () => [{ id: 'text' }], renderLayers: vi.fn(), loadSlices: vi.fn(), toast: vi.fn() };
  await runInNewContext(`${source}; loadDetail();`, context);
  expect(context.toast).not.toHaveBeenCalled();
  expect(state.nav).toBe(nav);
  expect(state.layers).toEqual([{ id: 'text' }]);
});
