import { mountProjectManager } from './project-manager.js';

export function mountProjectPicker({ dialog, root, api, getRoute, openProject, openDialog }) {
  let selected = null;
  const confirm = dialog.querySelector('#confirm-project');
  const manager = mountProjectManager({ root, api, openDialog, selectionMode: true, openProject: route => { dialog.close(); openProject(route); },
    onSelectionChange: route => { selected = route; confirm.disabled = !route; } });
  dialog.querySelector('#cancel-project').onclick = () => dialog.close();
  dialog.querySelector('#close-project-picker').onclick = () => dialog.close();
  dialog.querySelector('#import-project').onclick = openDialog;
  confirm.onclick = () => {
    if (!selected) return;
    const route = selected; dialog.close(); openProject(route);
  };
  dialog.addEventListener('close', () => { manager.cancel(); selected = null; confirm.disabled = true; });
  return {
    open() {
      if (dialog.open) return;
      selected = null; confirm.disabled = true; dialog.showModal();
      void manager.show(getRoute().team_id);
    },
    close() { if (dialog.open) dialog.close(); }
  };
}
