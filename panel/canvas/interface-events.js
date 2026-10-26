export function isTextInput(target) {
  return !!target?.closest?.('input,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
}
export function installInterfaceEvents(root, host, { enabled, setSpace, cancelDrag }) {
  const release = () => { setSpace(false); cancelDrag(); };
  root.addEventListener('keydown', event => {
    if (event.code !== 'Space' || !enabled() || isTextInput(event.target) || event.target.closest('dialog[open],select,lh-select,lh-checkbox')) return;
    event.preventDefault(); event.stopImmediatePropagation(); setSpace(true);
  }, true);
  root.addEventListener('keyup', event => { if (event.code === 'Space') release(); }, true);
  host.addEventListener('blur', release);
  root.addEventListener('visibilitychange', () => { if (root.visibilityState === 'hidden') release(); });
  root.addEventListener('contextmenu', event => event.preventDefault(), true);
  root.addEventListener('selectstart', event => { if (!isTextInput(event.target)) event.preventDefault(); });
  root.addEventListener('dragstart', event => { if (!isTextInput(event.target)) event.preventDefault(); });
}
