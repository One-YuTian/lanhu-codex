import { savedProject } from './canvas/project-memory.js';
import { routeHash } from './canvas/model.js';

// Opening without a project always enters project management.
export function createCanvasRouteHandler(apply: (hash: string) => void) {
  return (result: { _meta?: Record<string, unknown> }) => {
    const value = result._meta?.['lanhu/route'];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const keys = Object.keys(value);
    if (keys.some(key => !['project_id', 'team_id', 'image_id'].includes(key))) return;
    const route = keys.length ? savedProject(value) : null;
    if (keys.length && !route) return;
    apply(route ? routeHash(route) : '');
  };
}
