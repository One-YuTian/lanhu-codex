import { expect, it, vi } from 'vitest';
import { installInterfaceEvents } from '../panel/canvas/interface-events.js';
function fixture() {
  const listeners = new Map<string, any>(), hostEvents = new Map<string, any>();
  const root = { visibilityState: 'visible', addEventListener: (name, handler) => listeners.set(name, handler) };
  const setSpace = vi.fn(), cancelDrag = vi.fn();
  installInterfaceEvents(root, { addEventListener: (name, handler) => hostEvents.set(name, handler) }, { enabled: () => true, setSpace, cancelDrag });
  const event = (editable = false) => ({ code: 'Space', target: { closest: selector => editable && selector.includes('input') ? {} : null }, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
  return { listeners, hostEvents, root, setSpace, cancelDrag, event };
}
it('非输入区域含工具栏按钮支持临时空格抓手，松开或失焦恢复', () => {
  const f = fixture(), event = f.event(); f.listeners.get('keydown')(event);
  expect(f.setSpace).toHaveBeenLastCalledWith(true); expect(event.preventDefault).toHaveBeenCalled();
  f.listeners.get('keyup')(event); expect(f.setSpace).toHaveBeenLastCalledWith(false); expect(f.cancelDrag).toHaveBeenCalled();
  f.hostEvents.get('blur')(); expect(f.setSpace).toHaveBeenLastCalledWith(false);
});
it('输入区域保留空格与原生选择，其他区域禁用默认选择和拖放，右键默认菜单全局禁用', () => {
  const f = fixture(); const input = f.event(true), plain = f.event();
  f.listeners.get('keydown')(input); expect(input.preventDefault).not.toHaveBeenCalled();
  for (const name of ['selectstart', 'dragstart']) { f.listeners.get(name)(input); f.listeners.get(name)(plain); }
  expect(input.preventDefault).not.toHaveBeenCalled(); expect(plain.preventDefault).toHaveBeenCalledTimes(2);
  f.listeners.get('contextmenu')(input); expect(input.preventDefault).toHaveBeenCalledOnce();
});
