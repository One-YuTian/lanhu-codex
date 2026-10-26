export const MIN_SIDEBAR_WIDTH = 200, MAX_SIDEBAR_WIDTH = 480, DEFAULT_SIDEBAR_WIDTH = 240;
export function sidebarWidth(value) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Number.isFinite(value) ? Math.round(value) : DEFAULT_SIDEBAR_WIDTH));
}

export function installSidebarResize({ sidebar, readWidth, saveWidth, onChange = () => {}, onError = () => {} }) {
  const handle = document.createElement('div'); handle.className = 'sidebar-resize-handle';
  handle.tabIndex = 0; handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', '调整项目面板宽度'); sidebar.append(handle);
  let preferred = DEFAULT_SIDEBAR_WIDTH, touched = false, drag;
  const maximum = () => Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 160));
  const apply = () => {
    const width = Math.min(preferred, maximum());
    sidebar.style.setProperty('--sidebar-width', `${width}px`);
    handle.setAttribute('aria-valuemin', String(MIN_SIDEBAR_WIDTH));
    handle.setAttribute('aria-valuemax', String(maximum()));
    handle.setAttribute('aria-valuenow', String(width));
    onChange();
  };
  const persist = () => { void Promise.resolve().then(() => saveWidth(preferred)).catch(onError); };
  const finish = event => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = undefined; document.documentElement.classList.remove('sidebar-resizing');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    persist();
  };
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); touched = true;
    drag = { id: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width };
    handle.setPointerCapture(event.pointerId); document.documentElement.classList.add('sidebar-resizing');
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    preferred = Math.min(sidebarWidth(drag.width + event.clientX - drag.x), maximum()); apply();
  });
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  handle.addEventListener('keydown', event => {
    const next = { ArrowLeft: preferred - 16, ArrowRight: preferred + 16, Home: MIN_SIDEBAR_WIDTH, End: maximum() }[event.key];
    if (next === undefined) return;
    event.preventDefault(); event.stopPropagation(); touched = true;
    preferred = Math.min(sidebarWidth(next), maximum()); apply(); persist();
  });
  window.addEventListener('resize', apply);
  apply();
  void Promise.resolve().then(readWidth).then(value => {
    if (!touched && typeof value === 'number' && Number.isFinite(value)) { preferred = sidebarWidth(value); apply(); }
  }).catch(() => {});
  return handle;
}
