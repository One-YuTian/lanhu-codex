import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = /[\\/]dev$/.test(__dirname) ? path.resolve(__dirname, '../..') : path.resolve(__dirname, '..');
export const sidebarIcons = [{
  src: `data:image/png;base64,${readFileSync(path.join(root, 'assets/sidebar-icon.png')).toString('base64')}`,
  mimeType: 'image/png', sizes: ['80x80']
}];
