import { App } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { configureTransport, setPanelRoute } from './canvas/transport.js';
import { configureIcons } from './canvas/icons.js';
import { createCanvasRouteHandler } from './canvas-route';
import { nativeTransport } from './canvas-transport';
import { preparePanelLayout } from './canvas/panel-layout.js';
import { createAnnotationDraftSender } from './annotation-draft';
import { MCP_VERSION } from '../src/runtime-version';

const app = new App({ name: '蓝湖', version: MCP_VERSION }, {}, { autoResize: false });
const extensions = new OpenAIExtensions(app);
const appendAnnotations = createAnnotationDraftSender(() => extensions.message, app);
configureTransport(nativeTransport(app, appendAnnotations));
configureIcons('', 'lh-icon-');
preparePanelLayout();
app.ontoolresult = createCanvasRouteHandler(setPanelRoute);
async function start() {
  await app.connect();
  await import('./canvas/app.js');
}
void start().catch(() => { const state = document.querySelector('#state'); if (state) state.textContent = '无法连接宿主，请重新打开蓝湖。'; });
