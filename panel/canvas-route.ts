import { savedProject } from './canvas/project-memory.js';
import { routeHash } from './canvas/model.js';

// A global entry can reuse an already mounted panel. Restore memory for every
// empty tool invocation, including after returning to the manager in that panel.
export function createCanvasRouteHandler(recall: () => Promise<unknown>, apply: (hash: string) => void) {
  let generation = 0;
  return async (result: { _meta?: Record<string, unknown> }) => {
    const value = result._meta?.['lanhu/route'];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const keys = Object.keys(value);
    if (keys.some(key => !['project_id', 'team_id', 'image_id'].includes(key))) return;
    const explicit = keys.length ? savedProject(value) : null;
    if (keys.length && !explicit) return;
    const current = ++generation;
    let route = explicit;
    if (!keys.length) {
      try { route = savedProject(await recall()); } catch { /* First launch can still show the manager. */ }
    }
    if (current === generation) apply(route ? routeHash(route) : '');
  };
}
