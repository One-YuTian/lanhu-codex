import type { OpenAIMessage } from '@openai/mcp-extensions/app';
import type { App } from '@modelcontextprotocol/ext-apps';

export type AnnotationInstruction = { title: string; prompt: string };
// Annotation rounds always append to the active conversation without submitting it.
export const ANNOTATION_DESTINATION = { target: 'active' as const, send: false };

export function createAnnotationDraftSender(getMessage: () => OpenAIMessage | undefined, app: Pick<App, 'getHostCapabilities'>) {
  let message: OpenAIMessage | undefined;
  let queued: Promise<void> = Promise.resolve();
  return (items: AnnotationInstruction[]) => {
    const snapshot = items.map(item => ({ ...item }));
    const result = queued.then(() => {
      message ??= getMessage();
      return appendAnnotationDraft(message, app, snapshot);
    });
    queued = result.catch(() => {});
    return result;
  };
}

export async function appendAnnotationDraft(message: OpenAIMessage | undefined, app: Pick<App, 'getHostCapabilities'>, items: AnnotationInstruction[]) {
  if (!message || !app.getHostCapabilities()?.message?.text) throw new Error('当前宿主不支持追加文本草稿，请在目标会话面板中打开蓝湖后重试；标注尚未清空。');
  if (!items.length || items.some(item => !item.title.trim() || !item.prompt.trim())) throw new Error('标注内容为空，尚未提交。');
  const content = items.map(item => ({ type: 'text' as const, text: item.prompt, _meta: { 'openai/title': item.title } }));
  if (content.reduce((length, item) => length + item.text.length, 0) > 64000) throw new Error('标注文本过长，请精简后重试；标注尚未清空。');
  try {
    const result = await message.send({ role: 'user', content,
      _meta: { 'openai/message': { ...ANNOTATION_DESTINATION } } });
    if (result.isError) throw new Error('DRAFT_NOT_CONFIRMED');
  } catch { throw new Error('未能确认草稿已追加，请先检查 Composer；标注尚未清空，未自动重试。'); }
}
