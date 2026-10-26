import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { draftMessage, supportedDesktopVersion, type DraftContent } from './draft-message';

const app = new App({ name: '蓝湖接收面板', version: '0.1.25' }, {}, { autoResize: true });
const extensions = new OpenAIExtensions(app);
const status = document.getElementById('status')!;
let token: string | undefined;
let connected = false, stopped = false, busy = false;
let mentionsSupported: boolean | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const inserted = new Set<string>(), failed = new Set<string>();
function setStatus(text: string, error = false) { status.textContent = text; status.classList.toggle('error', error); }
function style() {
  const context = app.getHostContext();
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}
app.addEventListener('hostcontextchanged', style);
app.ontoolresult = result => {
  const meta = result._meta?.['lanhu/panel'] as { token?: unknown } | undefined;
  if (typeof meta?.token === 'string') {
    token = meta.token;
    if (mentionsSupported === false) reportUnsupported();
    else void poll();
  }
};
async function tool(name: string, args: Record<string, unknown>) {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) throw new Error('接收面板连接已失效，请关闭后重新打开。');
  return result;
}
function reportUnsupported() {
  if (token) void tool('lanhu_receiver_poll', { token, visible: document.visibilityState === 'visible',
    wait_ms: 0, mentions_supported: false }).catch(() => undefined);
}
async function poll() {
  if (!connected || !token || busy || stopped) return;
  busy = true;
  let retry = false;
  try {
    // The next receive starts on the preceding response, so hidden-frame timer
    // throttling does not delay a new draft by up to a minute.
    while (connected && token && !stopped) {
      const panelToken: string = token;
      const result = await tool('lanhu_receiver_poll', { token: panelToken,
        visible: document.visibilityState === 'visible', wait_ms: 25_000 });
      if (stopped || token !== panelToken) continue;
      if (!result._meta || !Object.hasOwn(result._meta, 'lanhu/draft')) throw new Error('Receiver metadata missing');
      const draft = result._meta?.['lanhu/draft'] as (DraftContent & { id: string }) | null;
      if (!draft) continue;
      document.getElementById('preview')!.hidden = false;
      document.getElementById('title')!.textContent = draft.title;
      document.getElementById('content')!.textContent = draft.prompt;
      if (!inserted.has(draft.id) && !failed.has(draft.id)) {
        try {
          // No standard-message fallback: its default may submit immediately.
          const response = await extensions.message!.send(draftMessage(draft));
          if (response.isError) throw new Error('Host rejected draft');
          inserted.add(draft.id);
          setStatus('已添加到当前草稿。请在输入框确认后手动发送。');
        } catch {
          failed.add(draft.id);
          setStatus('未能确认草稿已添加。请检查输入框；没有自动发送，也不会自动重试添加。', true);
        }
      }
      await tool('lanhu_receiver_ack', { token: panelToken, draft_id: draft.id, inserted: inserted.has(draft.id) });
    }
  } catch {
    if (!stopped) {
      setStatus('接收连接中断，正在重试。请确认蓝湖插件已连接。', true);
      retry = true;
    }
  } finally {
    busy = false;
    if (retry) timer = setTimeout(() => { void poll(); }, 1500);
  }
}
async function start() {
  try {
    await app.connect(); style();
    const context = app.getHostContext();
    const host = app.getHostVersion();
    if (context?.platform === 'desktop' && !supportedDesktopVersion(host?.version)) {
      setStatus('当前桌面版本较旧，请更新 Codex 后重新打开面板。', true); return;
    }
    mentionsSupported = !!extensions.message && !!app.getHostCapabilities()?.message?.resourceLink;
    if (!mentionsSupported) {
      setStatus('当前宿主暂不支持资源 mention 追加，无法将蓝湖对象添加为 Composer mention。', true);
      reportUnsupported(); return;
    }
    connected = true;
    setStatus('准备好了，可折叠到后台，等待蓝湖画布内容。');
    void poll();
  } catch { setStatus('无法连接当前会话，请从 Codex 的会话面板入口打开。', true); }
}
document.addEventListener('visibilitychange', () => {
  if (!connected || !token || stopped) return;
  // Update routing without interrupting the outstanding long poll.
  void tool('lanhu_receiver_poll', { token, visible: document.visibilityState === 'visible', wait_ms: 0 }).catch(() => undefined);
});
app.onteardown = async () => {
  stopped = true; clearTimeout(timer);
  if (token && connected) await app.callServerTool({ name: 'lanhu_receiver_close', arguments: { token } }).catch(() => undefined);
  return {};
};
void start();
