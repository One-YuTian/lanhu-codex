import { savedProject } from './canvas/project-memory.js';
import { routeHash } from './canvas/model.js';

// An empty open result must not erase the current or remembered project.
export function createCanvasRouteHandler(apply: (hash: string) => void) {
  return (result: { _meta?: Record<string, unknown> }) => {
    const value = result._meta?.['lanhu/route'];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const keys = Object.keys(value);
    if (keys.some(key => !['project_id', 'team_id', 'image_id'].includes(key))) return;
    if (!keys.length) return;
    const route = savedProject(value);
    if (!route) return;
    apply(routeHash(route));
  };
}
