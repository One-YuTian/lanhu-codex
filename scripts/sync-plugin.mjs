import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('plugin.json', root), 'utf8'));
const mcp = JSON.parse(await readFile(new URL('mcp.json', root), 'utf8'));
const overlay = {
  name: manifest.name, version: manifest.version, description: manifest.description,
  author: manifest.author, keywords: manifest.keywords,
  interface: manifest.extensions['com.openai'].interface,
  skills: './skills/', mcpServers: './.mcp.json'
};
const legacy = { mcpServers: Object.fromEntries(Object.entries(mcp.mcpServers).map(([name, value]) => {
  const { type, ...configuration } = value;
  return [name, configuration];
})) };
await mkdir(new URL('.codex-plugin/', root), { recursive: true });
for (const [file, value] of [['.codex-plugin/plugin.json', overlay], ['.mcp.json', legacy]]) {
  await writeFile(new URL(file, root), JSON.stringify(value, null, 2) + '\n');
}
