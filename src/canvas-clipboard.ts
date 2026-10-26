import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractLanhuLinks } from '../panel/canvas/lanhu-links.js';
const execute = promisify(execFile);
export async function clipboardLinks(platform = process.platform, run = execute) {
  if (platform !== 'win32') return [];
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Get-Clipboard -Raw'],
      { windowsHide: true, timeout: 3000, maxBuffer: 65536, encoding: 'utf8' });
    return extractLanhuLinks(String(stdout));
  } catch { return []; }
}
