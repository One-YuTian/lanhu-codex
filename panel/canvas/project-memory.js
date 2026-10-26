export function savedProject(value) {
  if (!value || typeof value !== 'object' || typeof value.project_id !== 'string' || !value.project_id) return null;
  const route = {};
  for (const key of ['project_id', 'team_id', 'image_id']) {
    if (value[key] == null || value[key] === '') continue;
    if (typeof value[key] !== 'string' || !/^[\w-]{1,256}$/.test(value[key])) return null;
    route[key] = value[key];
  }
  return route;
}
