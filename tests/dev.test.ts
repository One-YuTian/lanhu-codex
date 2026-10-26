import { afterEach, expect, it, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { freePort } from './helpers';

let child: ChildProcessWithoutNullStreams | undefined;
let directory: string | undefined;
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.stdin.end();
    const timer = setTimeout(() => child?.kill('SIGKILL'), 4000);
    await exited; clearTimeout(timer);
  }
  if (directory) {
    if (path.dirname(directory) !== path.resolve('.cache') || !path.basename(directory).startsWith('dev-test-')) throw new Error('Unsafe test cleanup');
    await rm(directory, { recursive: true, force: true });
  }
  child = undefined; directory = undefined;
});

it('dev 监听依赖变更自动重启；编译错误保留服务，恢复后重建本地 stdio', async () => {
  await mkdir('.cache', { recursive: true });
  directory = await mkdtemp(path.resolve('.cache/dev-test-'));
  await mkdir(path.join(directory, 'assets'));
  await mkdir(path.join(directory, 'scripts'));
  await copyFile('assets/sidebar-icon.png', path.join(directory, 'assets/sidebar-icon.png'));
  await copyFile('assets/sidebar-icon-active.png', path.join(directory, 'assets/sidebar-icon-active.png'));
  await copyFile('assets/logo.png', path.join(directory, 'assets/logo.png'));
  const source = path.join(directory, 'fixture.ts');
  const dependency = path.join(directory, 'dependency.ts');
  const runtime = path.resolve('src/index.ts').replaceAll('\\', '/');
  await copyFile('scripts/dev.mjs', path.join(directory, 'scripts/dev.mjs'));
  await writeFile(path.join(directory, 'scripts/build-options.mjs'), `export const buildOptions = {
    absWorkingDir: ${JSON.stringify(directory)}, entryPoints: ['fixture.ts'], bundle: true,
    platform: 'node', target: 'node20', format: 'cjs', packages: 'bundle',
    external: ['bufferutil','utf-8-validate'] };`);
  await writeFile(source, `import ${JSON.stringify(runtime)}; import { marker } from './dependency'; console.error(marker);`);
  await writeFile(dependency, 'export const marker = "fixture-v1";');
  const port = await freePort();
  child = spawn(process.execPath, [path.join(directory, 'scripts/dev.mjs')], {
    env: { ...process.env, PORT: String(port), COOKIE: '', PLUGIN_DATA: directory }, windowsHide: true, stdio: 'pipe'
  });
  let logs = '';
  child.stderr.on('data', data => { logs += data.toString(); });
  child.stdout.resume();
  const ready = async (marker: string, count: number) => {
    await vi.waitFor(() => {
      expect(logs).toContain(marker);
      expect((logs.match(/lanhu-mcp: 本地 stdio 模式/g) ?? []).length).toBe(count);
    }, { timeout: 6000 });
  };
  await ready('fixture-v1', 1);
  await writeFile(dependency, 'export const marker = "fixture-v2";');
  await ready('fixture-v2', 2);
  const restartCount = (logs.match(/服务已重启/g) ?? []).length;
  await writeFile(dependency, 'export const marker = ;');
  await vi.waitFor(() => expect(logs).toContain('构建失败，保留当前服务'), { timeout: 6000 });
  expect((logs.match(/服务已重启/g) ?? []).length).toBe(restartCount);
  await writeFile(dependency, 'export const marker = "fixture-v3";');
  await ready('fixture-v3', 3);
  expect(await readFile(path.join(directory, 'package/dev/index.cjs'), 'utf8')).toContain('fixture-v3');
}, 25000);
