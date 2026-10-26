import { build } from 'esbuild';
import { buildOptions } from './build-options.mjs';
import { buildPanel } from './build-panel.mjs';
await buildPanel();
await build(buildOptions);
