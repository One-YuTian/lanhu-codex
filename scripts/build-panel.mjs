import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
export async function buildPanel() {
  const base = new URL('../', import.meta.url);
  const root = fileURLToPath(base);
  const output = await build({ absWorkingDir: root, entryPoints: ['panel/main.ts'], bundle: true,
    write: false, format: 'iife', platform: 'browser', target: 'chrome119', minify: true, legalComments: 'none' });
  const template = await readFile(new URL('panel/index.html', base), 'utf8');
  const css = await readFile(new URL('node_modules/@openai/mcp-extensions/styles.css', base), 'utf8');
  // Replacement strings interpret $&, $` and $' inside bundled dependencies.
  // Callbacks insert their contents literally, keeping SDK source intact.
  const script = output.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  new Script(script, { filename: 'lanhu-receiver.js' });
  const html = template.replace('/* STYLES */', () => css).replace('/* SCRIPT */', () => script);
  await mkdir(new URL('package/', base), { recursive: true });
  await writeFile(new URL('package/panel.html', base), html);
  const canvas = await build({ absWorkingDir: root, entryPoints: ['panel/canvas.ts'], bundle: true,
    write: false, format: 'iife', platform: 'browser', target: 'chrome119', minify: true, legalComments: 'none' });
  const canvasScript = canvas.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  new Script(canvasScript, { filename: 'lanhu-canvas.js' });
  const webRoot = new URL('panel/canvas/', base);
  let canvasHtml = await readFile(new URL('index.html', webRoot), 'utf8');
  const sheets = await Promise.all(['style.css', 'panels.css', 'ui/tokens.css', 'ui/styles.css', 'annotations.css'].map(file => readFile(new URL(file, webRoot), 'utf8')));
  const styles = sheets.join('\n').replace(/@import\s+url\([^)]*\);/g, '');
  const logo = `data:image/svg+xml;base64,${(await readFile(new URL('lanhu-logo.svg', webRoot))).toString('base64')}`;
  const panelIcon = `data:image/png;base64,${(await readFile(new URL('assets/logo.png', base))).toString('base64')}`;
  const sources = await Promise.all(['app.js', 'project-manager.js', 'project-picker.js', 'clipboard-project.js', 'interface-events.js', 'lanhu-links.js', 'model.js', 'icons.js', 'inspector.js', 'annotation-ui.js', 'ui/components.js'].map(file => readFile(new URL(file, webRoot), 'utf8')));
  const names = new Set([...`${canvasHtml}\n${sources.join('\n')}`.matchAll(/['"]([\w-]+)['"]/g)].map(match => match[1]));
  const sprite = await readFile(new URL('icons/lucide.svg', webRoot), 'utf8');
  const symbols = [...sprite.matchAll(/<symbol id="([^"]+)"[^>]*>[\s\S]*?<\/symbol>/g)].filter(match => names.has(match[1])).map(match => match[0].replace(`id="${match[1]}"`, `id="lh-icon-${match[1]}"`)).join('');
  canvasHtml = canvasHtml.replace(/<link\b[^>]*>/g, '').replace(/<script\b[^>]*src="\/app.js"[^>]*><\/script>/, '')
    .replace('src="/lanhu-logo.svg"', `src="${logo}"`)
    .replace('</head>', () => `<link rel="icon" type="image/png" href="${panelIcon}"><style>${styles}\nhtml,body{width:100vw;height:100vh}</style></head>`)
    .replace('<body>', () => `<body><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden"><defs>${symbols}</defs></svg>`)
    .replace('</body>', () => `<script>${canvasScript}</script></body>`);
  await writeFile(new URL('package/canvas.html', base), canvasHtml);
}
