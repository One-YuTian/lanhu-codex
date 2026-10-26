import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const json = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const manifest = await json('plugin.json');
const pkg = await json('package.json');
const overlay = await json('.codex-plugin/plugin.json');
const mcp = (await json('mcp.json')).mcpServers.lanhu;
const legacy = (await json('.mcp.json')).mcpServers.lanhu;
const marketplace = await json('.agents/plugins/marketplace.json');
assert.equal(pkg.version, manifest.version);
assert.equal(overlay.version, manifest.version);
assert.equal(overlay.name, manifest.name);
assert.deepEqual(overlay.interface, manifest.extensions['com.openai'].interface);
assert(overlay.interface.shortDescription.length <= 30);
assert.equal(marketplace.plugins[0].name, manifest.name);
assert.equal(path.resolve(root, marketplace.plugins[0].source.path), root);
assert.equal(mcp.command, 'node');
assert.deepEqual(mcp.env, { COOKIE: '' });
const { type, ...portable } = mcp;
assert.equal(type, 'stdio');
assert.deepEqual(legacy, portable);
for (const file of [overlay.interface.logo, overlay.interface.composerIcon, 'dist/index.cjs', 'dist/panel.html', 'dist/canvas.html']) {
  assert((await readFile(path.resolve(root, file))).length > 0);
}
for (const file of ['panel.html', 'canvas.html']) {
  const html = await readFile(path.join(root, 'dist', file), 'utf8');
  assert(!html.includes('/* SCRIPT */'));
  assert(!/<script\b[^>]*\bsrc=/.test(html));
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Script(match[1]);
}

// Exercise a relocated runtime without source, pnpm or node_modules.
const cache = path.join(root, '.cache');
await mkdir(cache, { recursive: true });
const temporary = await mkdtemp(path.join(cache, 'plugin-check-'));
const client = new Client({ name: 'lanhu-portability-check', version: '1.0.0' });
try {
  for (const file of ['dist/index.cjs', 'dist/panel.html', 'dist/canvas.html', 'assets', 'skills']) {
    await mkdir(path.dirname(path.join(temporary, file)), { recursive: true });
    await cp(path.join(root, file), path.join(temporary, file), { recursive: true });
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: mcp.args.map(value => value.replaceAll('${PLUGIN_ROOT}', temporary)),
    cwd: temporary, stderr: 'pipe',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)), COOKIE: '', PLUGIN_DATA: path.join(temporary, 'data') }
  });
  await client.connect(transport);
  const tools = await client.listTools();
  for (const name of ['get_status', 'check_login', 'lanhu_open_canvas', 'lanhu_get_elements', 'lanhu_get_design_slices']) {
    assert(tools.tools.some(tool => tool.name === name), `Missing tool: ${name}`);
  }
  assert.equal((await client.callTool({ name: 'get_status', arguments: {} })).isError, undefined);
  const resources = await client.listResources();
  for (const resource of resources.resources.filter(value => value.mimeType?.startsWith('text/html'))) {
    const response = await client.readResource({ uri: resource.uri });
    assert(response.contents.some(value => typeof value.text === 'string' && value.text.includes('<html')));
  }
  console.log(`Plugin verified: ${manifest.name}@${manifest.version}, ${tools.tools.length} tools; relocated runtime and UI resources work without dependencies.`);
} finally {
  await client.close();
  // Shared service exits after its final client disconnects.
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      assert.equal(path.dirname(temporary), cache);
      await rm(temporary, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 14) throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}
