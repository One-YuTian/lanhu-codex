import { extractSlices } from './assets.mjs';
import { LanhuApi } from './lanhu-api';
import type { Bridge } from './bridge';

export function canvasReader(bridge: Bridge) {
  const api = new LanhuApi(bridge);
  return async (name: string, args: Record<string, any>) => {
    switch (name) {
      case 'get_status': return bridge.status();
      case 'lanhu_get_teams': return api.teams();
      case 'lanhu_get_projects': return api.projects(args.team_id, args.folder_id);
      case 'lanhu_resolve_link': return api.resolveLink(args.url);
      case 'lanhu_get_profile': return api.profile(args.team_id);
      case 'lanhu_get_project': return api.project(args as any);
      case 'lanhu_get_project_images': return api.designs(args as any);
      case 'lanhu_get_project_sectors': return api.sectors(args.project_id);
      case 'lanhu_get_design': return api.design(args as any);
      case 'lanhu_get_design_schema': return api.schema(args.version_id);
      case 'lanhu_get_resource': {
        const asset = await api.resource(args.target_url);
        return { binary: asset.bytes, mime: asset.mimeType };
      }
      case 'lanhu_get_design_slices': {
        const raw = await api.design(args as any);
        const version = (raw.data ?? raw.result ?? raw).versions?.[0];
        if (!version?.json_url) throw new Error('设计稿没有可读取的切图数据');
        const asset = await api.resource(version.json_url);
        const slices = extractSlices(JSON.parse(asset.bytes.toString('utf8')));
        const offset = args.offset ?? 0, limit = args.limit ?? 500;
        return { slices: slices.slice(offset, offset + limit), total_slices: slices.length, next_offset: offset + limit < slices.length ? offset + limit : null };
      }
      default: throw new Error('接口不存在');
    }
  };
}
