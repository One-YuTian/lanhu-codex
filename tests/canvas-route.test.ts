import { expect, it, vi } from 'vitest';
import { createCanvasRouteHandler } from '../panel/canvas-route';
import { parseRoute } from '../panel/canvas/model.js';

const globalResult = { _meta: { 'lanhu/route': {} } };
it('首次 global 打开管理页，再次打开恢复最新项目，包括复用的面板', async () => {
  let saved: unknown = null;
  const apply = vi.fn();
  const handler = createCanvasRouteHandler(async () => saved, apply);
  await handler(globalResult);
  expect(apply).toHaveBeenLastCalledWith('');
  saved = { project_id: 'project-a', team_id: 'team' };
  await handler(globalResult);
  expect(parseRoute(apply.mock.lastCall![0]).project_id).toBe('project-a');
  saved = { project_id: 'project-b', team_id: 'team' };
  await handler(globalResult);
  expect(parseRoute(apply.mock.lastCall![0]).project_id).toBe('project-b');
});
it('显式项目优先，旧的异步记忆读取不能覆盖新的打开请求', async () => {
  let resolve!: (value: unknown) => void;
  const recall = vi.fn(() => new Promise(done => { resolve = done; }));
  const apply = vi.fn(), handler = createCanvasRouteHandler(recall, apply);
  const pending = handler(globalResult);
  await handler({ _meta: { 'lanhu/route': { project_id: 'explicit' } } });
  resolve({ project_id: 'old' }); await pending;
  expect(apply).toHaveBeenCalledTimes(1);
  expect(parseRoute(apply.mock.lastCall![0]).project_id).toBe('explicit');
});
it('记忆读取失败仍能打开管理页，无关或无效结果不改变当前页面', async () => {
  const apply = vi.fn(), handler = createCanvasRouteHandler(async () => { throw new Error('unavailable'); }, apply);
  await handler(globalResult);
  expect(apply).toHaveBeenCalledWith(''); apply.mockClear();
  for (const value of [[], { project_id: '../bad' }, { team_id: 'team' }, { unexpected: 'value' }]) await handler({ _meta: { 'lanhu/route': value } });
  await handler({}); expect(apply).not.toHaveBeenCalled();
});
