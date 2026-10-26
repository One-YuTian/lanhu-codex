import { expect, it, vi } from 'vitest';
import { createClipboardDetector } from '../panel/canvas/clipboard-project.js';
import { extractLanhuLinks, localLanhuRoute, firstProjectGroup } from '../panel/canvas/lanhu-links.js';
import { clipboardLinks } from '../src/canvas-clipboard';

const direct = 'https://lanhuapp.com/web/#/item/project/stage?pid=project&tid=team';
const short = 'https://lanhuapp.com/link/#/invite?sid=lX0dBUHa';
function fixture(choice = false) {
  const stored = new Set<string>();
  const options = { resolve: vi.fn(async () => ({ project_id: 'project', team_id: 'team' })), inspect: vi.fn(async () => ({ id: 'project', name: '项目' })),
    known: vi.fn(() => null), ask: vi.fn(async () => choice), open: vi.fn(), seen: async () => [...stored], mark: vi.fn(async key => { stored.add(key); }), hash: async text => `hash:${text}` };
  return { options, stored, check: createClipboardDetector(options) };
}
it('从混合文本、Markdown、NBSP 和中文标点中提取蓝湖链接并去重', () => {
  expect(extractLanhuLinks(`分享：[${short}\u00a0](${short})，请打开。${direct}）尾部文本`)).toEqual([short, direct]);
  expect(extractLanhuLinks(`lanhuapp.com/web/?pid=p. https://evil.lanhuapp.com/?pid=x https://lanhuapp.com.evil/x user@lanhuapp.com`)).toEqual(['https://lanhuapp.com/web/?pid=p']);
  expect(localLanhuRoute(direct)).toEqual({ project_id: 'project', team_id: 'team' });
  expect(localLanhuRoute('https://evil.test/?redirect=' + direct)).toBeNull();
  expect(localLanhuRoute(short)).toBeNull();
});
it.each([true, false])('已确认或拒绝的链接持久去重，重新创建检测器也不再弹窗（%s）', async choice => {
  const f = fixture(choice); await f.check(direct); await f.check(direct);
  await createClipboardDetector(f.options)(short); // Resolved project is the same, so aliases are suppressed too.
  expect(f.options.ask).toHaveBeenCalledTimes(1);
  expect(f.options.open).toHaveBeenCalledTimes(choice ? 1 : 0);
  expect(f.options.resolve).toHaveBeenCalledTimes(1); // Direct URL was parsed locally.
});
it('解析不到项目或无权限时静默；当前列表中已有项目时允许提示', async () => {
  const f = fixture(); f.options.resolve.mockResolvedValue(null as any); await f.check(short);
  expect(f.options.ask).not.toHaveBeenCalled();
  f.options.inspect.mockRejectedValue(new Error('ACCESS_DENIED')); await f.check(direct);
  expect(f.options.ask).not.toHaveBeenCalled();
  const other = fixture(); other.options.inspect.mockRejectedValue(new Error('ACCESS_DENIED'));
  other.options.known.mockReturnValue({ id: 'project', name: '已加载项目' } as any);
  await other.check(direct); expect(other.options.ask).toHaveBeenCalledOnce();
});
it('并发检测不会重复弹窗，读写失败不会打扰用户', async () => {
  const f = fixture(); let finish;
  f.options.ask.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.check(direct);
  await vi.waitFor(() => expect(f.options.ask).toHaveBeenCalledOnce());
  await f.check(direct); finish(false); await pending;
  expect(f.options.ask).toHaveBeenCalledOnce();
  const other = fixture(); other.options.mark.mockRejectedValue(new Error('storage unavailable'));
  await other.check(direct); expect(other.options.ask).not.toHaveBeenCalled();
});
it('默认选择第一个分组，保留有效历史选择，失效历史回退，空项目选择未分组', () => {
  const groups = { byId: new Map([['a', {}], ['b', {}]]), roots: [{ id: 'a' }, { id: 'b' }] };
  expect(firstProjectGroup(groups, null)).toBe('a'); expect(firstProjectGroup(groups, 'b')).toBe('b');
  expect(firstProjectGroup(groups, 'deleted')).toBe('a'); expect(firstProjectGroup({ byId: new Map(), roots: [] }, null)).toBe('ungrouped');
});
it('原生剪贴板只返回蓝湖链接，不返回其他剪贴板内容，读取进程隐藏且有超时', async () => {
  const run = vi.fn(async () => ({ stdout: `unrelated-private-content\n${short}` }));
  expect(await clipboardLinks('win32', run as any)).toEqual([short]);
  expect(run.mock.calls[0][2]).toMatchObject({ windowsHide: true, timeout: 3000, maxBuffer: 65536 });
  expect(await clipboardLinks('win32', vi.fn(async () => { throw new Error('denied'); }) as any)).toEqual([]);
});
