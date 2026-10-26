import { describe, expect, it } from 'vitest';
import { buttonMarkup, checkboxMarkup, copyField, selectMarkup } from '../panel/canvas/ui/components.js';

describe('公共 UI 组件', () => {
  it('只读信息通过可复制文本呈现，不生成可编辑输入框', () => {
    const markup = copyField('宽度', '136px');
    expect(markup).toContain('data-copy-value="136px"');
    expect(markup).toContain('aria-description="136px"');
    expect(markup).not.toContain('<input');
    expect(copyField('名称', '<img src=x onerror=alert(1)>')).not.toContain('<img');
  });
  it('格式和倍率使用公共组件，不生成原生下拉框或复选输入', () => {
    const select = selectMarkup({ id: 'format', label: '格式', value: 'webp', options: [{ value: 'png', label: 'PNG' }, { value: 'webp', label: 'WEBP' }] });
    expect(select).toContain('<lh-select');
    expect(select).not.toContain('<select');
    const checkbox = checkboxMarkup({ name: 'scale', value: 2, checked: true, label: '2×', description: '272px × 278px' });
    expect(checkbox).toContain('<lh-checkbox');
    expect(checkbox).toContain(' checked');
    expect(checkbox).not.toContain('<input');
  });
  it('按钮样式与禁用状态统一，并转义外部文案', () => {
    const markup = buttonMarkup({ id: 'download', label: '<下载>', variant: 'primary', disabled: true });
    expect(markup).toContain('ui-button--primary');
    expect(markup).toContain(' disabled');
    expect(markup).toContain('&lt;下载&gt;');
  });
});
