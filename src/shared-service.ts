import { createConnection, createServer, type Socket } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { homedir } from 'node:os';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { Bridge } from './bridge';
import { FileCookiePreferences, Settings, settingsFile } from './settings';
import { createMcpServer } from './mcp';
import { BRIDGE_RUNTIME } from './runtime-version';

export function bridgeAddress(directory: string, platform = process.platform, userId = process.getuid?.()) {
  const id = createHash('sha256').update(path.resolve(directory)).digest('hex').slice(0, 24);
  if (platform === 'win32') return `\\\\.\\pipe\\lanhu-${BRIDGE_RUNTIME}-${id}`;
  // Darwin truncates Unix socket addresses at 104 bytes. PLUGIN_DATA contains
  // long host-generated IDs, and even os.tmpdir() can be long on macOS. Keep
  // the complete address short so version isolation and unlink both work.
  return path.posix.join('/tmp', `lanhu-${userId}-${id}`, `${BRIDGE_RUNTIME}.sock`);
}

async function endpoint() {
  const directory = path.dirname(settingsFile());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const keyFile = path.join(directory, 'bridge-key');
  try { await writeFile(keyFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  let key = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    key = (await readFile(keyFile, 'utf8')).trim();
    if (/^[a-f0-9]{64}$/.test(key)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid local bridge key');
  const address = bridgeAddress(directory);
  if (process.platform !== 'win32') {
    const socketDirectory = path.dirname(address);
    try { await mkdir(socketDirectory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = await lstat(socketDirectory);
    if (!stat.isDirectory() || stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0)
      throw Object.assign(new Error('Unsafe local socket directory'), { code: 'LOCAL_BRIDGE_DIRECTORY_UNSAFE' });
  }
  return { address, key };
}

class PipeTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private buffer = new ReadBuffer();
  private authenticated = false;
  private authBuffer = Buffer.alloc(0);
  constructor(private socket: Socket, private key: string) {}
  async start() {
    const deadline = setTimeout(() => this.socket.destroy(), 3000);
    this.socket.on('close', () => { clearTimeout(deadline); this.onclose?.(); });
    this.socket.on('error', () => this.onerror?.(new Error('Local bridge connection failed')));
    this.socket.on('data', chunk => {
      try {
        if (!this.authenticated) {
          this.authBuffer = Buffer.concat([this.authBuffer, chunk]);
          const newline = this.authBuffer.indexOf(10);
          if (newline < 0) { if (this.authBuffer.length > 65) this.socket.destroy(); return; }
          if (this.authBuffer.subarray(0, newline).toString() !== this.key) { this.socket.destroy(); return; }
          this.authenticated = true; clearTimeout(deadline);
          chunk = this.authBuffer.subarray(newline + 1); this.authBuffer = Buffer.alloc(0);
        }
        this.buffer.append(chunk);
        let message: JSONRPCMessage | null;
        while ((message = this.buffer.readMessage()) !== null) this.onmessage?.(message);
      } catch { this.socket.destroy(); }
    });
    this.socket.resume();
  }
  async send(message: JSONRPCMessage) {
    await new Promise<void>((resolve, reject) => this.socket.write(serializeMessage(message), error => error ? reject(error) : resolve()));
  }
  async close() { this.socket.destroy(); }
}

export async function serveSharedBridge() {
  const { address, key } = await endpoint();
  const preferences = new FileCookiePreferences();
  const bridge = new Bridge({ cookie: process.env.COOKIE?.trim() || await preferences.loadCookie() });
  const settings = new Settings(bridge, preferences);
  const clients = new Set<Socket>();
  let idle: ReturnType<typeof setTimeout>;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true; clearTimeout(idle);
    for (const socket of clients) socket.destroy();
    server.close(); await bridge.close();
    if (process.platform !== 'win32') await unlink(address).catch(() => undefined);
  };
  const scheduleIdle = () => { clearTimeout(idle); idle = setTimeout(() => { if (!clients.size) void stop(); }, 1000); };
  const server = createServer({ pauseOnConnect: true }, socket => {
    clients.add(socket); clearTimeout(idle);
    socket.on('error', () => undefined);
    socket.once('close', () => { clients.delete(socket); if (!clients.size) scheduleIdle(); });
    void Promise.resolve().then(async () => {
      if (socket.destroyed) return;
      const mcp = createMcpServer(bridge, preferences, settings);
      await mcp.connect(new PipeTransport(socket, key));
    }).catch(() => socket.destroy());
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(address, resolve); });
  } catch (error) {
    await bridge.close();
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') return; // Another starter won the pipe.
    throw error;
  }
  server.on('error', () => { void stop(); });
  process.on('SIGINT', () => { void stop(); });
  process.on('SIGTERM', () => { void stop(); });
  scheduleIdle();
}

export async function connectSharedBridge() {
  const { address, key } = await endpoint();
  const connect = () => new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(address);
    const failed = (error: Error) => { socket.destroy(); reject(error); };
    socket.once('error', failed);
    socket.once('connect', () => { socket.off('error', failed); socket.on('error', () => undefined); resolve(socket); });
  });
  let socket: Socket | undefined;
  try { socket = await connect(); } catch { /* Start one owner if absent. */ }
  if (!socket) {
    const owner = spawn(process.execPath, [process.argv[1], '--bridge-service'], { cwd: homedir(), detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
    owner.on('error', () => undefined); owner.unref();
    for (let attempt = 0; attempt < 100; attempt++) {
      try { socket = await connect(); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
  }
  if (!socket) throw Object.assign(new Error('Local bridge unavailable'), { code: 'LOCAL_BRIDGE_UNAVAILABLE' });
  socket.write(`${key}\n`);
  const peer = socket;
  const stop = () => { process.stdin.unpipe(peer); peer.end(); process.stdin.pause(); };
  process.stdin.on('end', stop);
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  peer.on('close', () => { process.stdin.pause(); process.exitCode = 0; });
  peer.pipe(process.stdout); process.stdin.pipe(peer);
}
