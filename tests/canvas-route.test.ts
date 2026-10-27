import { expect, it, vi } from 'vitest';
import { createCanvasRouteHandler } from '../panel/canvas-route';
import { parseRoute } from '../panel/canvas/model.js';
it('无参数打开不清空当前项目，显式项目仍可直接打开', () => {
  const apply = vi.fn(), handler = createCanvasRouteHandler(apply);
  handler({ _meta: { 'lanhu/route': { project_id: 'explicit', team_id: 'team' } } });
  expect(parseRoute(apply.mock.lastCall![0]).project_id).toBe('explicit');
  handler({ _meta: { 'lanhu/route': {} } });
  expect(apply).toHaveBeenCalledTimes(1);
  expect(parseRoute(apply.mock.lastCall![0]).project_id).toBe('explicit');
});
it('无效路由不改变当前页面', () => {
  const apply = vi.fn(), handler = createCanvasRouteHandler(apply);
  for (const value of [[], { project_id: '../bad' }, { team_id: 'team' }, { unexpected: 'value' }]) handler({ _meta: { 'lanhu/route': value } });
  handler({}); expect(apply).not.toHaveBeenCalled();
});
