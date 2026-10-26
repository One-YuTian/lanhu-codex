import { fileURLToPath } from 'node:url';
export const buildOptions = {
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['src/index.ts'], outfile: 'dist/index.cjs', bundle: true,
  platform: 'node', target: 'node20', format: 'cjs', packages: 'bundle',
  external: ['bufferutil', 'utf-8-validate'], legalComments: 'eof'
};
