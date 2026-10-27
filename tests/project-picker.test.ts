import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const state = vi.hoisted(() => ({ options: null as any, show: vi.fn(), cancel: vi.fn() }));
vi.mock('../panel/canvas/project-manager.js', () => ({ mountProjectManager: options => { state.options = options; return { show: state.show, cancel: state.cancel }; } }));
import { mountProjectPicker } from '../panel/canvas/project-picker.js';
afterEach(() => vi.clearAllMocks());
function fixture() {
  const buttons = Object.fromEntries(['confirm-project', 'cancel-project', 'close-project-picker', 'import-project'].map(id => [id, { disabled: false, onclick: null as any }]));
  let closed;
  const dialog = { open: false, querySelector: selector => buttons[selector.slice(1)], addEventListener: (_, callback) => { closed = callback; },
    showModal() { this.open = true; }, close() { this.open = false; closed(); } };
  const openProject = vi.fn(), openDialog = vi.fn();
  const picker = mountProjectPicker({ dialog, root: {}, api: vi.fn(), getRoute: () => ({ team_id: 'team' }), openProject, openDialog });
  return { buttons, dialog, picker, openProject, openDialog };
}
it('选中项目后必须确认才切换，取消不改变项目', () => {
  const f = fixture(); f.picker.open();
  expect(state.show).toHaveBeenCalledWith('team');
  expect(f.buttons['confirm-project'].disabled).toBe(true);
  state.options.onSelectionChange({ project_id: 'next', team_id: 'team' });
  expect(f.openProject).not.toHaveBeenCalled();
  f.buttons['cancel-project'].onclick();
  expect(f.openProject).not.toHaveBeenCalled(); expect(state.cancel).toHaveBeenCalledOnce();
  f.picker.open(); expect(f.buttons['confirm-project'].disabled).toBe(true);
  const route = { project_id: 'next', team_id: 'team' };
  state.options.onSelectionChange(route); f.buttons['confirm-project'].onclick();
  expect(f.openProject).toHaveBeenCalledWith(route); expect(f.dialog.open).toBe(false);
});
it('链接导入入口打开导入窗，关闭选择窗会停止请求且清空选择', () => {
  const f = fixture(); f.picker.open(); f.buttons['import-project'].onclick();
  expect(f.openDialog).toHaveBeenCalledOnce();
  f.picker.close(); expect(state.cancel).toHaveBeenCalledOnce();
  expect(f.buttons['confirm-project'].disabled).toBe(true);
});
it('项目树与卡片在选择模式下只更新选择，不立即导航', async () => {
  const source = await readFile('panel/canvas/project-manager.js', 'utf8');
  const context = { team: 'team', selectionMode: true, selectedRoute: null, onSelectionChange: vi.fn(), openProject: vi.fn(), render: vi.fn(), updateProjectSelection: vi.fn() };
  runInNewContext(`${source.slice(source.indexOf('function chooseProject('), source.indexOf('function render('))}; chooseProject({ id: 'chosen' });`, context);
  expect(context.onSelectionChange).toHaveBeenCalledWith({ project_id: 'chosen', team_id: 'team' });
  expect(context.openProject).not.toHaveBeenCalled();
  expect(context.render).not.toHaveBeenCalled(); // Keep the card node for the second click of a double click.
});
it('主页单击树中子项目，选中父目录并切换右侧列表', async () => {
  const source = await readFile('panel/canvas/project-manager.js', 'utf8');
  const context = { team: 'team', selectionMode: false, folder: '', expanded: new Set(), search: { value: 'old' }, selectedRoute: null,
    onSelectionChange: vi.fn(), openProject: vi.fn(), render: vi.fn(), updateProjectSelection: vi.fn() };
  runInNewContext(`${source.slice(source.indexOf('function chooseProject('), source.indexOf('function placeholder('))}; chooseProject({ id: 'chosen', folder_id: 'parent' }, true);`, context);
  expect(context.folder).toBe('parent'); expect(context.expanded.has('parent')).toBe(true);
  expect(context.selectedRoute).toEqual({ project_id: 'chosen', team_id: 'team' });
  expect(context.search.value).toBe(''); expect(context.render).toHaveBeenCalledOnce(); expect(context.openProject).not.toHaveBeenCalled();
});
it('弹窗中双击项目直接关闭弹窗并打开该项目', () => {
  const f = fixture(); f.picker.open();
  state.options.openProject({ project_id: 'double-clicked', team_id: 'team' });
  expect(f.dialog.open).toBe(false);
  expect(f.openProject).toHaveBeenCalledWith({ project_id: 'double-clicked', team_id: 'team' });
});

it('选中具体项目时清除分类和文件夹高亮，取消项目选择后恢复当前分类', async () => {
 const source=await readFile('panel/canvas/project-manager.js','utf8');
 const make=(dataset:any)=>{const classes=new Set<string>();return {dataset,classes,classList:{toggle:(name:string,on:boolean)=>on?classes.add(name):classes.delete(name)},setAttribute:vi.fn()}};
 const project=make({projectId:'chosen'}),category=make({view:'all'}),folder=make({folderId:'parent'});
 category.classes.add('active');
 const context={team:'team',view:'all',folder:'',selectedRoute:{project_id:'chosen',team_id:'team'},root:{querySelectorAll:()=>[project]},nav:{querySelectorAll:(selector:string)=>selector==='.manager-category'?[category]:[folder]}};
 const update=runInNewContext(`${source.slice(source.indexOf('function updateProjectSelection('),source.indexOf('function chooseProject('))};updateProjectSelection;`,context);
 update();expect(project.classes.has('selected')).toBe(true);expect(category.classes.has('active')).toBe(false);expect(folder.classes.has('active')).toBe(false);
 context.selectedRoute=null as any;update();expect(project.classes.has('selected')).toBe(false);expect(category.classes.has('active')).toBe(true);
});
