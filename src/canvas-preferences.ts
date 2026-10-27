import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { settingsFile } from './settings';
import { savedProject, recentProjectRoutes, rememberRecentProject } from '../panel/canvas/project-memory.js';
import { projectMemoryKey } from '../panel/canvas/lanhu-links.js';

const queues = new Map<string, Promise<unknown>>();
export function registerCanvasPreferences(server: McpServer) {
  const id = z.string().regex(/^[\w-]{1,256}$/);
  server.registerTool('lanhu_canvas_preferences', {
    title: '蓝湖画布项目记忆', description: '读取或保存最近选择的团队、打开的项目及设计稿 ID，不保存 Cookie 或任意 URL。',
    inputSchema: { sidebar_width: z.number().int().min(200).max(480).optional(), team_id: id.optional(), route: z.object({ project_id: id, team_id: id.optional(), image_id: id.optional() }).optional(),
      group: z.object({ project_id: id, team_id: id.optional(), group_id: id }).optional(), seen_link: z.string().regex(/^[a-f0-9]{64}$/).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['app'] } }
  }, async ({ sidebar_width, team_id, route, group, seen_link }) => {
    const file = path.join(path.dirname(settingsFile()), 'canvas-state.json');
    const readState = async () => { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; } };
    try {
      if (sidebar_width !== undefined || team_id || route || group || seen_link) {
        const task = (queues.get(file) ?? Promise.resolve()).catch(() => undefined).then(async () => {
          const temporary = `${file}.${randomUUID()}.tmp`;
          try {
            const state = await readState();
            if (route) { state.recentProjects = rememberRecentProject(recentProjectRoutes(state.recentProjects, state.route), route); state.route = route; }
            if (team_id) state.team_id = team_id;
            if (sidebar_width !== undefined) state.sidebar_width = sidebar_width;
            if (group) state.groups = { ...state.groups, [projectMemoryKey(group)]: group.group_id };
            if (seen_link) state.seenLinks = [...new Set([...(Array.isArray(state.seenLinks) ? state.seenLinks : []), seen_link])];
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
            await rename(temporary, file);
          } finally { await unlink(temporary).catch(() => undefined); }
        });
        queues.set(file, task);
        try { await task; } finally { if (queues.get(file) === task) queues.delete(file); }
      }
      await queues.get(file)?.catch(() => undefined);
      const state = await readState();
      return { content: [], _meta: { 'lanhu/sidebarWidth': z.number().int().min(200).max(480).safeParse(state.sidebar_width).success ? state.sidebar_width : null, 'lanhu/team': id.safeParse(state.team_id).success ? state.team_id : null, 'lanhu/savedRoute': route ?? savedProject(state.route), 'lanhu/recentProjects': recentProjectRoutes(state.recentProjects, state.route), 'lanhu/groups': state.groups || {}, 'lanhu/seenLinks': state.seenLinks || [] } };
    } catch (error) {
      if (!route && (error as NodeJS.ErrnoException).code === 'ENOENT') return { content: [], _meta: { 'lanhu/savedRoute': null } };
      return { isError: true, content: [], _meta: { 'lanhu/error': { message: '无法读取或保存最近打开的项目' } } };
    }
  });
}
