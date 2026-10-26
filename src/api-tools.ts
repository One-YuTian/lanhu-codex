import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AppError, errorInfo } from './shared';
import { LanhuApi, parseLanhuLink } from './lanhu-api';
import { compactToolOutput, designElements } from './tool-output';

export const API_TOOL_NAMES = ['lanhu_parse_url', 'lanhu_get_project', 'lanhu_get_project_documents', 'lanhu_get_design',
  'lanhu_get_project_images', 'lanhu_get_project_sectors', 'lanhu_get_design_schema', 'lanhu_list_product_documents',
  'lanhu_get_designs', 'lanhu_get_design_slices', 'lanhu_get_elements', 'lanhu_get_resource'] as const;

export function registerApiTools(server: McpServer, api: LanhuApi) {
  const id = z.string().trim().min(1).max(256).regex(/^[\w-]+$/);
  const project = { project_id: id.describe('项目 ID（链接中的 pid）'), team_id: id.optional().describe('团队 ID（链接中的 tid）') };
  const pagination = { offset: z.number().int().min(0).max(1_000_000).optional(), limit: z.number().int().min(1).max(500).optional() };
  const flag = z.union([z.literal(0), z.literal(1)]).optional();
  const rawOption = { raw: z.boolean().optional().describe('仅排查兼容问题时返回未过滤的上游字段；默认精简') };
  const wrap = (action: () => unknown | Promise<unknown>, raw = false) => async () => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(raw ? await action() : compactToolOutput(await action())) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(errorInfo(error)) }] }; }
  };
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
  const auth = '使用本机配置中最后保存的 Cookie，由 Node 直接请求蓝湖，不连接 Chrome 或本机 HTTP 代理；凭据失效时请在设置中更新 COOKIE。';
  server.registerTool('lanhu_parse_url', { title: '解析蓝湖链接', description: '本地解析蓝湖 URL 或查询参数，提取项目、团队、设计稿/文档、版本和页面 ID；不联网。',
    inputSchema: { url: z.string().min(1).max(8192) }, annotations: { readOnlyHint: true, openWorldHint: false } }, args => wrap(() => parseLanhuLink(args.url))());
  server.registerTool('lanhu_get_project', { title: '读取项目综合信息', description: '对应 GET /api/project/multi_info，返回精简项目、文档及版本信息，raw=true 可取原文。' + auth,
    inputSchema: { ...project, ...rawOption, doc_info: flag, detach: flag, img_limit: z.number().int().min(1).max(5000).optional() }, annotations }, ({ raw, ...args }) => wrap(() => api.project(args), raw)());
  server.registerTool('lanhu_get_project_documents', { title: '读取原始产品文档', description: '对应 GET /api/project/product_documents，默认过滤编辑器冗余及协作元数据，raw=true 可取原文。' + auth,
    inputSchema: { ...project, team_id: id, ...rawOption }, annotations }, ({ raw, ...args }) => wrap(() => api.documents(args), raw)());
  server.registerTool('lanhu_get_design', { title: '读取设计稿详情', description: '对应 GET /api/project/image，返回精简详情及版本 json_url，raw=true 可取原文；project_id 自动映射为上游 pid。' + auth,
    inputSchema: { ...project, ...rawOption, image_id: id, dds_status: flag }, annotations }, ({ raw, ...args }) => wrap(() => api.design(args), raw)());
  server.registerTool('lanhu_get_project_images', { title: '读取原始设计稿列表', description: '对应 GET /api/project/images，默认过滤编辑器冗余及协作元数据，raw=true 可取原文；通常优先使用精简的 lanhu_get_designs。' + auth,
    inputSchema: { ...project, ...rawOption, dds_status: flag, position: flag, show_cb_src: flag, comment: flag }, annotations }, ({ raw, ...args }) => wrap(() => api.designs(args), raw)());
  server.registerTool('lanhu_get_project_sectors', { title: '读取设计稿分组', description: '对应 GET /api/project/project_sectors，返回精简分组层级与设计稿关系，raw=true 可取原文。' + auth,
    inputSchema: { project_id: id, ...rawOption }, annotations }, ({ raw, ...args }) => wrap(() => api.sectors(args.project_id), raw)());
  server.registerTool('lanhu_get_design_schema', { title: '读取 DDS 设计数据', description: '对应 dds.lanhuapp.com 的 GET /api/dds/image/store_schema_revise，输入设计稿版本 ID，返回布局/样式数据，过滤编辑器冗余字段，raw=true 可取原文。' + auth,
    inputSchema: { version_id: id, ...rawOption }, annotations }, ({ raw, ...args }) => wrap(() => api.schema(args.version_id), raw)());
  server.registerTool('lanhu_list_product_documents', { title: '列出产品文档', description: '精简产品文档为名称、ID、类型、大小、更新时间、最新版本与打开链接。默认返回 100 条，next_offset 非空时可继续读取。' + auth,
    inputSchema: { ...project, team_id: id, ...pagination }, annotations }, args => wrap(() => api.listDocuments(args))());
  server.registerTool('lanhu_get_designs', { title: '列出设计稿及分组', description: '合并设计稿列表和分组，返回尺寸、预览 URL、分组路径和更新时间；分组失败会报告警告。默认返回 100 条，可用 offset/limit 继续读取。' + auth,
    inputSchema: { ...project, ...pagination }, annotations }, args => wrap(() => api.listDesigns(args))());
  server.registerTool('lanhu_get_design_slices', { title: '读取设计稿切图', description: '读取最新版本设计 JSON 中的可导出图层（含 info、board、layers、children 及 isAsset），返回边界、原图及 Web/iOS/Android 倍率 URL；默认返回 100 条，可分页。' + auth,
    inputSchema: { ...project, image_id: id, ...pagination }, annotations }, args => wrap(() => api.slices(args))());
  server.registerTool('lanhu_get_elements', { title: '按标注读取页面元素',
    description: '按 project_id/image_id 获取设计 JSON 中的元素。object_ids 对应标注的 id，逐项精确匹配，仅返回目标自身（不展开子树）、父 ID、位置、文字、样式及资源地址；不传时分页列出。missing_ids 表示未找到，不能用其他对象替代。默认最新版本，可指定 version_id。' + auth,
    inputSchema: { ...project, image_id: id, version_id: id.optional(), object_ids: z.array(id).min(1).max(200).optional(), ...pagination }, annotations
  }, args => wrap(async () => {
    const detail = await api.design({ project_id: args.project_id, team_id: args.team_id, image_id: args.image_id });
    const body = detail.data ?? detail.result ?? detail;
    const versions = Array.isArray(body.versions) ? body.versions : [];
    const version = args.version_id ? versions.find((item: any) => String(item.id ?? item.version_id) === args.version_id) : versions[0];
    if (!version?.json_url) throw new AppError('DESIGN_DATA_MISSING', '指定设计版本没有可读取的 json_url');
    const { bytes } = await api.resource(version.json_url);
    let source: unknown;
    try { source = JSON.parse(bytes.toString('utf8')); }
    catch { throw new AppError('INVALID_DESIGN_DATA', '设计资源不是有效 JSON'); }
    const { elements, missing_ids } = designElements(source, args.object_ids);
    const offset = args.offset ?? 0, limit = args.limit ?? 100;
    return { image_id: args.image_id, version_id: version.id ?? version.version_id,
      total_elements: elements.length, offset, limit, next_offset: offset + limit < elements.length ? offset + limit : null,
      missing_ids, elements: elements.slice(offset, offset + limit) };
  })());
  server.registerTool('lanhu_get_resource', { title: '读取蓝湖静态资源', description: '通过 Referer 代理读取蓝湖静态资源，返回 JSON/文本、图片或内嵌二进制资源。JSON 默认过滤编辑器冗余及协作元数据，raw=true 可取原文；读取指定元素优先 lanhu_get_elements。最多 8 MiB；不携带 Cookie，不跟随重定向。',
    inputSchema: { target_url: z.string().min(1).max(8192), ...rawOption }, annotations: { readOnlyHint: true, openWorldHint: true } }, async args => {
    try {
      const { url, bytes, mimeType } = await api.resource(args.target_url);
      if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType))
        return { content: [{ type: 'image' as const, mimeType, data: bytes.toString('base64') }] };
      if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType.endsWith('+json')) {
        let text = bytes.toString('utf8');
        if (!args.raw) {
          try { text = JSON.stringify(compactToolOutput(JSON.parse(text))); } catch { /* Preserve non-JSON text. */ }
        }
        return { content: [{ type: 'resource' as const, resource: { uri: url, mimeType, text } }] };
      }
      return { content: [{ type: 'resource' as const, resource: { uri: url, mimeType, blob: bytes.toString('base64') } }] };
    } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(errorInfo(error)) }] }; }
  });
}
