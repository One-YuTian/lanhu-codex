import { resource, layerCss, layerKind } from './model.js';
import { layerStyleInfo, colorFormats, formatColor, colorChannels, isDefaultCss } from './layer-style.js';
import { icon } from './icons.js';
import { copyField, selectMarkup, checkboxMarkup, buttonMarkup } from './ui/components.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const number = value => Math.round(Number(value || 0) * 100) / 100;
export function layerPercent(value) {
  const explicitPercent = typeof value === 'string' && value.includes('%') || value?.units?.toLowerCase().includes('percent');
  const raw = value?.value ?? value;
  if (raw == null) return 100;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) return 100;
  const percent = explicitPercent ? parsed : parsed <= 1 ? parsed * 100 : parsed <= 100 ? parsed : parsed / 255 * 100;
  return number(Math.max(0, Math.min(100, percent)));
}
export function layerSlice(layer, slices = [], layers = []) {
  if (!layer) return null;
  const identities = new Set([String(layer.id), ...(layer.sourceIds || []).map(String)]);
  const match = slices.find(slice => String(slice.slice_id) === String(layer.id)) || slices.find(slice => identities.has(String(slice.slice_id)));
  if (match) return { ...match, logical_size: { width: layer.width, height: layer.height } };
  const url = layer.imageUrl || layer.image?.imageUrl || layer.url || layer.images?.png_xxxhd || layer.images?.png || layer.images?.svg;
  if ((layer.isAsset || layer.isSlice || layer.exportable || layer.hasExportImage || layer.imageUrl) && url) return { slice_id: layer.id, name: layer.name, url, logical_size: { width: layer.width, height: layer.height } };
  const byId = new Map(layers.map(item => [item.id, item])), visited = new Set([layer.id]);
  let parent = byId.get(layer.parentId);
  while (parent && !parent.isArtboard && !visited.has(parent.id)) {
    visited.add(parent.id);
    const inherited = layerSlice(parent, slices);
    if (inherited) return inherited;
    parent = byId.get(parent.parentId);
  }
  return null;
}
export function inspectorMarkup(item, slice, { scales = new Set([1]), format = 'png', colorFormat = 'hex', sliceStatus = 'ready', selected = false } = {}) {
  const field = copyField;
  const row = (label, content) => `<div class="style-row"><span class="style-label">${label}</span><div class="style-values">${content}</div></div>`;
  const opacity = layerPercent(item.opacity ?? item.blendOptions?.opacity ?? item.style?.opacity);
  const fill = layerPercent(item.fillOpacity ?? item.blendOptions?.fillOpacity ?? item.style?.fillOpacity);
  const info = layerStyleInfo(item), kind = layerKind(item);
  let markup = `<section class="style-section${kind === 'text' ? ' compact-properties' : ''}"><h3>样式信息</h3>${row('图层', field('图层名称', item.name))}${row('位置', `<div class="style-pair">${field('横坐标', `${number(item.x)}px`)}${field('纵坐标', `${number(item.y)}px`)}</div>`)}${row('大小', `<div class="style-pair">${field('宽度', `${number(item.width)}px`)}${field('高度', `${number(item.height)}px`)}</div>`)}${opacity !== 100 ? row('不透明度', field('不透明度', `${opacity}%`)) : ''}${fill !== 100 ? row('填充', field('填充不透明度', `${fill}%`)) : ''}</section>`;
  let nextColorId = 0;
  const colorField = (label, color) => {
    const alpha = colorChannels(color)?.a ?? 1;
    const selector = selectMarkup({ id: `color-format-${nextColorId++}`, label: `${label}格式`, value: colorFormat, options: colorFormats.map(value => ({ value, label: `${value.toUpperCase()}　${formatColor(color, value)}` })) });
    return `<div class="color-field" data-color="${escape(color)}" style="--swatch-color:${escape(color)}">${selector}${field(label, formatColor(color, colorFormat))}${alpha < 1 ? `<span class="color-alpha">${number(alpha * 100)}%</span>` : ''}</div>`;
  };
  const appearance = () => {
    let result = '';
    info.fills.forEach((paint, index) => {
      result += row(info.fills.length > 1 ? `颜色 ${index + 1}` : '颜色', colorField(`填充颜色 ${index + 1}`, paint.color));
      if (paint.opacity !== 1) result += row('颜色透明度', field(`颜色透明度 ${index + 1}`, `${layerPercent(paint.opacity)}%`));
    });
    if (info.borderRadius && !isDefaultCss('border-radius', info.borderRadius)) result += row('圆角', field('圆角', info.borderRadius));
    info.borders.forEach((border, index) => {
      if (border.width === 0) return;
      result += row('边框颜色', border.color ? colorField(`边框颜色 ${index + 1}`, border.color) : field('边框颜色', '未提供'));
      if (border.width !== undefined) result += row('边框宽度', field(`边框宽度 ${index + 1}`, `${border.width}px`));
      if (border.position != null) result += row('边框位置', field(`边框位置 ${index + 1}`, ({ 0: '居中', 1: '内部', 2: '外部', inside: '内部', center: '居中', outside: '外部' })[border.position] ?? border.position));
    });
    return result;
  };
  if (kind === 'shape') {
    const content = appearance();
    if (content) markup += `<section class="layer-appearance"><h3>外观</h3>${content}</section>`;
  }
  if (kind === 'text') {
    markup += '<section class="layer-typography compact-properties"><h3>文字</h3>';
    info.textRuns.forEach((run, index) => {
      if (info.textRuns.length > 1) markup += `<h4>文字样式 ${index + 1}</h4>`;
      for (const [label, property, value] of [['字体', 'font-family', run.fontFamily], ['字号', 'font-size', run.fontSize === undefined ? undefined : `${run.fontSize}px`], ['字重', 'font-weight', run.fontWeight], ['字形', 'font-style', run.fontStyle], ['行高', 'line-height', run.lineHeight === undefined ? undefined : `${run.lineHeight}px`], ['字距', 'letter-spacing', run.letterSpacing]]) {
        if (value != null && value !== '' && !isDefaultCss(property, value)) markup += row(label, field(label, value));
      }
      const alignments = [];
      if (run.textAlign && !isDefaultCss('text-align', run.textAlign)) alignments.push(field('水平对齐', ({ center: '居中对齐', left: '左对齐', right: '右对齐', justify: '两端对齐' })[run.textAlign] || run.textAlign));
      if (run.verticalAlign && !['top', 'start'].includes(run.verticalAlign)) alignments.push(field('垂直对齐', ({ center: '垂直居中对齐', bottom: '底部对齐' })[run.verticalAlign] || run.verticalAlign));
      if (alignments.length) markup += row('对齐', `<div class="text-alignments">${alignments.join('')}</div>`);
      if (run.color) markup += row('文字颜色', colorField(`文字颜色 ${index + 1}`, run.color));
      if (run.content) markup += row('内容', field('内容', run.content));
    });
    markup += `${appearance()}</section>`;
  }
  const code = layerCss(item, { colorFormat });
  const codeMarkup = slice || item.hasExportImage || item.isSlice || item.isAsset || item.exportable ? '' : `<section class="layer-code"><div class="code-heading"><h3>代码</h3><button id="copy-layer-code" title="复制 CSS" aria-label="复制 CSS">${icon('copy')}</button></div><span class="code-language">CSS</span><pre><code>${escape(code)}</code></pre></section>`;
  if (!slice) return markup + (sliceStatus === 'error' ? '<p class="slice-hint">切图数据加载失败，请重新加载后重试</p>' : '') + codeMarkup;
  const width = Math.max(1, Math.round(slice.logical_size.width)), height = Math.max(1, Math.round(slice.logical_size.height));
markup += `<section class="current-slice"><h3>切图</h3>${row('切图名称', field('切图名称', slice.name || item.name))}<div class="slice-preview"><img data-resource-src="${escape(resource(slice.url, { width, height, format: 'png' }))}" alt="${escape(slice.name || item.name)}切图预览"></div><div class="export-settings"><div class="export-format"><span>下载切图样式</span>${selectMarkup({ id: 'slice-format', label: '下载切图样式', value: format, options: ['png', 'webp'].map(value => ({ value, label: value.toUpperCase() })) })}</div><div class="scale-options">${[1, 2].map(scale => checkboxMarkup({ name: 'slice-scale', value: scale, checked: scales.has(scale), label: `${scale}×`, description: `${width * scale}px × ${height * scale}px` })).join('')}</div>${buttonMarkup({ id: 'download-slice', label: '下载切图', className: 'download-slice', variant: 'primary', disabled: !scales.size })}</div></section>`;
  return markup + codeMarkup;
}
