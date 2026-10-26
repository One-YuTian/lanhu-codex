import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { nativeTransport } from '../panel/canvas-transport';
import { assignImage } from '../panel/canvas/transport.js';

async function manager(api) {
  const source = await readFile('panel/canvas/project-manager.js', 'utf8');
  const context = { api, generation: 1, team: 'team', root: { hidden: false }, projects: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    loadedFolders: new Set(), pendingFolders: new Set(), folderErrors: new Map(), render: vi.fn(), rememberCatalog: vi.fn() };
  const load = runInNewContext(`${source.slice(source.indexOf('async function loadFolder('), source.indexOf('async function loadTeam('))}; loadFolder;`, context);
  return { context, load };
}
it('文件夹项目不依赖全部项目的关联字段，合并时去重并缓存', async () => {
  const api = vi.fn(async () => ({ projects: [{ id: 'a', name: 'A' }] }));
  const { context, load } = await manager(api);
  await load('folder'); await load('folder');
  expect(api).toHaveBeenCalledOnce();
  expect(api).toHaveBeenCalledWith('projects', { team_id: 'team', folder_id: 'folder' });
  expect(context.projects).toEqual([{ id: 'b', name: 'B' }, { id: 'a', name: 'A', folder_id: 'folder' }]);
});
it('切换团队后丢弃旧文件夹的迟到结果', async () => {
  let resolve;
  const { context, load } = await manager(() => new Promise(done => { resolve = done; }));
  const pending = load('old'); context.generation++;
  resolve({ projects: [{ id: 'stale' }] }); await pending;
  expect(context.projects.map(project => project.id)).toEqual(['a', 'b']);
  expect(context.loadedFolders.size).toBe(0);
});
it('文件夹请求失败后可重试，空目录也能缓存', async () => {
  const api = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ projects: [] });
  const { context, load } = await manager(api);
  await load('folder'); expect(context.folderErrors.get('folder')).toContain('offline');
  await load('folder'); expect(context.folderErrors.size).toBe(0);
  expect(context.loadedFolders.has('folder')).toBe(true);
});
it('原生数据通道透传 folder_id', async () => {
  const callServerTool = vi.fn(async () => ({ content: [], _meta: { 'lanhu/response': { data: { projects: [] } } } }));
  await nativeTransport({ callServerTool, openLink: vi.fn() } as any).fetch('/api/projects?team_id=team&folder_id=folder');
  expect(callServerTool.mock.calls[0][0]).toEqual({ name: 'lanhu_canvas_request', arguments: { endpoint: 'projects', team_id: 'team', folder_id: 'folder' } });
});
it('项目封面使用纯占位加载，成功或失败均清除占位状态', async () => {
  for (const outcome of ['load', 'error']) {
    const listeners = new Map(), classes = new Set();
    const image = { hidden: false, loading: '', src: '', parentElement: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } },
      addEventListener: (event, callback) => listeners.set(event, callback) };
    await assignImage(image, '/fixture', { placeholder: true });
    expect(classes.has('manager-cover-loading')).toBe(true); expect(classes.has('image-loading')).toBe(false);
    listeners.get(outcome)(); expect(classes.size).toBe(0); expect(image.hidden).toBe(outcome === 'error');
  }
});
