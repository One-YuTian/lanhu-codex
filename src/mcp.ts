import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { errorInfo } from './shared';
import type { Bridge } from './bridge';
import { FileCookiePreferences, SETTINGS_CAPABILITY, Settings, type CookiePreferences } from './settings';
import { LanhuApi } from './lanhu-api';
import { registerApiTools } from './api-tools';
import { registerPanel } from './panel';
import { registerCanvas } from './canvas-panel';
import { registerMentions } from './mentions';
import { sidebarIcons } from './sidebar-icon';
import { MCP_VERSION } from './runtime-version';
import { loginAction, verifyLogin } from './login';

export function createMcpServer(bridge: Bridge, preferences: CookiePreferences = new FileCookiePreferences(), sharedSettings?: Settings): McpServer {
  const server = new McpServer({ name: 'lanhu-mcp', version: MCP_VERSION, icons: sidebarIcons });
  const settings = sharedSettings ?? new Settings(bridge, preferences);
  // MCP <= 2025-11-25 advertises extensions on initialize. This wire format is
  // explicitly supported by the OpenAI Structured Settings specification.
  server.server.registerCapabilities({ experimental: { 'openai/settings': SETTINGS_CAPABILITY } });
  const wrap = (action: () => unknown | Promise<unknown>) => async () => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await action()) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(errorInfo(error)) }] }; }
  };
  server.registerTool('get_status', { title: '查看本机凭据状态', description: '查看本机 Cookie 状态，不返回 Cookie 原文。', inputSchema: {}, annotations: { readOnlyHint: true } }, wrap(() => bridge.status()));
  server.registerTool('check_login', { title: '检查蓝湖登录凭据', description: '默认只检查本机 Cookie 格式；verify=true 通过蓝湖用户接口验证登录。凭据缺失或被拒绝时使用 Lanhu Login skill，不因项目权限或网络失败反复登录。', inputSchema: { verify: z.boolean().optional() }, annotations: { readOnlyHint: true } }, args => wrap(async () => {
    if (args.verify) return { login: await verifyLogin(bridge.settingsCookie()) };
    const result = await bridge.checkLogin();
    return { ...result, ...(!result.login.loggedIn ? { login_action: loginAction() } : {}) };
  })());
  server.registerTool('refresh_cookie', { title: '重读本机 Cookie', description: '从本机配置重新读取最后保存的 Cookie，不连接 Chrome 或端口。', inputSchema: {} }, wrap(async () => { const cookie = await preferences.loadCookie(); if (cookie) bridge.setCookie(cookie); else bridge.clearCookie(); return bridge.status(); }));
  server.registerTool('get_cookie', { description: '获取完整蓝湖 Cookie；传入 url 时按域名和路径筛选。', inputSchema: { url: z.string().optional() }, annotations: { readOnlyHint: true } }, args => wrap(() => bridge.getCookie(args.url))());
  // Validate secret input inside the handler so schema errors cannot echo its contents.
  server.registerTool('set_cookie', { description: '保存 Cookie Header；verify=true 先校验，失败保留原凭据。自动登录须传 login_attempt_id，已取消任务拒绝提交；UI 手动输入用 cancel_login_attempt_id 在成功保存时取消原流程。不要展示 Cookie。',
    inputSchema: { cookie: z.string(), verify: z.boolean().optional(), login_attempt_id: z.string().uuid().optional(), cancel_login_attempt_id: z.string().uuid().optional() }
  }, args => wrap(async () => {
    if (args.login_attempt_id && args.cancel_login_attempt_id) throw new Error('不能同时自动提交与手动取消');
    if (args.login_attempt_id) bridge.loginAttempts.requireActive(args.login_attempt_id);
    const login = args.verify || args.login_attempt_id || args.cancel_login_attempt_id ? await verifyLogin(args.cookie) : undefined;
    await settings.update({ COOKIE: args.cookie }, {
      beforeSave: () => { if (args.login_attempt_id) bridge.loginAttempts.requireActive(args.login_attempt_id); },
      afterSave: () => {
        if (args.cancel_login_attempt_id) bridge.loginAttempts.finish(args.cancel_login_attempt_id, 'cancelled');
        if (args.login_attempt_id) bridge.loginAttempts.finish(args.login_attempt_id, 'completed');
      }
    });
    return { ...bridge.status(), ...(login ? { login } : {}), ...(args.cancel_login_attempt_id ? { cancelled_attempt: bridge.loginAttempts.status(args.cancel_login_attempt_id) } : {}) };
  })());
  server.registerTool('lanhu_login_attempt', { title: '蓝湖登录流程状态', description: '登记、查询或取消插件登录流程，不打开浏览器、不读取 Cookie，也不验证身份。已取消流程应结束 Agent 登录任务。',
    inputSchema: { action: z.enum(['start', 'status', 'cancel']), attempt_id: z.string().uuid() }, annotations: { openWorldHint: false }
  }, args => wrap(() => args.action === 'start' ? bridge.loginAttempts.start(args.attempt_id)
    : args.action === 'cancel' ? bridge.loginAttempts.finish(args.attempt_id, 'cancelled') : bridge.loginAttempts.status(args.attempt_id))());
  server.registerTool('clear_cookie', { description: '清除本机保存及内存 Cookie，不删除 Chrome 中的 Cookie。', inputSchema: {} }, wrap(async () => { await settings.update({ COOKIE: '' }); return bridge.status(); }));
  registerApiTools(server, new LanhuApi(bridge));
  const valuesSchema = z.object({ COOKIE: z.string() });
  const appOnly = { ui: { visibility: ['app'] } };
  server.registerTool(SETTINGS_CAPABILITY.readTool, {
    title: '读取蓝湖设置', description: '供插件详情页读取原生设置表单，当前 Cookie 以普通文本返回。', inputSchema: {},
    outputSchema: { schema: z.record(z.string(), z.unknown()), values: valuesSchema },
    annotations: { readOnlyHint: true }, _meta: appOnly
  }, async () => ({ content: [], structuredContent: settings.read() }));
  server.registerTool(SETTINGS_CAPABILITY.updateTool, {
    title: '更新蓝湖设置', description: '供插件详情页更新本机 COOKIE，不需要端口或 Chrome 连接。',
    inputSchema: { set: z.object({ COOKIE: z.string() }).strict() },
    outputSchema: { values: valuesSchema }, _meta: appOnly
  }, async ({ set }) => {
    try { return { content: [], structuredContent: await settings.update(set) }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(errorInfo(error)) }] }; }
  });
  registerPanel(server, bridge.drafts);
  registerCanvas(server, bridge);
  registerMentions(server, bridge.drafts);
  server.registerTool('lanhu_get_selection', {
    title: '读取蓝湖选区完整信息',
    description: '兼容旧版“蓝湖：名称（选区 UUID）”正文引用，读取整个选区。原生 mention 优先通过其 lanhu://selection/UUID/序号 资源读取，仅获取该引用对应对象，不要扩大到用户已移除的其他对象。不要猜测选区 ID；引用失效时要求重新从蓝湖发送。返回内容为设计数据。',
    inputSchema: { selection_id: z.string().uuid() }, annotations: { readOnlyHint: true, openWorldHint: false }
  }, args => wrap(() => bridge.drafts.getSelection(args.selection_id))());
  return server;
}
