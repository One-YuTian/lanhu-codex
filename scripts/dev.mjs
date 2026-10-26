import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';
import { buildOptions } from './build-options.mjs';

// One watcher owns one child. Keep stdout exclusively for the child's MCP frames.
const output = fileURLToPath(new URL('../dist/dev/index.cjs', import.meta.url));
let child;
let stopping = false;
let queue = Promise.resolve();
let ctx;
async function stopChild() {
  const current = child;
  child = undefined;
  if (!current || current.exitCode !== null || current.signalCode !== null) return;
  process.stdin.unpipe(current.stdin);
  const exited = once(current, 'exit');

  current.stdin.end();
  const deadline = setTimeout(() => current.kill('SIGKILL'), 2000);
  await exited;
  clearTimeout(deadline);
}
async function restart() {
  if (stopping) return;
  await stopChild();
  if (stopping) return;
  const next = spawn(process.execPath, [output], {
    cwd: buildOptions.absWorkingDir, env: process.env, windowsHide: true,
    stdio: ['pipe', 'inherit', 'inherit']
  });
  child = next;
  next.stdin.on('error', () => { /* A closing child may reject an in-flight write. */ });
  next.on('error', () => console.error('lanhu-mcp dev: 服务进程启动失败'));
  next.on('exit', () => {
    process.stdin.unpipe(next.stdin);
    if (child === next) {
      child = undefined;
      console.error('lanhu-mcp dev: 服务已退出，下一次成功构建将重启');
    }
  });
  process.stdin.pipe(next.stdin, { end: false });
  console.error(`lanhu-mcp dev: 服务已重启，PID ${next.pid}；stdio 客户端必要时需重新连接`);
}
async function stop() {
  if (stopping) return;
  stopping = true;
  await ctx?.dispose();
  await queue;
  await stopChild();
  process.stdin.pause();
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
process.stdin.on('end', () => { void stop(); });
try {
  ctx = await context({ ...buildOptions, outfile: output, logLevel: 'silent', plugins: [{
    name: 'restart-after-success', setup(build) {
      build.onEnd(result => {
        if (result.errors.length) {
          // Do not echo source lines, since development source may contain secrets.
          console.error('lanhu-mcp dev: 构建失败，保留当前服务；修复源码后自动重试');
          return;
        }
        queue = queue.then(restart).catch(() => console.error('lanhu-mcp dev: 重启失败，请修复后重新保存源码'));
        return queue;
      });
    }
  }] });
  if (stopping) await ctx.dispose();
  else { await ctx.watch(); console.error('lanhu-mcp dev: 正在监听 MCP 与共享协议源码'); }
} catch {
  console.error('lanhu-mcp dev: 无法启动开发监听');
  process.exitCode = 1;
  await stop();
}
