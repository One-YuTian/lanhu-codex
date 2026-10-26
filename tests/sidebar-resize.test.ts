import { afterEach, expect, it, vi } from 'vitest';
import { installSidebarResize } from '../panel/canvas/sidebar-resize.js';

afterEach(() => vi.unstubAllGlobals());
function fixture(readWidth = async () => 320) {
  const events = new Map<string, Function>(), attributes = new Map<string, string>(), style = new Map<string, string>();
  let captured = false;
  const handle = { className: '', tabIndex: 0, setAttribute: (key: string, value: string) => attributes.set(key, value),
    addEventListener: (key: string, fn: Function) => events.set(key, fn), setPointerCapture: () => { captured = true; },
    hasPointerCapture: () => captured, releasePointerCapture: () => { captured = false; } };
  const window = { innerWidth: 1280, addEventListener: vi.fn() };
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', { createElement: () => handle, documentElement: { classList: { add() {}, remove() {} } } });
  const sidebar = { append: vi.fn(), style: { setProperty: (key: string, value: string) => style.set(key, value) },
    getBoundingClientRect: () => ({ width: Number.parseFloat(style.get('--sidebar-width') || '240') }) };
  const saveWidth = vi.fn(async () => {}), onChange = vi.fn();
  installSidebarResize({ sidebar, readWidth, saveWidth, onChange });
  const fire = (name: string, details = {}) => events.get(name)!({ button: 0, pointerId: 1, clientX: 320, preventDefault() {}, stopPropagation() {}, ...details });
  return { fire, style, attributes, saveWidth, window };
}
it('恢复宽度，拖动限制在 200–480px，只在松开时保存，支持键盘调整', async () => {
  const f = fixture(); await vi.waitFor(() => expect(f.style.get('--sidebar-width')).toBe('320px'));
  f.fire('pointerdown'); f.fire('pointermove', { clientX: 1000 });
  expect(f.style.get('--sidebar-width')).toBe('480px'); expect(f.saveWidth).not.toHaveBeenCalled();
  f.fire('pointerup'); await vi.waitFor(() => expect(f.saveWidth).toHaveBeenCalledWith(480));
  f.fire('keydown', { key: 'Home' }); await vi.waitFor(() => expect(f.saveWidth).toHaveBeenCalledWith(200));
  expect(f.attributes.get('aria-valuenow')).toBe('200');
});
it('迟到的恢复请求不覆盖已经拖动的宽度，窄窗口保留画布空间', async () => {
  let restore!: (width: number) => void;
  const f = fixture(() => new Promise(resolve => { restore = resolve; }));
  await vi.waitFor(() => expect(restore).toBeTypeOf('function'));
  f.window.innerWidth = 425;
  f.fire('pointerdown', { clientX: 240 }); f.fire('pointermove', { clientX: 700 }); f.fire('pointerup');
  restore(480); await vi.waitFor(() => expect(f.saveWidth).toHaveBeenCalledWith(265));
  expect(f.style.get('--sidebar-width')).toBe('265px');
});
