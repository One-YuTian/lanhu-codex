import { createButton } from './ui/components.js';

export function promptCookie(saveCookie) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'ui-dialog login-cookie-dialog';
    const heading = document.createElement('h2'); heading.textContent = '填写蓝湖 Cookie';
    const description = document.createElement('p'); description.textContent = '填写 lanhuapp.com 的 Cookie Header，校验成功后将保存到蓝湖 MCP，并结束原登录流程。';
    const form = document.createElement('form'); form.noValidate = true;
    const field = document.createElement('input'); field.type = 'password'; field.autocomplete = 'off'; field.spellcheck = false;
    field.placeholder = 'user_token=…; 其他Cookie=…'; field.setAttribute('aria-label', '蓝湖 Cookie');
    const error = document.createElement('p'); error.className = 'error'; error.setAttribute('role', 'alert');
    const footer = document.createElement('footer');
    const cancel = createButton({ label: '取消', onClick: () => dialog.close() });
    const submit = createButton({ label: '保存并校验', variant: 'primary', type: 'submit' });
    footer.append(cancel, submit); form.append(field, error, footer); dialog.append(heading, description, form); document.body.append(dialog);
    let saving = false, saved = false;
    form.onsubmit = async event => {
      event.preventDefault(); if (saving) return;
      if (!field.value.trim()) { error.textContent = '请输入 Cookie'; return; }
      saving = true; cancel.disabled = submit.disabled = field.disabled = true; error.textContent = ''; submit.textContent = '正在校验…';
      try { await saveCookie(field.value.trim()); saved = true; field.value = ''; dialog.close(); }
      catch { error.textContent = 'Cookie 未通过校验或保存失败，请检查 Cookie 和网络后重试。'; }
      finally { saving = false; cancel.disabled = submit.disabled = field.disabled = false; submit.textContent = '保存并校验'; }
    };
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => { field.value = ''; dialog.remove(); resolve(saved); }, { once: true });
    dialog.showModal(); field.focus();
  });
}
