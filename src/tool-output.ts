import { AppError } from './shared';

// Filter only at the model-facing boundary; the canvas keeps the source data.
// Keep unknown design/style fields for format compatibility, but remove known
// editor bookkeeping and embedded copies of entire layer trees.
const omitted = new Set(['sliceBackData', 'generatorSettings', 'generatorSettingsMeta', 'pixels',
  'owner', 'creator', 'members', 'permissions', 'permission', 'user_info', 'team_info',
  'avatar', 'email', 'phone', 'comment_list', 'comments', 'history', 'operation_logs']);

export function compactToolOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactToolOutput);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => !omitted.has(key) && (item !== null || key === 'next_offset') && item !== undefined)
    .map(([key, item]) => [key, compactToolOutput(item)]));
}

const childKeys = new Set(['layers', 'children', 'info', 'artboards', 'assets', 'board', 'artboard']);
export function designElements(source: unknown, ids: string[] = []) {
  const wanted = new Set(ids), found = new Set<string>(), elements: Record<string, unknown>[] = [];
  const stack: { node: unknown; parent?: string }[] = [{ node: source }];
  let visited = 0;
  while (stack.length) {
    if (++visited > 200_000) throw new AppError('DESIGN_TOO_COMPLEX', '设计图层超过处理上限');
    const { node, parent } = stack.pop()!;
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const record = node as Record<string, unknown>;
    const id = record.id ?? record.objectID ?? record.do_objectID;
    const identity = id == null ? undefined : String(id);
    if (identity && !found.has(identity) && (!wanted.size || wanted.has(identity))) {
      found.add(identity);
      const fields = Object.fromEntries(Object.entries(record).filter(([key, value]) => !childKeys.has(key)
        || key === 'artboard' && value && typeof value === 'object' && 'artboardRect' in value));
      elements.push({ ...compactToolOutput(fields) as object, id: identity, ...(parent ? { parent_id: parent } : {}) });
    }
    const children = Object.entries(record).filter(([key]) => childKeys.has(key))
      .flatMap(([, value]) => Array.isArray(value) ? value : [value]);
    for (let index = children.length - 1; index >= 0; index--) stack.push({ node: children[index], parent: identity ?? parent });
  }
  return { elements, missing_ids: ids.filter(id => !found.has(id)) };
}
