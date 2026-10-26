export function preparePanelLayout(root = document) {
  root.documentElement.classList.add('native-panel');
  const header = root.querySelector('.header'), toolbar = root.querySelector('.toolbar');
  if (!header || !toolbar) return;
  const divider = root.createElement('span'); divider.className = 'divider';
  toolbar.append(divider);
  for (const control of header.querySelectorAll('.header-actions > *')) if (control.id !== 'user-avatar') toolbar.append(control);
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '画布工具栏');
  header.remove();
}
