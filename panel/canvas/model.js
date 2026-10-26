import { styleDeclarations, cssColor, isDefaultCss, isTextLayer } from './layer-style.js';

export const unwrap = value => value?.data ?? value?.result ?? value ?? {};
export const resource = (value, dimensions = {}) => value ? `/api/resource?${new URLSearchParams({ url: value, ...dimensions })}` : '';
export function recentTimestamp(item) {
  for (const key of ['update_time', 'updated_at', 'create_time', 'created_at']) {
    const value = item?.[key];
    if (value == null || value === '') continue;
    const time = typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value);
    if (Number.isFinite(time)) return time;
  }
  return 0;
}
export const sortByRecent = items => [...items].sort((left, right) => recentTimestamp(right) - recentTimestamp(left));
export function designSize(payload, fallback) {
  const data = unwrap(payload), board = data.board || data.artboard || data.artboards?.[0];
  const frame = board?.frame || board?.bounds || board;
  return { width: Number(frame?.width) || fallback.width, height: Number(frame?.height) || fallback.height };
}
export function parseRoute(value) {
  const url = new URL(value, 'http://localhost');
  const query = new URLSearchParams(url.search);
  const hashQuery = new URLSearchParams(url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '');
  for (const [key, entry] of hashQuery) query.set(key, entry);
  const get = (...keys) => keys.map(key => query.get(key)).find(Boolean) || '';
  return { project_id: get('pid', 'project_id'), team_id: get('tid', 'team_id'), image_id: get('image_id', 'docId'), version_id: '', page_id: get('pageId', 'page_id') };
}
export function routeHash(route) {
  const query = new URLSearchParams();
  for (const [key, name] of Object.entries({ project_id: 'pid', team_id: 'tid', image_id: 'image_id', page_id: 'pageId' })) if (route[key]) query.set(name, route[key]);
  return `#/item/project/${route.image_id ? 'detailDetach' : 'stage'}?${query}`;
}
export function officialProjectUrl(route) {
  return `https://lanhuapp.com/web/${routeHash({ project_id: route.project_id, team_id: route.team_id })}`;
}
export function layoutImages(images) {
  const positioned = images.some(image => Number(image.position_x) || Number(image.position_y));
  return images.map((image, index) => ({ ...image, id: String(image.id), width: Math.max(1, Number(image.width) || 375), height: Math.max(1, Number(image.height) || 667),
    x: positioned ? Number(image.position_x) || 0 : index % 5 * 475,
    y: positioned ? Number(image.position_y) || 0 : Math.floor(index / 5) * 820 }));
}
export function boundsOf(items) {
  if (!items.length) return { x: 0, y: 0, width: 1000, height: 700 };
  const left = Math.min(...items.map(item => item.x)), top = Math.min(...items.map(item => item.y));
  return { x: left, y: top, width: Math.max(...items.map(item => item.x + item.width)) - left, height: Math.max(...items.map(item => item.y + item.height)) - top };
}
export function flattenLayers(payload, collapseWrappers = false) {
  const output = [], seen = new Set();
  const root = unwrap(payload);
  const visit = (value, depth = 0, parentId = '') => {
    if (!value || typeof value !== 'object' || depth > 80 || output.length >= 20000) return;
    if (Array.isArray(value)) { value.forEach(entry => visit(entry, depth, parentId)); return; }
    if (collapseWrappers && value !== root.artboard && value !== root.board && !root.artboards?.includes(value)) {
      const aliases = [String(value.id ?? value.objectID ?? '')];
      let child = value;
      let merged = value;
      for (let count = 0; count < 80 && child.layers?.length === 1 && child.name && child.layers[0].name === child.name; count++) {
        child = child.layers[0]; aliases.push(String(child.id ?? child.objectID ?? ''));
        merged = { ...child, ...merged, image: merged.image || child.image, images: merged.images || child.images,
          imageUrl: merged.imageUrl || child.imageUrl, url: merged.url || child.url,
          hasExportImage: merged.hasExportImage || child.hasExportImage, isAsset: merged.isAsset || child.isAsset,
          isSlice: merged.isSlice || child.isSlice, exportable: merged.exportable || child.exportable };
      }
      if (child !== value) {
        const style = { ...child.style, ...merged.style };
        for (const key of ['fills', 'borders', 'shadows']) if (!style[key]?.length && child.style?.[key]?.length) style[key] = child.style[key];
        value = { ...merged, style, contentType: child.type || merged.type, layers: child.layers || [], sourceIds: aliases.filter(Boolean) };
      }
    }
    const frame = value.frame || value.bounds || value.rect || {};
    const x = Number(frame.x ?? frame.left ?? value.x ?? value.left), y = Number(frame.y ?? frame.top ?? value.y ?? value.top);
    const width = Number(frame.width ?? value.width ?? (frame.right - frame.left)), height = Number(frame.height ?? value.height ?? (frame.bottom - frame.top));
    const id = String(value.id ?? value.objectID ?? value.do_objectID ?? output.length);
    if (Number.isFinite(x) && Number.isFinite(y) && width > 0 && height > 0 && !seen.has(id)) {
      seen.add(id); output.push({ ...value, id, parentId, x, y, width, height, depth, name: value.name || value.type || `图层 ${output.length + 1}` });
      parentId = id;
    }
    for (const key of ['layers', 'children', 'info', 'board', 'artboard', 'artboards', 'elements', 'nodes']) visit(value[key], depth + 1, parentId);
  };
  visit(root);
  return output;
}
export function layerKind(layer) {
  const type = String(layer.contentType || layer.type || layer.kind || '').toLowerCase();
  if (layer.isArtboard || type === 'artboard') return 'artboard';
  if (/group|folder/.test(type) || layer.layers?.length || layer.children?.length) return 'group';
  if (isTextLayer(layer)) return 'text';
  if (/image|bitmap|pixel|smartobject/.test(type)) return 'image';
  if (layer.sourceHost === 'photoshop-uxp' && type === 'shapelayer' && !layer.path && !layer.points?.length && !layer.shapePath && !layer.style?.fills?.length && !layer.style?.borders?.length) return 'image';
  if (/shape|rect|ellipse|oval|circle|line|path|vector/.test(type)) return 'shape';
  return 'unknown';
}
export function layerIcon(layer, slices = []) {
  const ids = new Set([layer.id, ...(layer.sourceIds || [])].map(String));
  if (layer.hasExportImage || layer.isAsset || layer.isSlice || layer.exportable || slices.some(slice => ids.has(String(slice.slice_id)))) return 'image-down';
  const type = String(layer.type || layer.kind || '').toLowerCase();
  const kind = layerKind(layer);
  if (kind === 'artboard') return 'panels-top-left';
  if (kind === 'group') return 'folder';
  if (kind === 'text') return 'type';
  if (kind === 'image') return 'image';
  if (/ellipse|oval|circle/.test(type)) return 'circle';
  if (/line|path|vector/.test(type)) return 'spline';
  if (/shape|rectangle|rect/.test(type)) return 'shapes';
  return 'square';
}
export function hitTestLayer(layers, point) {
  return layers.filter(layer => !layer.isArtboard && layer.visible !== false && point.x >= layer.x && point.y >= layer.y && point.x <= layer.x + layer.width && point.y <= layer.y + layer.height)
    .sort((left, right) => right.depth - left.depth || left.width * left.height - right.width * right.height)[0];
}
export function layerCss(layer, { colorFormat = 'hex' } = {}) {
  const css = { width: `${layer.width}px`, height: `${layer.height}px` };
  if (Number.isFinite(layer.x)) css.left = `${layer.x}px`;
  if (Number.isFinite(layer.y)) css.top = `${layer.y}px`;
  const style = layer.style || {};
  for (const [key, value] of Object.entries(style)) {
    const property = key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
    if (/^(background(?:-color|-image)?|border(?:-[a-z-]+)?|color|font-(?:size|family|weight|style)|line-height|letter-spacing|text-(?:align|decoration|shadow)|box-shadow|opacity|transform|overflow|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?)$/.test(property) && (typeof value === 'string' || typeof value === 'number')) css[property] = String(value);
  }
  for (const [source, target] of Object.entries({ fontSize: 'font-size', fontFamily: 'font-family', fontWeight: 'font-weight', lineHeight: 'line-height', letterSpacing: 'letter-spacing', opacity: 'opacity', borderRadius: 'border-radius', color: 'color' })) {
    const value = layer[source] ?? layer.textStyle?.[source];
    if (typeof value === 'string' || typeof value === 'number') css[target] = typeof value === 'number' && ['fontSize', 'lineHeight', 'letterSpacing', 'borderRadius'].includes(source) ? `${value}px` : String(value);
  }
  return Object.entries({ ...css, ...styleDeclarations(layer) }).filter(([key, value]) => !isDefaultCss(key, value)).map(([key, value]) => {
    const formatted = /color|background|border|shadow|stroke/.test(key) ? String(value).replace(/#[\da-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)/gi, color => cssColor(color, colorFormat)) : value;
    return `${key}: ${formatted};`;
  }).join('\n');
}
export function designLayers(payload, design) {
  const data = unwrap(payload), layers = flattenLayers(data, data.meta?.host?.name === 'photoshop-uxp');
  const board = data.board || data.artboard || data.artboards?.[0];
  if (!board) return layers;
  const frame = board.frame || board.bounds || board;
  const width = Number(frame.width), height = Number(frame.height);
  if (!(width > 0 && height > 0)) return layers;
  const scaleX = design.width / width, scaleY = design.height / height;
  const local = data.meta?.host?.name === 'photoshop-uxp';
  const left = local ? 0 : Number(frame.x ?? frame.left ?? 0), top = local ? 0 : Number(frame.y ?? frame.top ?? 0);
  return layers.map(layer => ({ ...layer, sourceHost: data.meta?.host?.name, isArtboard: layer.id === String(board.id), x: local && layer.id === String(board.id) ? 0 : (layer.x - left) * scaleX, y: local && layer.id === String(board.id) ? 0 : (layer.y - top) * scaleY,
    width: layer.width * scaleX, height: layer.height * scaleY }));
}
export function buildGroups(sectors, images) {
  const byId = new Map(), imageById = new Map(images.map(image => [String(image.id), image]));
  sectors.forEach((sector, index) => {
    if (sector.id == null) return;
    const id = String(sector.id);
    byId.set(id, { ...sector, id, parent_id: sector.parent_id == null ? '' : String(sector.parent_id), index, children: [], directIds: new Set((sector.images || []).map(entry => String(typeof entry === 'object' ? entry.id ?? entry.image_id : entry)).filter(imageId => imageById.has(imageId))), imageIds: new Set() });
  });
  const roots = [];
  for (const group of byId.values()) {
    let parent = byId.get(group.parent_id), cycle = false;
    const visited = new Set([group.id]);
    while (parent) { if (visited.has(parent.id)) { cycle = true; break; } visited.add(parent.id); parent = byId.get(parent.parent_id); }
    if (!cycle && byId.has(group.parent_id)) byId.get(group.parent_id).children.push(group); else roots.push(group);
  }
  const byImage = new Map(), grouped = new Set();
  const collect = group => {
    group.imageIds = new Set(group.directIds);
    group.children.forEach(child => collect(child).forEach(id => group.imageIds.add(id)));
    group.recentTime = Math.max(recentTimestamp(group), ...[...group.imageIds].map(id => recentTimestamp(imageById.get(id))), ...group.children.map(child => child.recentTime));
    group.children.sort((left, right) => right.recentTime - left.recentTime || Number(right.order || 0) - Number(left.order || 0) || left.index - right.index);
    for (const id of group.imageIds) { grouped.add(id); if (!byImage.has(id)) byImage.set(id, []); byImage.get(id).push(group); }
    return group.imageIds;
  };
  roots.forEach(collect);
  roots.sort((left, right) => right.recentTime - left.recentTime || Number(right.order || 0) - Number(left.order || 0) || left.index - right.index);
  return { roots, byId, byImage, imageById, ungrouped: images.filter(image => !grouped.has(String(image.id))) };
}
export function groupImages(groups, groupId) {
  if (groupId === 'ungrouped') return groups.ungrouped;
  const group = groups.byId.get(groupId);
  return group ? [...group.directIds].map(id => groups.imageById.get(id)).filter(Boolean) : [];
}
