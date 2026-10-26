const numeric = value => {
  if (value == null || value === '' || Array.isArray(value)) return undefined;
  const parsed = Number(value?.value ?? value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const enabled = item => item && item.isEnabled !== false && item.enabled !== false;
export const isTextLayer = layer => /text|font/i.test(String(layer.contentType || layer.type || layer.kind || '')) || layer.text != null || layer.fontSize != null || Boolean(layer.textStyle || layer.textInfo);

// Legacy Photoshop exports store text separately from the boolean `text` flag.
function photoshopTextRuns(info) {
  const content = typeof info.text === 'string' ? info.text : '';
  const size = numeric(info.size), points = numeric(info.sizePt);
  const pixels = value => {
    const number = numeric(value);
    if (number === undefined) return undefined;
    return /points/i.test(value?.units || '') && size !== undefined && points > 0 ? number / points * size : number;
  };
  const ranges = info.textStyleRange?.length ? info.textStyleRange : [{}];
  return ranges.map(range => {
    const style = range.textStyle || {};
    const tracking = numeric(style.tracking ?? info.tracking);
    const leading = pixels(style.leading ?? info.leading);
    return {
      content: range.from != null && range.to != null ? content.slice(range.from, range.to) : content,
      font: {
        name: style.fontName ?? info.fontName ?? style.fontPostScriptName ?? info.fontPostScriptName,
        size: pixels(style.size) ?? size,
        type: style.fontStyleName ?? info.fontStyleName,
        bold: style.syntheticBold ?? style.bold ?? info.bold,
        italic: style.syntheticItalic ?? style.italic ?? info.italic,
        align: style.justification ?? info.justification,
        lineHeight: leading > 0 && style.autoLeading !== true ? leading : undefined,
        // Photoshop tracking is measured in thousandths of an em.
        letterSpacing: tracking === undefined ? undefined : { value: tracking / 10, unit: 'PERCENT' }
      },
      color: style.color ?? info.color
    };
  });
}
export const colorFormats = ['hex', 'ahex', 'hexa', 'rgba', 'hsla'];
export function colorChannels(value) {
  const color = layerColor(value).toLowerCase();
  const named = { transparent: '#00000000', black: '#000000', white: '#ffffff' };
  const source = named[color] || color;
  if (source.startsWith('#')) {
    let hex = source.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(character => character.repeat(2)).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1 };
  }
  const values = source.match(/[+-]?(?:\d*\.)?\d+%?/g);
  if (!values || values.length < 3) return null;
  const alpha = values[3] === undefined ? 1 : parseFloat(values[3]) / (values[3].endsWith('%') ? 100 : 1);
  let rgb;
  if (source.startsWith('hsl')) {
    const hue = ((parseFloat(values[0]) % 360) + 360) % 360 / 360, saturation = parseFloat(values[1]) / 100, light = parseFloat(values[2]) / 100;
    const channel = offset => {
      const position = (offset + hue * 12) % 12;
      return light - saturation * Math.min(light, 1 - light) * Math.max(-1, Math.min(position - 3, 9 - position, 1));
    };
    rgb = [channel(0), channel(8), channel(4)].map(value => Math.round(value * 255));
  } else rgb = values.slice(0, 3).map(value => Math.round(parseFloat(value) * (value.endsWith('%') ? 2.55 : 1)));
  return { r: Math.max(0, Math.min(255, rgb[0])), g: Math.max(0, Math.min(255, rgb[1])), b: Math.max(0, Math.min(255, rgb[2])), a: Math.max(0, Math.min(1, alpha)) };
}
export function formatColor(value, format = 'hex') {
  const color = colorChannels(value);
  if (!color) return layerColor(value);
  const byte = value => Math.round(value).toString(16).padStart(2, '0').toUpperCase();
  const hex = [color.r, color.g, color.b].map(byte).join(''), alpha = byte(color.a * 255);
  if (format === 'ahex') return `#${alpha}${hex}`;
  if (format === 'hexa') return `#${hex}${alpha}`;
  const opacity = Math.round(color.a * 1000) / 1000;
  if (format === 'rgba') return `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity})`;
  if (format === 'hsla') {
    const rgb = [color.r, color.g, color.b].map(channel => channel / 255), max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min, light = (max + min) / 2;
    const saturation = delta ? delta / (1 - Math.abs(2 * light - 1)) : 0;
    let hue = delta ? max === rgb[0] ? (rgb[1] - rgb[2]) / delta % 6 : max === rgb[1] ? (rgb[2] - rgb[0]) / delta + 2 : (rgb[0] - rgb[1]) / delta + 4 : 0;
    hue = (hue * 60 + 360) % 360;
    return `hsla(${Math.round(hue)}, ${Math.round(saturation * 100)}%, ${Math.round(light * 100)}%, ${opacity})`;
  }
  return `#${hex}`;
}
export function cssColor(value, format = 'hex') {
  return formatColor(value, format === 'ahex' || format === 'hex' && colorChannels(value)?.a < 1 ? 'hexa' : format);
}
export function isDefaultCss(property, value) {
  const normalized = String(value).trim().toLowerCase();
  if (property === 'opacity') return Number(normalized) === 1;
  if (property === 'letter-spacing' || property === 'border-radius') return normalized === 'normal' || normalized.split(/\s+/).every(part => /^0(?:px|em|rem|%)?$/.test(part));
  return ({ 'font-weight': ['normal', '400'], 'font-style': ['normal', 'regular'], 'line-height': ['normal'], 'text-align': ['start'], 'text-decoration': ['none'], 'box-shadow': ['none'], 'border': ['none', '0'], 'background-color': ['transparent'] })[property]?.includes(normalized) || false;
}
export function layerColor(value) {
  if (typeof value === 'string') {
    const color = value.trim();
    return /^(#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%/+-]+\)|transparent|black|white)$/i.test(color) ? color : '';
  }
  if (!value || typeof value !== 'object') return '';
  const direct = layerColor(value.value ?? value.hex);
  if (direct) return direct;
  const channels = [value.r ?? value.red, value.g ?? value.green, value.b ?? value.blue].map(numeric);
  if (channels.some(channel => channel === undefined)) return '';
  const normalized = 'red' in value && channels.every(channel => channel >= 0 && channel <= 1);
  const rgb = channels.map(channel => Math.round(Math.max(0, Math.min(255, normalized ? channel * 255 : channel))));
  const alpha = numeric(value.a ?? value.alpha) ?? 1;
  return `rgba(${rgb.join(', ')}, ${Math.max(0, Math.min(1, alpha))})`;
}
export function layerStyleInfo(layer) {
  const style = layer.style || {};
  const paints = (style.fills || layer.fills || []).filter(enabled);
  const fills = paints.map(paint => ({ color: layerColor(paint.color || paint), opacity: numeric(paint.opacity) ?? 1 })).filter(paint => paint.color);
  const textLayer = isTextLayer(layer);
  const fallbackColor = layerColor(layer.fillColor ?? style.backgroundColor ?? (!textLayer && layer.color));
  if (!paints.length && fallbackColor) fills.push({ color: fallbackColor, opacity: 1 });
  const borders = (style.borders || layer.borders || []).filter(enabled).map(border => ({
    color: layerColor(border.color), width: numeric(border.thickness ?? border.width ?? border.size),
    position: border.position ?? border.align, style: border.dashPattern?.length ? 'dashed' : 'solid'
  }));
  const radius = layer.borderRadius ?? style.borderRadius ?? layer.radius;
  const corners = radius && typeof radius === 'object' && !Array.isArray(radius)
    ? ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'].map(key => numeric(radius[key])) : [];
  const borderRadius = corners.length && corners.every(value => value !== undefined) ? corners.map(value => `${value}px`).join(' ') : numeric(radius) !== undefined ? `${numeric(radius)}px` : '';
  const text = layer.text;
  const sources = text?.styles?.length ? text.styles : layer.textInfo ? photoshopTextRuns(layer.textInfo) : [text?.style || layer.textStyle || {}];
  const textRuns = sources.map(run => {
    const font = run.font || run;
    const spacing = font.letterSpacing ?? run.letterSpacing ?? layer.letterSpacing;
    const letterSpacing = numeric(spacing);
    return { content: run.content ?? text?.value ?? layer.content ?? (typeof text === 'string' ? text : ''),
      fontFamily: font.name ?? font.fontFamily ?? layer.fontFamily,
      fontSize: numeric(font.size ?? font.fontSize ?? layer.fontSize),
      fontWeight: font.bold ? '700' : font.weight ?? font.fontWeight ?? layer.fontWeight ?? ({ Regular: '400', Medium: '500', Semibold: '600', Bold: '700', Light: '300' })[font.type],
      fontStyle: font.italic ? 'italic' : font.type,
      lineHeight: numeric(font.lineHeight ?? run.lineHeight ?? layer.lineHeight) ?? (numeric(font.lineSpacing) > 0 ? numeric(font.lineSpacing) : undefined),
      letterSpacing: letterSpacing === undefined ? undefined : `${letterSpacing}${/percent/i.test(spacing?.unit || '') ? '%' : 'px'}`,
      textAlign: font.align ?? font.textAlign ?? run.textAlign ?? layer.textAlign,
      verticalAlign: font.verticalAlignment ?? run.verticalAlignment ?? layer.verticalAlignment,
      color: layerColor(run.color ?? font.color ?? layer.color ?? style.color),
      underline: font.underline, linethrough: font.linethrough
    };
  });
  return { fills, borders, borderRadius, textRuns };
}
export function styleDeclarations(layer) {
  const info = layerStyleInfo(layer), css = {};
  const text = isTextLayer(layer);
  if (info.fills.length) css[text ? 'color' : 'background-color'] = info.fills[0].color;
  if (info.borders.length) {
    const border = info.borders[0];
    if (border.width !== undefined && border.color) css.border = `${border.width}px ${border.style} ${border.color}`;
  }
  if (info.borderRadius) css['border-radius'] = info.borderRadius;
  if (text) {
    const run = info.textRuns[0];
    if (run.fontFamily) css['font-family'] = JSON.stringify(String(run.fontFamily));
    if (run.fontSize !== undefined) css['font-size'] = `${run.fontSize}px`;
    if (run.fontWeight != null) css['font-weight'] = String(run.fontWeight);
    if (run.fontStyle === 'italic') css['font-style'] = 'italic';
    if (run.lineHeight !== undefined) css['line-height'] = `${run.lineHeight}px`;
    if (run.letterSpacing !== undefined) css['letter-spacing'] = run.letterSpacing.endsWith('%') ? `${parseFloat(run.letterSpacing) / 100}em` : run.letterSpacing;
    if (run.textAlign) css['text-align'] = run.textAlign;
    if (run.color) css.color = run.color;
    if (run.underline || run.linethrough) css['text-decoration'] = [run.underline ? 'underline' : '', run.linethrough ? 'line-through' : ''].filter(Boolean).join(' ');
    if (info.borders[0]?.color && info.borders[0]?.width !== undefined) {
      css['-webkit-text-stroke'] = `${info.borders[0].width}px ${info.borders[0].color}`;
      delete css.border;
    }
  }
  const opacity = layer.opacity ?? layer.style?.opacity;
  const alpha = numeric(typeof opacity === 'string' ? parseFloat(opacity) : opacity);
  if (alpha !== undefined) css.opacity = String(Math.max(0, Math.min(1, /percent|%/i.test(`${opacity?.units || ''}${opacity}`) || alpha > 1 ? alpha / (alpha > 100 ? 255 : 100) : alpha)));
  return css;
}
