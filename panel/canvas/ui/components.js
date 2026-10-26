import { icon } from '../icons.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

export function createButton({ label = '', iconName, className = '', variant = 'ghost', title = label, onClick, type = 'button' } = {}) {
  const button = document.createElement('button');
  button.type = type; button.className = `ui-button ui-button--${variant} ${className}`.trim();
  button.title = title;
  if (label) button.setAttribute('aria-label', label);
  if (iconName) button.innerHTML = icon(iconName);
  else button.textContent = label;
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

export function copyField(label, value) {
  return `<span class="style-value ui-copy-field" role="button" tabindex="0" aria-label="${escapeHtml(label)}" aria-description="${escapeHtml(value)}" title="点击复制" data-copy-value="${escapeHtml(value)}">${escapeHtml(value)}</span>`;
}
export function buttonMarkup({ id, label, className = '', variant = 'ghost', disabled = false }) {
  return `<button type="button" id="${escapeHtml(id)}" class="ui-button ui-button--${escapeHtml(variant)} ${escapeHtml(className)}"${disabled ? ' disabled' : ''}>${escapeHtml(label)}</button>`;
}

export function selectMarkup({ id, label, value, options }) {
  return `<lh-select id="${escapeHtml(id)}" label="${escapeHtml(label)}" value="${escapeHtml(value)}" options="${escapeHtml(JSON.stringify(options))}"></lh-select>`;
}

export function checkboxMarkup({ name, value, checked, label, description }) {
  return `<lh-checkbox name="${escapeHtml(name)}" value="${escapeHtml(value)}" label="${escapeHtml(label)}" description="${escapeHtml(description)}"${checked ? ' checked' : ''}></lh-checkbox>`;
}

export function installComponents(documentRoot = document) {
  if (!customElements.get('lh-select')) {
    let nextId = 0;
    class Select extends HTMLElement {
      get value() { return this.getAttribute('value') || ''; }
      set value(value) { this.setAttribute('value', value); if (this.trigger) this.update(); }
      connectedCallback() {
        this.options = JSON.parse(this.getAttribute('options') || '[]');
        this.activeIndex = Math.max(0, this.options.findIndex(option => option.value === this.value));
        const listId = `ui-select-list-${++nextId}`;
        this.trigger = createButton({ className: 'ui-select-trigger', label: this.getAttribute('label') || '', onClick: () => this.setOpen(this.menu.hidden) });
        this.trigger.setAttribute('aria-haspopup', 'listbox'); this.trigger.setAttribute('aria-controls', listId);
        this.menu = document.createElement('div'); this.menu.id = listId; this.menu.className = 'ui-select-menu'; this.menu.role = 'listbox'; this.menu.hidden = true;
        this.menu.setAttribute('aria-label', this.getAttribute('label') || '');
        this.options.forEach((option, index) => {
          const button = createButton({ label: option.label, className: 'ui-select-option', onClick: () => this.choose(index) });
          button.role = 'option'; button.tabIndex = -1; this.menu.append(button);
        });
        this.replaceChildren(this.trigger, this.menu); this.update(); this.setOpen(false);
        this.onkeydown = event => {
          if (event.key === 'Escape') { event.preventDefault(); this.setOpen(false); this.trigger.focus(); return; }
          if (event.key === 'Tab') { this.setOpen(false); return; }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); this.setOpen(true);
            this.activeIndex = event.key === 'Home' ? 0 : event.key === 'End' ? this.options.length - 1 : (this.activeIndex + (event.key === 'ArrowUp' ? -1 : 1) + this.options.length) % this.options.length;
            this.menu.children[this.activeIndex]?.focus();
          }
        };
        this.outside = event => { if (!this.contains(event.target)) this.setOpen(false); };
        document.addEventListener('pointerdown', this.outside);
      }
      disconnectedCallback() { document.removeEventListener('pointerdown', this.outside); }
      update() {
        const selected = this.options.find(option => option.value === this.value) || this.options[0];
        this.trigger.innerHTML = `<span>${escapeHtml(selected?.label || '')}</span>${icon('chevron-down')}`;
        [...this.menu.children].forEach((button, index) => button.setAttribute('aria-selected', String(this.options[index].value === this.value)));
      }
      setOpen(open) { this.menu.hidden = !open; this.trigger.setAttribute('aria-expanded', String(open)); }
      choose(index) { this.activeIndex = index; this.value = this.options[index].value; this.setOpen(false); this.trigger.focus(); this.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    customElements.define('lh-select', Select);
  }
  if (!customElements.get('lh-checkbox')) {
    class Checkbox extends HTMLElement {
      get value() { return this.getAttribute('value') || ''; }
      get checked() { return this.hasAttribute('checked'); }
      set checked(value) { this.toggleAttribute('checked', !!value); this.update(); }
      connectedCallback() {
        this.button = createButton({ className: 'ui-checkbox-row', onClick: () => { this.checked = !this.checked; this.dispatchEvent(new Event('change', { bubbles: true })); } });
        this.button.role = 'checkbox';
        this.button.setAttribute('aria-label', `${this.getAttribute('label') || ''} ${this.getAttribute('description') || ''}`.trim());
        this.button.innerHTML = `<span class="ui-checkbox-box">${icon('check')}</span><span>${escapeHtml(this.getAttribute('label'))}</span><small>${escapeHtml(this.getAttribute('description'))}</small>`;
        this.replaceChildren(this.button); this.update();
      }
      update() { this.button?.setAttribute('aria-checked', String(this.checked)); }
    }
    customElements.define('lh-checkbox', Checkbox);
  }
  const enhance = root => {
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    const elements = [...(root.matches?.('button,input,dialog') ? [root] : []), ...root.querySelectorAll('button,input,dialog')];
    elements.forEach(element => element.classList.add(element.tagName === 'BUTTON' ? 'ui-button' : element.tagName === 'DIALOG' ? 'ui-dialog' : 'ui-input'));
  };
  enhance(documentRoot);
  const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(enhance)));
  observer.observe(documentRoot.body || documentRoot, { childList: true, subtree: true });
  return () => observer.disconnect();
}

export function promptNumber({ title, value, min, max }) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'ui-dialog ui-number-dialog';
    const heading = document.createElement('h2'); heading.textContent = title;
    const form = document.createElement('form'), field = document.createElement('input');
    field.className = 'ui-input'; field.type = 'number'; field.value = value; field.min = min; field.max = max; field.setAttribute('aria-label', title);
    const error = document.createElement('p'); error.className = 'error'; error.setAttribute('role', 'alert');
    const footer = document.createElement('footer');
    footer.append(createButton({ label: '取消', onClick: () => dialog.close() }), createButton({ label: '确定', variant: 'primary', type: 'submit' }));
    form.noValidate = true; form.append(field, error, footer); dialog.append(heading, form); document.body.append(dialog);
    form.onsubmit = event => { event.preventDefault(); const parsed = Number(field.value); if (!field.value || !Number.isFinite(parsed) || parsed < min || parsed > max) { error.textContent = `请输入 ${min}–${max} 之间的数值`; return; } dialog.close(String(parsed)); };
    dialog.addEventListener('close', () => { const result = dialog.returnValue; dialog.remove(); resolve(result === '' ? null : Number(result)); }, { once: true });
    dialog.showModal(); field.focus(); field.select();
  });
}
