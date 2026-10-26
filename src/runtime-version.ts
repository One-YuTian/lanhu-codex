import { version } from '../package.json';
export const MCP_VERSION = version;
export const BRIDGE_RUNTIME = `v${MCP_VERSION.replaceAll('.', '-')}`;
