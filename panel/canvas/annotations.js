import { hitTestLayer } from './model.js';

export function annotationTarget(context, point, imageId, layerId) {
  const board = context.boards.find(image => image.id === imageId) || (context.detail && !imageId ? context.boards[0] : undefined);
  const selectedGroup = context.groups.byId.get(context.filter);
  const group = (!board || selectedGroup?.directIds.has(board.id) ? selectedGroup : null) || context.groups.byImage.get(board?.id || imageId)?.find(item => item.directIds.has(board?.id || imageId));
  const path = [], seen = new Set();
  let ancestor = group;
  while (ancestor && !seen.has(ancestor.id)) { seen.add(ancestor.id); path.unshift(ancestor.name); ancestor = context.groups.byId.get(ancestor.parent_id); }
  let layer, pagePath;
  if (board) {
    path.push(board.name || board.id);
    pagePath = [...path];
    if (context.detail) {
      layer = layerId ? context.layers.find(item => item.id === layerId) : hitTestLayer(context.layers, { x: point.x - board.x, y: point.y - board.y });
      const byId = new Map(context.layers.map(item => [item.id, item])), layers = [];
      ancestor = layer; seen.clear();
      while (ancestor && !seen.has(ancestor.id)) { seen.add(ancestor.id); if (!ancestor.isArtboard) layers.unshift(ancestor.name || ancestor.id); ancestor = byId.get(ancestor.parentId); }
      path.push(...layers);
    }
  } else path.push('分组画布');
  return { project_id: context.route.project_id, team_id: context.route.team_id || '', image_id: board?.id || '',
    group_id: group?.id || context.filter, target_id: layer?.id || board?.id || group?.id || context.filter,
    target_type: layer ? 'layer' : board ? 'artboard' : 'group', path, scope: context.detail ? 'detail' : 'group',
    ...(board ? { image_name: board.name || board.id, page_path: pagePath, artboard_size: { width: board.width, height: board.height } } : {}),
    ...(layer ? { bounds: { x: layer.x, y: layer.y, width: layer.width, height: layer.height } }
      : board ? { bounds: { x: 0, y: 0, width: board.width, height: board.height } } : {}),
    x: Math.round((point.x - (board?.x || 0)) * 100) / 100, y: Math.round((point.y - (board?.y || 0)) * 100) / 100 };
}

export function annotationHitTarget(context, point, imageId) {
  const contains = board => point.x >= board.x && point.y >= board.y && point.x <= board.x + board.width && point.y <= board.y + board.height;
  const board = context.boards.find(board => board.id === imageId && contains(board)) || [...context.boards].reverse().find(contains);
  return board ? annotationTarget(context, point, board.id) : null;
}
export function annotationSelectedTargets(context) {
  if (!context.route.project_id || !context.detail && !context.filter) return [];
  if (context.detail) {
    const board = context.boards[0]; if (!board) return [];
    const layer = context.layer;
    const point = { x: board.x + (layer ? layer.x + layer.width / 2 : board.width / 2), y: board.y + (layer ? layer.y + layer.height / 2 : board.height / 2) };
    return [annotationTarget(layer ? context : { ...context, layers: [] }, point, board.id, layer?.id)];
  }
  return context.boards.filter(board => context.selected?.has(board.id)).map(board => annotationTarget(context,
    { x: board.x + board.width / 2, y: board.y + board.height / 2 }, board.id));
}

export function annotationVisible(item, context) {
  if (item.project_id !== context.route.project_id) return false;
  if (context.route.image_id && !context.detail) return false;
  if (context.route.image_id && context.detail?.id !== context.route.image_id) return false;
  const scope = item.scope || (item.target_type === 'layer' ? 'detail' : 'group');
  if (context.detail) return scope === 'detail' && item.image_id === context.detail.id;
  if (scope === 'detail') return context.boards.some(board => board.id === item.image_id);
  return item.group_id === context.filter && (!item.image_id || context.boards.some(board => board.id === item.image_id));
}

export function annotationProjection(item, context) {
  if (!annotationVisible(item, context)) return null;
  const board = context.boards.find(board => board.id === item.image_id);
  const scaleX = board && item.artboard_size?.width > 0 ? board.width / item.artboard_size.width : 1;
  const scaleY = board && item.artboard_size?.height > 0 ? board.height / item.artboard_size.height : 1;
  const project = box => ({ x: (board?.x || 0) + box.x * scaleX, y: (board?.y || 0) + box.y * scaleY,
    width: box.width * scaleX, height: box.height * scaleY });
  return { x: (board?.x || 0) + item.x * scaleX, y: (board?.y || 0) + item.y * scaleY,
    bounds: item.bounds ? project(item.bounds) : null,
    area: item.area ? item.scope === 'detail' ? project(item.area) : item.area : null };
}

export function annotationTargetsInRect(context, rect) {
  const intersects = box => box.x < rect.x + rect.width && box.x + box.width > rect.x && box.y < rect.y + rect.height && box.y + box.height > rect.y;
  if (!context.detail) return context.boards.filter(intersects).map(board => annotationTarget(context, { x: board.x + board.width / 2, y: board.y + board.height / 2 }, board.id));
  const board = context.boards[0];
  if (!board) return [];
  const layers = context.layers.filter(layer => !layer.isArtboard && layer.visible !== false && intersects({ ...layer, x: layer.x + board.x, y: layer.y + board.y }));
  const byId = new Map(context.layers.map(layer => [layer.id, layer])), parents = new Set();
  for (const layer of layers) {
    let parent = byId.get(layer.parentId);
    const seen = new Set();
    while (parent && !seen.has(parent.id)) { seen.add(parent.id); parents.add(parent.id); parent = byId.get(parent.parentId); }
  }
  return layers.filter(layer => !parents.has(layer.id)).map(layer => annotationTarget(context, { x: board.x + layer.x + layer.width / 2, y: board.y + layer.y + layer.height / 2 }, board.id, layer.id));
}

export function annotationLabel(item) {
  const names = (item.targets?.length ? item.targets : [item]).map(target => target.path.at(-1) || target.target_id);
  return `${item.number}.${names.length > 3 ? `${names.slice(0, 2).join('、')}等 ${names.length} 项` : names.join('、')}`;
}

export function annotationDescription(item) {
  const targets = item.targets?.length ? item.targets : [item];
  const kind = target => target.target_type === 'artboard' ? '页面' : target.target_type === 'layer' ? '对象' : '分组画布';
  if (targets.length === 1) return `${kind(targets[0])}「${targets[0].path.at(-1) || targets[0].target_id}」`;
  const counts = new Map();
  for (const target of targets) counts.set(kind(target), (counts.get(kind(target)) || 0) + 1);
  return `多选（${[...counts].map(([name, count]) => `${count} 个${name}`).join('、')}，共 ${targets.length} 项）`;
}

export function annotationInstructions(items) {
  const pages = new Map();
  for (const item of items) {
    const targets = item.targets?.length ? item.targets : [item], portions = new Map();
    for (const target of targets) {
      const pid = target.project_id || item.project_id, tid = target.team_id || item.team_id || '';
      const imageid = target.image_id || item.image_id || '';
      const key = JSON.stringify([pid, tid, imageid || `group:${target.group_id || item.group_id}`]);
      if (!pages.has(key)) {
        const name = target.image_name || item.image_name || (target.target_type === 'artboard' ? target.path.at(-1) : imageid) || 'Canvas';
        const pagePath = target.page_path || item.page_path || (target.target_type === 'artboard' ? target.path : target.path.slice(0, -1));
        pages.set(key, { pid, tid, imageid, name, path: pagePath, notes: [] });
      }
      if (!portions.has(key)) portions.set(key, []);
      const portion = portions.get(key);
      if (!portion.some(entry => entry.target_id === target.target_id && entry.target_type === target.target_type)) portion.push(target);
    }
    for (const [key, targets] of portions) pages.get(key).notes.push({ item, targets });
  }
  return [...pages.values()].map(page => {
    const gids = new Set(page.notes.flatMap(note => note.targets.map(target => target.group_id || note.item.group_id)).filter(Boolean));
    const header = [`pid:${page.pid}`, page.tid ? `tid:${page.tid}` : '', page.imageid ? `imageid:${page.imageid}` : '',
      gids.size === 1 ? `gid:${[...gids][0]}` : ''].filter(Boolean).join('\n');
    const notes = page.notes.map(({ item, targets }) => {
      const counts = new Map();
      const kind = target => target.target_type === 'artboard' ? 'page' : target.target_type === 'layer' ? 'object' : 'group';
      for (const target of targets) counts.set(kind(target), (counts.get(kind(target)) || 0) + 1);
      const type = targets.length === 1 ? kind(targets[0]) : `multi(${[...counts].map(([type, count]) => `${type}:${count}`).join(',')})`;
      const details = targets.filter(target => kind(target) !== 'page').map(target => {
        const prefix = page.path.every((name, index) => name === target.path[index]) ? page.path.length : 0;
        return `- id:${target.target_id}\n  path:${JSON.stringify(target.path.slice(prefix).join('/'))}${gids.size > 1 ? `\n  gid:${target.group_id || item.group_id || ''}` : ''}`;
      }).join('\n');
      const first = targets[0], rect = item.scope === 'detail' && item.area ? `\nrect:${item.area.x},${item.area.y},${item.area.width},${item.area.height}` : '';
      return `#${item.number} ${type}\nat:${first.x},${first.y}${rect}\n${item.text}${details ? `\n${details}` : ''}`;
    }).join('\n\n');
    const name = page.name.endsWith('页面') ? page.name : `${page.name}页面`;
    const summary = page.notes.length === 1 ? page.notes[0].item.text.trim().replace(/\s+/g, ' ') || '标记' : `共${page.notes.length}处标记`;
    return { title: `${name}：${summary}`.slice(0, 1024),
      prompt: `${header}\npage:${JSON.stringify(page.path.join('/'))}\n\n${notes}` };
  });
}

export function annotationPrompt(items) {
  return annotationInstructions(items).map(item => item.prompt).join('\n\n');
}

export class AnnotationStore {
  items = [];
  next = 1;
  busy = false;
  add(target) {
    if (this.busy) throw new Error('正在追加草稿，请稍后再修改标注');
    if (this.items.length >= 200) throw new Error('单个项目最多保留 200 条标注');
    const item = { ...target, id: crypto.randomUUID(), number: this.next++, text: '' };
    this.items.push(item); return item;
  }
  update(id, text, target) {
    if (this.busy) return;
    const item = this.items.find(item => item.id === id);
    if (item) {
      const identity = { id: item.id, number: item.number };
      if (target) { delete item.area; Object.assign(item, target, identity); }
      item.text = text.slice(0, 4000);
    }
  }
  remove(id) {
    if (this.busy) return;
    this.items = this.items.filter(item => item.id !== id);
    this.items.forEach((item, index) => { item.number = index + 1; });
    this.next = this.items.length + 1;
  }
  clear() { if (!this.busy) { this.items = []; this.next = 1; } }
  async send(sender) {
    if (this.busy) throw new Error('正在追加草稿，请勿重复操作');
    if (!this.items.length || this.items.some(item => !item.text.trim())) throw new Error('请先填写所有标注内容');
    const instructions = annotationInstructions(this.items);
    if (instructions.reduce((length, item) => length + item.prompt.length, 0) > 60000) throw new Error('标注内容过长，请精简后再提交');
    this.busy = true;
    try { await sender(instructions); this.items = []; this.next = 1; }
    finally { this.busy = false; }
  }
}
