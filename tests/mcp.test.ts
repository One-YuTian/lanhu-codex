import { afterEach, expect, it } from 'vitest';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { reserve } from './helpers';
import { API_TOOL_NAMES } from '../src/api-tools';
import { MCP_VERSION } from '../src/runtime-version';
import { bridgeAddress } from '../src/shared-service';

const clients: Client[] = [], directories: string[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()));
  await new Promise(resolve => setTimeout(resolve, 1200));
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== tmpdir() || !path.basename(directory).startsWith('lanhu-stdio-')) throw new Error('Unsafe cleanup');
    await rm(directory, { recursive: true, force: true });
  }
});
async function connect(cookie = '', directory?: string, port = '19989') {
  const data = directory ?? await mkdtemp(path.join(tmpdir(), 'lanhu-stdio-'));
  if (!directory) directories.push(data);
  const client = new Client({ name: 'local-cookie-test', version: '1' }); clients.push(client);
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('package/index.cjs')], cwd: process.cwd(),
    env: { ...process.env, COOKIE: cookie, PORT: port, PLUGIN_DATA: data } as Record<string, string>, stderr: 'pipe' }));
  return { client, data };
}
async function call(client: Client, name: string, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  let value: unknown;
  try { if (result.content?.[0]?.type === 'text') value = JSON.parse(result.content[0].text); } catch {}
  return { ...result, value };
}
it('构建产物无端口工具及 PORT 设置，即使环境端口被占用也能正常使用全部本地工具', async () => {
  const held = await reserve();
  try {
    const { client } = await connect('session=private-fixture', undefined, String(held.port));
    expect(client.getServerVersion()?.version).toBe(MCP_VERSION);
    expect(client.getServerCapabilities()?.experimental).not.toHaveProperty('openai/mentions');
    const tools = (await client.listTools()).tools;
    expect(tools.map(tool => tool.name)).toEqual(expect.arrayContaining([...API_TOOL_NAMES, 'lanhu_prepare_annotations']));
    for (const name of ['set_port', 'set_cookie_mode', 'open_login', 'lanhu_open_receiver', 'lanhu_receiver_poll', 'lanhu_receiver_ack', 'lanhu_receiver_close', 'lanhu_login_attempt', 'lanhu_search_mentions']) expect(tools.some(tool => tool.name === name)).toBe(false);
    const status = await call(client, 'get_status');
    expect(status.value).not.toHaveProperty('actualPort'); expect(JSON.stringify(status)).not.toContain('private-fixture');
    expect((await call(client, 'get_cookie')).value.cookie).toBe('session=private-fixture');
    const settings = await call(client, 'settings_read');
    expect(Object.keys((settings.structuredContent as any).schema.properties)).toEqual(['COOKIE']);
    expect((await call(client, 'settings_update', { set: { PORT: held.port } })).isError).toBe(true);
    expect((await call(client, 'lanhu_get_project', { project_id: 'p' })).value.code).toBe('LOGIN_REQUIRED');
  } finally { await held.close(); }
});
it('多个 stdio 会话通过本地私有管道共享 Cookie，退出后从配置恢复，Chrome 不参与', async () => {
  const { client: first, data } = await connect();
  await call(first, 'set_cookie', { cookie: 'session=persisted-fixture' });
  const { client: second } = await connect('', data);
  expect((await call(second, 'get_cookie')).value.cookie).toBe('session=persisted-fixture');
  await first.close();
  expect((await call(second, 'get_cookie')).value.cookie).toBe('session=persisted-fixture');
  await second.close(); await new Promise(resolve => setTimeout(resolve, 1400));
  const { client: third } = await connect('', data);
  expect((await call(third, 'get_cookie')).value.cookie).toBe('session=persisted-fixture');
  expect(JSON.parse(await readFile(path.join(data, 'settings.json'), 'utf8'))).toEqual({ version: 2, COOKIE: 'session=persisted-fixture' });
  await writeFile(path.join(data, 'settings.json'), JSON.stringify({ version: 2, COOKIE: 'session=external-update' }));
  await call(third, 'refresh_cookie');
  expect((await call(third, 'get_cookie')).value.cookie).toBe('session=external-update');
  await call(third, 'clear_cookie'); expect((await call(third, 'get_status')).value.hasCookie).toBe(false);
});
it('宿主长数据目录下反复连接保留版本隔离，退出清理 socket，不阻断下一次 UI 初始化', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'lanhu-stdio-')); directories.push(base);
  const data = path.join(base, 'plugins', 'data', 'agent-plugins', 'a'.repeat(64));
  await mkdir(data, { recursive: true });
  expect(Buffer.byteLength(path.join(data, `bridge-v${MCP_VERSION.replaceAll('.', '-')}.sock`))).toBeGreaterThan(104);
  const address = bridgeAddress(data);
  for (let cycle = 0; cycle < 3; cycle++) {
    const { client } = await connect('', data);
    expect(client.getServerVersion()?.version).toBe(MCP_VERSION);
    const tools = (await client.listTools()).tools;
    expect(tools.some(tool => tool.name === 'lanhu_open_canvas')).toBe(true);
    const resources = (await client.listResources()).resources;
    const canvas = resources.find(resource => resource.name === 'lanhu-canvas')!;
    expect((await client.readResource({ uri: canvas.uri })).contents[0].text).toContain('id="viewport"');
    if (process.platform !== 'win32') {
      expect(Buffer.byteLength(address)).toBeLessThan(104);
      expect((await lstat(path.dirname(address))).mode & 0o077).toBe(0);
      expect((await lstat(address)).isSocket()).toBe(true);
    }
    await client.close(); await new Promise(resolve => setTimeout(resolve, 1400));
    if (process.platform !== 'win32') await expect(lstat(address)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}, 20000);
it('每条标注都是独立带标题资源，超过三条亦可读取，资源不会混入其他指令', async () => {
  const { client } = await connect();
  const items = Array.from({ length: 5 }, (_, index) => ({ title: `标注 ${index + 1}`, prompt: JSON.stringify({ comment: `修改 ${index + 1}`, object_id: `layer-${index}`, path: '分组 / 画板 / 图层' }) }));
  const prepared = await call(client, 'lanhu_prepare_annotations', { items });
  expect(prepared.content).toEqual([]);
  const links = prepared._meta!['lanhu/annotationLinks'] as any[];
  expect(links).toHaveLength(5);
  for (const [index, link] of links.entries()) {
    expect(link).toMatchObject({ type: 'resource_link', title: items[index].title, name: items[index].title });
    const resource = await client.readResource({ uri: link.uri });
    const content = JSON.parse(resource.contents[0].text as string);
    expect(content.prompt).toBe(items[index].prompt); expect(content).not.toHaveProperty('items');
  }
  expect((await call(client, 'lanhu_prepare_annotations', { items: [{ title: '无内容', prompt: ' ' }] })).isError).toBe(true);
});
it('生产清单不声明 PORT，旧 HTTP 启动参数明确拒绝', async () => {
  const config = JSON.parse(await readFile('mcp.json', 'utf8')).mcpServers.lanhu;
  expect(config.env).toEqual({ COOKIE: '' });
  const client = new Client({ name: 'removed-http', version: '1' }); clients.push(client);
  await expect(client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('package/index.cjs'), '--http'], stderr: 'pipe' }))).rejects.toThrow();
});
