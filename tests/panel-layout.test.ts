import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { preparePanelLayout } from '../panel/canvas/panel-layout.js';
import { configureIcons, icon, iconHref } from '../panel/canvas/icons.js';
import { layerIcon } from '../panel/canvas/model.js';

it('原生面板移除页面头部，仅将操作按钮合并进工具栏，不保留头像', () => {
  const controls = ['help', 'link-button', 'share', 'refresh', 'user-avatar'].map(id => ({ id }));
  const header = { querySelectorAll: () => controls, remove: vi.fn() };
  const back = { id: 'back-projects' };
  const toolbar = { append: vi.fn(), prepend: vi.fn(), setAttribute: vi.fn() };
  const root = { documentElement: { classList: { add: vi.fn() } }, createElement: () => ({}),
    querySelector: (selector: string) => selector === '.header' ? header : selector === '#back-projects' ? back : toolbar };
  preparePanelLayout(root as any);
  expect(root.documentElement.classList.add).toHaveBeenCalledWith('native-panel');
  expect(header.remove).toHaveBeenCalledOnce();
  expect(toolbar.prepend).not.toHaveBeenCalled();
  expect(toolbar.append.mock.calls.slice(1).map(([control]) => control.id)).toEqual(['help', 'link-button', 'share', 'refresh']);
  expect(toolbar.setAttribute).toHaveBeenCalledWith('aria-label', '画布工具栏');
});

it('首页隐藏左栏及展开入口，打开项目后按用户折叠状态恢复', async () => {
  const app = await readFile('panel/canvas/app.js', 'utf8');
  const source = app.slice(app.indexOf('function updatePanels()'), app.indexOf('async function loadProfile()'));
  const elements = Object.fromEntries(['sidebar', 'expand-left', 'inspector', 'expand-right'].map(id => [`#${id}`, { hidden: false }]));
  const state = { route: { project_id: '' }, detail: null, layer: null };
  const panels = { leftCollapsed: false, rightCollapsed: false };
  const context = { $: (selector: string) => elements[selector], state, panels, loginRequired: false };
  runInNewContext(`${source}; updatePanels();`, context);
  expect(elements['#sidebar'].hidden).toBe(true);
  expect(elements['#expand-left'].hidden).toBe(true);
  state.route.project_id = 'project';
  runInNewContext('updatePanels();', context);
  expect(elements['#sidebar'].hidden).toBe(false);
  panels.leftCollapsed = true;
  runInNewContext('updatePanels();', context);
  expect(elements['#sidebar'].hidden).toBe(true);
  expect(elements['#expand-left'].hidden).toBe(false);
  context.loginRequired = true;
  runInNewContext('updatePanels();', context);
  expect(elements['#expand-left'].hidden).toBe(true);
  expect(elements['#sidebar'].hidden).toBe(true);
  context.loginRequired = false;
  state.route.project_id = '';
  runInNewContext('updatePanels();', context);
  expect(elements['#expand-left'].hidden).toBe(true);
});

it('原生面板移除头像后不再请求用户资料，也不会出现空节点错误', async () => {
  const app = await readFile('panel/canvas/app.js', 'utf8');
  const source = app.slice(app.indexOf('async function loadProfile()'), app.indexOf('function toast('));
  const request = vi.fn();
  await runInNewContext(`${source}; loadProfile();`, { $: () => null, canvasFetch: request });
  expect(request).not.toHaveBeenCalled();
});

it('切图加载后更新图层图标仍使用内嵌 symbol，不重新引用宿主上的 lucide.svg', async () => {
  configureIcons('', 'lh-icon-');
  try {
    expect(icon('folder')).toContain('href="#lh-icon-folder"');
    expect(iconHref('image-down')).toBe('#lh-icon-image-down');
    const app = await readFile('panel/canvas/app.js', 'utf8');
    const functionSource = app.slice(app.indexOf('function updateLayerIcons()'), app.indexOf('function filter(value)'));
    const use = { setAttribute: vi.fn() };
    const button = { dataset: { layerId: 'slice' }, querySelector: () => use };
    runInNewContext(`${functionSource}; updateLayerIcons();`, { state: { layers: [{ id: 'slice', hasExportImage: true }], slices: [] },
      $: () => ({ querySelectorAll: () => [button] }), iconHref, layerIcon });
    expect(use.setAttribute).toHaveBeenCalledWith('href', '#lh-icon-image-down');
    expect(app).not.toContain('/icons/lucide.svg');
  } finally { configureIcons('/icons/lucide.svg'); }
});

it('原生面板没有项目名称按钮时仍能更新项目标题，不中断分组与图层加载', async () => {
  const app = await readFile('panel/canvas/app.js', 'utf8');
  const source = app.slice(app.indexOf('function setProjectTitle('), app.indexOf('function message('));
  const document = { title: '', documentElement: { classList: { contains: () => true } } };
  runInNewContext(`${source}; setProjectTitle('测试项目');`, { $: () => null, document });
  expect(document.title).toBe('测试项目');
});
