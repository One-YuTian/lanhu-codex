import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

it.skipIf(process.platform === 'win32')('桌面精简 PATH 下从 nvm 默认版本启动，路径含空格且 stdout 仅包含协议输出', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lanhu launch ')); directories.push(dir);
  await mkdir(path.join(dir, 'scripts'));
  await mkdir(path.join(dir, 'package'));
  const nvm = path.join(dir, 'home/.nvm');
  await mkdir(path.join(nvm, 'bin'), { recursive: true });
  await symlink(process.execPath, path.join(nvm, 'bin/node'));
  await writeFile(path.join(nvm, 'nvm.sh'), 'nvm() { export PATH="$NVM_DIR/bin:$PATH"; echo "nvm initialized"; }\n');
  await copyFile('scripts/launch-mcp', path.join(dir, 'scripts/launch-mcp'));
  await chmod(path.join(dir, 'scripts/launch-mcp'), 0o755);
  await writeFile(path.join(dir, 'package/index.cjs'), 'console.log(JSON.stringify(process.argv.slice(2)))');
  // Set NVM_DIR explicitly so a developer's own nvm configuration is never read.
  const { stdout } = await run(path.join(dir, 'scripts/launch-mcp'), ['argument with spaces', '--fixture'], {
    env: { PATH: '/usr/bin:/bin', HOME: path.join(dir, 'home'), NVM_DIR: nvm }
  });
  expect(JSON.parse(stdout)).toEqual(['argument with spaces', '--fixture']);
});

it.skipIf(process.platform === 'win32')('PATH 中已有可用 Node 时直接使用并原样传递参数', async () => {
  const { stdout, stderr } = await run(path.resolve('scripts/launch-mcp'), ['--ui'], {
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` }
  }).catch(error => ({ stdout: error.stdout, stderr: error.stderr }));
  expect(stdout).toBe('');
  // The server rejects this retired option; reaching it proves Node was started.
  expect(stderr).toContain('lanhu-mcp: 本地服务启动失败');
});
