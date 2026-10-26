import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Bridge } from './bridge';
import { createMcpServer } from './mcp';
import { FileCookiePreferences } from './settings';
import { connectSharedBridge, serveSharedBridge } from './shared-service';

const startupOptions = {
  cookie: process.env.COOKIE
};
async function standalone() {
  const bridge = new Bridge(startupOptions);
  const preferences = new FileCookiePreferences();
  const server = createMcpServer(bridge, preferences);
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await bridge.close();
    await server.close();
  }
  process.on('SIGINT', () => { void stop(); });
  process.on('SIGTERM', () => { void stop(); });
  process.stdin.on('end', () => { void stop(); });
  process.on('uncaughtException', () => { console.error('lanhu-mcp: 未处理的运行错误'); void stop().finally(() => { process.exitCode = 1; }); });
  process.on('unhandledRejection', () => { console.error('lanhu-mcp: 异步运行错误'); void stop().finally(() => { process.exitCode = 1; }); });
  async function main() {
    const savedCookie = await preferences.loadCookie();
    if (!startupOptions.cookie?.trim() && savedCookie) bridge.setCookie(savedCookie);
    console.error('lanhu-mcp: 本地 stdio 模式，无 HTTP/WebSocket 监听');
    await server.connect(new StdioServerTransport());
  }
  await main().catch(() => { console.error('lanhu-mcp: 启动失败'); void stop(); process.exitCode = 1; });
}
const run = process.argv.some(arg => ['--ui', '--http', '--port'].includes(arg) || arg.startsWith('--port=')) ? async () => { throw new Error('HTTP/WebSocket 服务已移除，请使用 Codex 插件面板'); }
  : process.argv.includes('--bridge-service') ? () => serveSharedBridge()
  : /[\\/]dist[\\/]dev[\\/]/.test(process.argv[1]) ? standalone : connectSharedBridge;
void run().catch(() => { console.error('lanhu-mcp: 本地服务启动失败'); process.exitCode = 1; });
