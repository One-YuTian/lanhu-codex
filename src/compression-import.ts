import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const execute = promisify(execFile);
export function pickerCommand(platform: NodeJS.Platform = process.platform) {
  if (platform === 'win32') {
    const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '选择图片'
$dialog.Filter = 'Images (*.jpg;*.jpeg;*.png;*.webp)|*.jpg;*.jpeg;*.png;*.webp'
$dialog.Multiselect = $true
try {
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    ConvertTo-Json -InputObject @($dialog.FileNames) -Compress
  } else { '[]' }
} finally { $dialog.Dispose() }
`;
    return { command: 'powershell.exe', args: ['-NoProfile', '-STA', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], json: true };
  }
  if (platform === 'darwin') return { command: '/usr/bin/osascript', args: ['-l', 'JavaScript', '-e', `const app=Application.currentApplication();app.includeStandardAdditions=true;try{const files=app.chooseFile({withPrompt:'选择图片',multipleSelectionsAllowed:true});JSON.stringify((Array.isArray(files)?files:[files]).map(String))}catch(e){if(e.errorNumber===-128)JSON.stringify([]);else throw e}`], json: true };
  return { command: 'zenity', args: ['--file-selection','--multiple','--separator=\n','--file-filter=Images | *.jpg *.jpeg *.png *.webp','--title=选择图片'], json: false };
}
export async function pickImages(runner = execute): Promise<string[]> {
  const spec = pickerCommand();
  try {
    const { stdout } = await runner(spec.command, spec.args, { windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 300_000 });
    const output = String(stdout).trim(), values = !output ? [] : spec.json ? JSON.parse(output) : output.split('\n');
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !path.isAbsolute(value) || !/\.(jpe?g|png|webp)$/i.test(value))) throw new Error('选择器返回了无效图片路径');
    return values;
  } catch (error) {
    if (process.platform !== 'win32' && (error as { code?: number }).code === 1) return [];
    throw new Error('无法打开系统文件选择器，请检查本机桌面会话');
  }
}
