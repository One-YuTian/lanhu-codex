import type { OpenAIMessage } from '@openai/mcp-extensions/app';
import type { App } from '@modelcontextprotocol/ext-apps';

export async function sendLoginMessage(message: OpenAIMessage | undefined, app: Pick<App, 'getHostCapabilities'>, attemptId?: string) {
  if (!message || !app.getHostCapabilities()?.message?.text) throw new Error('当前宿主不支持自动创建登录对话，请复制提示词并手动创建新对话发送。');
  try {
    const text = '登录蓝湖设计网站。' + (attemptId ? `\nlogin_attempt_id:${attemptId}\n本次流程可由 UI 手动填写 Cookie 取消；读取 Cookie 前查询 lanhu_login_attempt，set_cookie 时传入 login_attempt_id；已取消则结束任务。` : '');
    const result = await message.send({ role: 'user', content: [{ type: 'text', text }],
      _meta: { 'openai/message': { target: 'new', send: true } } });
    if (result.isError) throw new Error('LOGIN_MESSAGE_NOT_CONFIRMED');
  } catch { throw new Error('未能确认新登录对话已创建，请复制提示词并手动创建新对话发送。'); }
}
