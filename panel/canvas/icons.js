let sprite = '/icons/lucide.svg';
let symbolPrefix = '';
export function configureIcons(value, prefix = '') { sprite = value; symbolPrefix = prefix; }
export function iconHref(name) { return `${sprite}#${symbolPrefix}${name}`; }
export function icon(name, className = '') {
  return `<svg class="ui-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="${iconHref(name)}"></use></svg>`;
}
export function renderIcons() {
  document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
}
