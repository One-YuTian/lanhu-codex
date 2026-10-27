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

export function sameProject(left, right) {
  return Boolean(left?.project_id && right?.project_id && left.project_id === right.project_id
    && (!left.team_id || !right.team_id || left.team_id === right.team_id));
}
export function recentProjectRoutes(value, fallback) {
  const result = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const route = savedProject(entry); if (!route || result.some(item => sameProject(item, route))) continue;
    result.push({ project_id: route.project_id, ...(route.team_id ? { team_id: route.team_id } : {}) });
    if (result.length >= 8) break;
  }
  const previous = savedProject(fallback);
  if (!result.length && previous) result.push({ project_id: previous.project_id, ...(previous.team_id ? { team_id: previous.team_id } : {}) });
  return result;
}
export function rememberRecentProject(value, route) {
  const current = savedProject(route);
  return current ? recentProjectRoutes([current, ...recentProjectRoutes(value)]) : recentProjectRoutes(value);
}
