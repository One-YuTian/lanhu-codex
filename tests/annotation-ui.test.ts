import { afterEach, expect, it, vi } from 'vitest';
import { mountAnnotations } from '../panel/canvas/annotation-ui.js';
import { buildGroups } from '../panel/canvas/model.js';
import { configureTransport } from '../panel/canvas/transport.js';

class Element {
  children: Element[] = [];
  parentElement?: Element;
  className = '';
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners = new Map<string, Function[]>();
  style: Record<string, string> = {};
  textContent = '';
  value = '';
  hidden = false;
  disabled = false;
  clientWidth = 1000;
  clientHeight = 800;
  oninput?: () => void;
  constructor(public tagName = 'div') {}
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  addEventListener(name: string, callback: Function) { this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
  async fire(name: string, event: any = {}) { for (const callback of this.listeners.get(name) || []) await callback(event); }
  append(...children: Element[]) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  after(child: Element) { child.parentElement = this.parentElement; this.parentElement!.children.splice(this.parentElement!.children.indexOf(this) + 1, 0, child); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  replaceChildren(...children: Element[]) { this.children.forEach(child => { child.parentElement = undefined; }); this.children = []; this.append(...children); }
  matches(selector: string): boolean {
    return selector.startsWith('.') ? this.className.split(' ').includes(selector.slice(1))
      : selector.startsWith('[data-mode=') ? this.dataset.mode === selector.match(/"([^"]+)"/)?.[1] : this.tagName === selector;
  }
  closest(selector: string): Element | undefined { return selector.split(',').some(value => this.matches(value.trim())) ? this : this.parentElement?.closest(selector); }
  querySelectorAll(selector: string): Element[] {
    if (selector.includes(' ')) { const [parent, ...rest] = selector.split(' '); return this.querySelectorAll(parent).flatMap(child => child.querySelectorAll(rest.join(' '))); }
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0]; }
  contains(child: Element): boolean { return this === child || this.children.some(item => item.contains(child)); }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
  focus() {}
  blur() { for (const callback of this.listeners.get('blur') || []) callback({}); }
  setPointerCapture() {}
  hasPointerCapture() { return true; }
  releasePointerCapture() {}
}
afterEach(() => { vi.unstubAllGlobals(); configureTransport(undefined); });
function setup() {
  const document = new Element('document'); (document as any).createElement = (name: string) => new Element(name);
  vi.stubGlobal('document', document);
  const viewport = new Element(), toolbar = new Element(), hand = new Element('button');
  toolbar.className = 'toolbar'; hand.dataset.mode = 'hand'; toolbar.append(new Element('button'), hand); viewport.append(toolbar);
  const boards = [{ id: 'a', name: '首页', x: 100, y: 100, width: 100, height: 100 }, { id: 'b', name: '详情', x: 300, y: 100, width: 100, height: 100 }];
  const elements = boards.map(board => { const element = new Element(); element.className = 'board'; element.dataset.id = board.id; viewport.append(element); return element; });
  const context: any = { route: { project_id: 'p', team_id: 't' }, boards, groups: buildGroups([{ id: 'g', name: '玩法', images: ['a', 'b'] }], boards),
    filter: 'g', detail: null, layers: [], pan: { x: 0, y: 0 }, zoom: 1, mode: 'annotate', selected: new Set() };
  const clearSelection = vi.fn(() => context.selected.clear());
  const setMode = vi.fn();
  const mounted = mountAnnotations({ viewport, getContext: () => context, clearSelection, setMode, reveal: vi.fn(), toast: vi.fn() });
  mounted.render();
  const button = (root: Element, label: string) => root.querySelectorAll('button').find(item => item.attributes['aria-label'] === label || (item as any).title === label)!;
  const pointer = (target: Element, x: number, y: number, additive = false) => ({ target, clientX: x, clientY: y, pointerId: 1, button: 0, shiftKey: additive, preventDefault() {}, stopImmediatePropagation() {} });
  const click = async (index = 0, additive = false) => { const board = boards[index], event = pointer(elements[index], board.x + 20, board.y + 20, additive); await viewport.fire('pointerdown', event); await viewport.fire('pointerup', event); };
  const input = (text: string) => { const element = viewport.querySelector('textarea')!; element.value = text; element.oninput!(); };
  const list = async () => { await viewport.querySelector('.annotation-tools')!.fire('mouseenter'); return viewport.querySelector('.annotation-list')!; };
  return { viewport, context, mounted, button, pointer, click, input, list, document, clearSelection, setMode };
}
it('右键临时标注复用多选编辑、确认和提交逻辑，不切换工具或持续添加标注', async () => {
  const ui = setup(); ui.context.mode = 'select'; ui.context.selected = new Set(['a', 'b']);
  expect(ui.mounted.canAddForSelection()).toBe(true); ui.mounted.addForSelection();
  expect(ui.viewport.querySelector('.annotation-editor')!.querySelector('strong')!.textContent).toBe('1.首页、详情');
  ui.input('临时多选标注'); await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  expect(ui.context.mode).toBe('select'); expect(ui.setMode).not.toHaveBeenCalled();
  await ui.click(); expect(ui.viewport.querySelector('.annotation-editor')).toBeUndefined();
  const send = vi.fn(async () => {}); configureTransport({ appendDraft: send });
  const list = await ui.list(); await ui.button(list, '提交').fire('click');
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0][0][0].prompt).toContain('临时多选标注');
});
it('详情页临时标注使用已选图层，取消不会产生标注或改变抓手工具', async () => {
  const ui = setup(); ui.context.mode = 'hand'; ui.context.detail = ui.context.boards[0]; ui.context.route.image_id = 'a';
  ui.context.boards = [ui.context.detail];
  ui.context.layer = { id: 'chosen', name: '按钮', x: 10, y: 10, width: 30, height: 20 };
  ui.context.layers = [ui.context.layer]; ui.mounted.render(); ui.mounted.addForSelection();
  expect(ui.viewport.querySelector('.annotation-editor')!.querySelector('strong')!.textContent).toBe('1.按钮');
  ui.input('放弃'); await ui.button(ui.viewport.querySelector('.annotation-editor')!, '取消').fire('click');
  expect(ui.context.mode).toBe('hand'); expect(ui.setMode).not.toHaveBeenCalled();
  expect(ui.viewport.querySelector('.annotation-pins')!.children).toHaveLength(0);
});
it('没有选中项时不能临时添加，临时编辑内容点击外部按原逻辑确认', async () => {
  const ui = setup(); ui.context.mode = 'select';
  expect(ui.mounted.canAddForSelection()).toBe(false); ui.mounted.addForSelection();
  expect(ui.viewport.querySelector('.annotation-editor')).toBeUndefined();
  ui.context.selected = new Set(['a']); ui.mounted.addForSelection(); ui.input('保留内容');
  await ui.document.fire('pointerdown', ui.pointer(ui.viewport, 20, 20));
  expect(ui.viewport.querySelector('.annotation-editor')).toBeUndefined();
  expect((await ui.list()).querySelector('strong')!.textContent).toBe('全部标注（1）');
});
it('输入但未确认的标注不进列表，取消/关闭不保留，确认后才显示', async () => {
  const ui = setup();
  await ui.click(); ui.input('未确认');
  expect((await ui.list()).querySelector('strong')!.textContent).toBe('全部标注（0）');
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '取消').fire('click');
  expect(ui.viewport.querySelector('.annotation-editor')).toBeUndefined();
  expect(ui.viewport.querySelector('.annotation-pins')!.children).toHaveLength(0);
  await ui.click(); ui.input('已确认');
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  expect((await ui.list()).querySelector('strong')!.textContent).toBe('全部标注（1）');
  expect((await ui.list()).querySelector('.annotation-list-content')!.querySelector('strong')!.textContent).toBe('1.已确认');
  await ui.click(1); ui.input('放弃内容');
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '关闭标注弹窗').fire('click');
  expect((await ui.list()).querySelector('strong')!.textContent).toBe('全部标注（1）');
});
it('修改已确认标注时取消回滚，详情标注在分组可查看，切换视图不残留弹窗', async () => {
  const ui = setup(); await ui.click(); ui.input('原始内容');
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  await ui.viewport.querySelector('.annotation-pin')!.fire('click'); ui.input('取消修改');
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '取消').fire('click');
  expect((await ui.list()).querySelector('.annotation-list-content')!.querySelector('strong')!.textContent).toBe('1.原始内容');
  ui.context.detail = ui.context.boards[0]; ui.context.route.image_id = 'a'; ui.context.boards = [ui.context.detail]; ui.mounted.render();
  expect(ui.viewport.querySelector('.annotation-pins')!.children).toHaveLength(0);
  await ui.click(); ui.input('详情内容');
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  ui.context.detail = null; ui.context.route.image_id = ''; ui.mounted.render();
  expect(ui.viewport.querySelector('.annotation-pins')!.children).toHaveLength(2);
  expect(ui.viewport.querySelector('.annotation-pin')!.attributes['aria-label']).toBe('1.首页');
  await ui.viewport.querySelectorAll('.annotation-pin')[1].fire('click');
  expect(ui.viewport.querySelector('textarea')!.value).toBe('详情内容');
  expect(ui.context.detail).toBeNull();
  expect(ui.viewport.querySelector('.annotation-selection')!.children).toHaveLength(1);
});
it('框选与 Shift 多选支持单条标注，提交保留多个对象的路径与 ID', async () => {
  const ui = setup(), sender = vi.fn(async () => {}); configureTransport({ appendDraft: sender });
  await ui.viewport.fire('pointerdown', ui.pointer(ui.viewport, 50, 50));
  await ui.viewport.fire('pointermove', ui.pointer(ui.viewport, 450, 250));
  expect(ui.viewport.querySelector('.annotation-marquee')!.hidden).toBe(false);
  await ui.viewport.fire('pointerup', ui.pointer(ui.viewport, 450, 250));
  expect(ui.viewport.querySelector('.annotation-editor')!.querySelector('strong')!.textContent).toBe('1.首页、详情');
  expect(ui.viewport.querySelector('.annotation-selection')!.children).toHaveLength(3);
  ui.input('统一修改'); await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  await ui.button(await ui.list(), '提交').fire('click');
  expect(sender.mock.calls[0][0].map((item: any) => item.title)).toEqual(['首页页面：统一修改', '详情页面：统一修改']);
  expect(sender.mock.calls[0][0][0].prompt).toContain('imageid:a');
  expect(sender.mock.calls[0][0][1].prompt).toContain('imageid:b');
  await ui.click(0, true); ui.input('保留输入'); await ui.click(1, true);
  expect(ui.viewport.querySelector('textarea')!.value).toBe('保留输入');
  expect(ui.viewport.querySelector('.annotation-editor')!.querySelector('strong')!.textContent).toBe('1.首页、详情');
});
it('空白确认不创建标注，已选择多个画板时可直接添加合并标注', async () => {
  const ui = setup(); await ui.click(); ui.input('   ');
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  expect(ui.viewport.querySelector('.annotation-pins')!.children).toHaveLength(0);
  ui.context.selected = new Set(['a', 'b']); await ui.click();
  expect(ui.viewport.querySelector('.annotation-editor')!.querySelector('strong')!.textContent).toBe('1.首页、详情');
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  expect((await ui.list()).querySelector('strong')!.textContent).toBe('全部标注（0）');
});
it('框选与多选时先隐藏编辑器，框选实时高亮对象，释放多选键后恢复输入', async () => {
  const ui = setup(); await ui.click(); ui.input('保留输入');
  await ui.viewport.querySelector('textarea')!.fire('blur');
  await ui.document.fire('keydown', { key: 'Shift' });
  expect(ui.viewport.querySelector('.annotation-editor')!.hidden).toBe(true);
  await ui.click(1, true);
  expect(ui.viewport.querySelector('.annotation-editor')!.hidden).toBe(true);
  expect(ui.viewport.querySelector('.annotation-selection')!.children).toHaveLength(2);
  await ui.document.fire('keyup', { key: 'Shift', shiftKey: false });
  expect(ui.viewport.querySelector('.annotation-editor')!.hidden).toBe(false);
  expect(ui.viewport.querySelector('textarea')!.value).toBe('保留输入');
  await ui.viewport.fire('pointerdown', ui.pointer(ui.viewport, 50, 50));
  expect(ui.viewport.querySelector('.annotation-editor')!.hidden).toBe(true);
  await ui.viewport.fire('pointermove', ui.pointer(ui.viewport, 250, 250));
  expect(ui.viewport.querySelector('.annotation-selection')!.children).toHaveLength(1);
  await ui.viewport.fire('pointerup', ui.pointer(ui.viewport, 250, 250));
  expect(ui.viewport.querySelector('.annotation-editor')!.hidden).toBe(false);
  expect(ui.viewport.querySelector('textarea')!.value).toBe('保留输入');
});
it('悬浮列表清空按钮删除当前项目全部标注并重置序号', async () => {
  const ui = setup(); await ui.click(); ui.input('待清空');
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  await ui.button(await ui.list(), '清空').fire('click');
  expect(ui.viewport.querySelector('.annotation-pins')!.children).toHaveLength(0);
  expect((await ui.list()).querySelector('strong')!.textContent).toBe('全部标注（0）');
  await ui.click(); expect(ui.viewport.querySelector('.annotation-editor')!.querySelector('strong')!.textContent).toBe('1.首页');
});
it('多选名称默认折叠，只显示最终名称，不展示完整路径，展开不影响标注内容', async () => {
  const ui = setup();
  const extras = Array.from({ length: 4 }, (_, index) => ({ id: `extra-${index}`, name: `末级${index}`, x: 500 + index * 150, y: 100, width: 100, height: 100 }));
  ui.context.boards.push(...extras); ui.context.selected = new Set(ui.context.boards.map((board: any) => board.id));
  await ui.click();
  const names = ui.viewport.querySelector('.annotation-object-names')!;
  expect(names.children).toHaveLength(3);
  expect(names.children.map(item => item.querySelector('.annotation-tag-label')!.textContent)).toEqual(['首页', '详情', '末级0']);
  expect(ui.viewport.querySelector('.annotation-editor')!.querySelector('strong')!.textContent).toBe('1.首页、详情等 6 项');
  await ui.button(ui.viewport, '展开其余 3 项').fire('click'); expect(names.children).toHaveLength(6);
  await ui.button(ui.viewport, '收起').fire('click'); expect(names.children).toHaveLength(3);
});
it('在标注框输入时修饰键不会隐藏编辑器，离开输入框后才可隐藏', async () => {
  const ui = setup(); await ui.click(); ui.input('正在输入');
  await ui.document.fire('keydown', { key: 'Shift' });
  expect(ui.viewport.querySelector('.annotation-editor')!.hidden).toBe(false);
  ui.mounted.render(); expect(ui.viewport.querySelector('.annotation-editor')!.hidden).toBe(false);
  await ui.document.fire('keydown', { key: 'Control' });
  expect(ui.viewport.querySelector('.annotation-editor')!.hidden).toBe(false);
  await ui.viewport.querySelector('textarea')!.fire('blur');
  expect(ui.viewport.querySelector('.annotation-editor')!.hidden).toBe(true);
  await ui.document.fire('keyup', { key: 'Control' });
  expect(ui.viewport.querySelector('.annotation-editor')!.hidden).toBe(false);
});
it('删除多选标签同步减少选择框和提交目标，正文保留；单个目标不能误删为空', async () => {
  const ui = setup(), sender = vi.fn(async () => {}); configureTransport({ appendDraft: sender });
  ui.context.selected = new Set(['a', 'b']); await ui.click(); ui.input('页面描述');
  await ui.button(ui.viewport, '移除 首页').fire('click');
  expect(ui.viewport.querySelector('.annotation-selection')!.children).toHaveLength(1);
  expect(ui.viewport.querySelector('.annotation-objects')!.hidden).toBe(true);
  expect(ui.viewport.querySelector('textarea')!.value).toBe('页面描述');
  expect(ui.viewport.querySelector('.annotation-editor')!.querySelector('strong')!.textContent).toBe('1.详情');
  expect(ui.viewport.querySelector('.annotation-tag-remove')).toBeUndefined();
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  const list = await ui.list();
  expect(list.querySelector('.annotation-objects-toggle')).toBeUndefined();
  expect(list.querySelector('.annotation-tag-remove')).toBeUndefined();
  await ui.button(list, '提交').fire('click');
  expect(sender.mock.calls[0][0][0].title).toBe('详情页面：页面描述');
  expect(sender.mock.calls[0][0][0].prompt).toContain('imageid:b');
  expect(sender.mock.calls[0][0][0].prompt).not.toContain('imageid:a');
  expect(sender.mock.calls[0][0][0].prompt).toContain('页面描述');
});
it('单对象标记在编辑器和悬浮列表均隐藏 tag，多选标记仍显示', async () => {
  const ui = setup(); await ui.click();
  expect(ui.viewport.querySelector('.annotation-objects')!.hidden).toBe(true);
  expect(ui.viewport.querySelector('.annotation-object-name')).toBeUndefined();
  ui.input('单处内容'); await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  const list = await ui.list();
  expect(list.querySelector('.annotation-objects')!.hidden).toBe(true);
  expect(list.querySelector('.annotation-object-name')).toBeUndefined();
  ui.context.selected = new Set(['a', 'b']); await ui.click();
  expect(ui.viewport.querySelector('.annotation-editor')!.querySelector('.annotation-objects')!.hidden).toBe(false);
  expect(ui.viewport.querySelector('.annotation-editor')!.querySelectorAll('.annotation-object-name')).toHaveLength(2);
  ui.input('多选内容'); await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  expect((await ui.list()).querySelectorAll('.annotation-objects')[1].hidden).toBe(false);
});
it('悬浮列表多选内容裁切，不提供展开或删除对象操作；编辑器仍可展开', async () => {
  const ui = setup();
  ui.context.boards.push(...Array.from({ length: 4 }, (_, index) => ({ id: `many-${index}`, name: `目标${index}`, x: 500, y: 100, width: 100, height: 100 })));
  ui.context.selected = new Set(ui.context.boards.map((board: any) => board.id));
  await ui.click(); ui.input('说明'); await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  const list = await ui.list();
  expect(list.querySelector('.annotation-objects--compact')).toBeDefined();
  expect(list.querySelector('.annotation-objects-toggle')).toBeUndefined();
  expect(list.querySelector('.annotation-object-names')!.children).toHaveLength(3);
});
it('已有标注删除标签后取消会恢复原目标，确认后才更新目标', async () => {
  const ui = setup(); ui.context.selected = new Set(['a', 'b']); await ui.click(); ui.input('内容');
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  await ui.viewport.querySelector('.annotation-pin')!.fire('click');
  await ui.button(ui.viewport, '移除 首页').fire('click');
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '取消').fire('click');
  expect(ui.viewport.querySelector('.annotation-pin')!.attributes['aria-label']).toBe('1.首页、详情');
  await ui.viewport.querySelector('.annotation-pin')!.fire('click');
  await ui.button(ui.viewport, '移除 首页').fire('click');
  await ui.button(ui.viewport.querySelector('.annotation-editor')!, '确认').fire('click');
  expect(ui.viewport.querySelector('.annotation-pin')!.attributes['aria-label']).toBe('1.详情');
});
it('空白单击和未命中对象的框选不创建标注，无画板时禁用工具', async () => {
  const ui = setup();
  const event = ui.pointer(ui.viewport, 20, 20);
  await ui.viewport.fire('pointerdown', event); await ui.viewport.fire('pointerup', event);
  expect(ui.viewport.querySelector('.annotation-editor')).toBeUndefined();
  await ui.viewport.fire('pointerdown', event);
  await ui.viewport.fire('pointermove', ui.pointer(ui.viewport, 60, 60));
  await ui.viewport.fire('pointerup', ui.pointer(ui.viewport, 60, 60));
  expect(ui.viewport.querySelector('.annotation-editor')).toBeUndefined();
  expect(ui.viewport.querySelector('.annotation-pins')!.children).toHaveLength(0);
  ui.context.boards = []; ui.mounted.render();
  expect(ui.button(ui.viewport, '添加标注').disabled).toBe(true);
});
it('单选或批量框选后空白点击取消空标注，并清除已选对象', async () => {
  const ui = setup(); await ui.click();
  const blank = ui.pointer(ui.viewport, 20, 20);
  await ui.viewport.fire('pointerdown', blank); await ui.viewport.fire('pointerup', blank);
  expect(ui.viewport.querySelector('.annotation-editor')).toBeUndefined();
  expect(ui.viewport.querySelector('.annotation-pins')!.children).toHaveLength(0);
  ui.context.selected = new Set(['a', 'b']); await ui.click();
  await ui.viewport.fire('pointerdown', blank); await ui.viewport.fire('pointerup', blank);
  expect(ui.context.selected.size).toBe(0); expect(ui.clearSelection).toHaveBeenCalledTimes(2);
  expect(ui.viewport.querySelector('.annotation-selection')!.children).toHaveLength(0);
  expect((await ui.list()).querySelector('strong')!.textContent).toBe('全部标注（0）');
});
it('已输入内容后空白点击自动确认，空格输入仍视为取消，不重复创建记录', async () => {
  const ui = setup(); await ui.click(); ui.input('保留这条标注');
  const blank = ui.pointer(ui.viewport, 20, 20);
  await ui.viewport.fire('pointerdown', blank); await ui.viewport.fire('pointerup', blank);
  expect(ui.viewport.querySelector('.annotation-editor')).toBeUndefined();
  expect((await ui.list()).querySelector('strong')!.textContent).toBe('全部标注（1）');
  await ui.viewport.fire('pointerdown', blank); await ui.viewport.fire('pointerup', blank);
  expect((await ui.list()).querySelector('strong')!.textContent).toBe('全部标注（1）');
  await ui.click(); ui.input('   ');
  await ui.viewport.fire('pointerdown', blank); await ui.viewport.fire('pointerup', blank);
  expect((await ui.list()).querySelector('strong')!.textContent).toBe('全部标注（1）');
});
