import type { App } from '@modelcontextprotocol/ext-apps';
import type { AnnotationInstruction } from './annotation-draft';
import { projectMemoryKey } from './canvas/lanhu-links.js';

export function nativeTransport(app: Pick<App, 'callServerTool' | 'openLink'>, appendDraft?: (items: AnnotationInstruction[]) => Promise<void>, requestLogin?: (attemptId?: string) => Promise<void>) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    appendDraft,
    async requestLogin(attemptId?: string) {
      if (!requestLogin) throw new Error('当前宿主不支持新建登录对话');
      if (attemptId) {
        const result = await app.callServerTool({ name: 'lanhu_login_attempt', arguments: { action: 'start', attempt_id: attemptId } });
        if (result.isError) throw new Error('登录流程登记失败，请使用手动填写 Cookie');
      }
      return requestLogin(attemptId);
    },
    async setLoginCookie(cookie: string, attemptId?: string) {
      const result = await app.callServerTool({ name: 'set_cookie', arguments: { cookie, verify: true,
        ...(attemptId ? { cancel_login_attempt_id: attemptId } : {}) } });
      const block = result.content?.find(item => item.type === 'text');
      const value = block?.type === 'text' ? JSON.parse(block.text) : {};
      if (result.isError || !value.login?.loggedIn || value.login.verification !== 'upstream')
        throw new Error('Cookie 未通过登录校验或保存失败，请检查后重试。');
      // Return only confirmation; never propagate Cookie or environment data to UI.
      return { loggedIn: true };
    },
    async recallProject() {
      const result = await app.callServerTool({ name: 'lanhu_canvas_preferences', arguments: {} });
      if (result.isError) throw new Error('项目记忆读取失败');
      return result._meta?.['lanhu/savedRoute'];
    },
    async rememberProject(route: Record<string, string>) {
      const result = await app.callServerTool({ name: 'lanhu_canvas_preferences', arguments: { route } });
      if (result.isError) throw new Error('项目记忆保存失败');
    },
    async recallGroup(route: Record<string, string>) {
      const result = await app.callServerTool({ name: 'lanhu_canvas_preferences', arguments: {} });
      return (result._meta?.['lanhu/groups'] as Record<string, string> | undefined)?.[projectMemoryKey(route)];
    },
    async rememberGroup(route: Record<string, string>, group_id: string) {
      await app.callServerTool({ name: 'lanhu_canvas_preferences', arguments: { group: { project_id: route.project_id, ...(route.team_id ? { team_id: route.team_id } : {}), group_id } } });
    },
    async clipboardSeen() {
      const result = await app.callServerTool({ name: 'lanhu_canvas_preferences', arguments: {} });
      return result._meta?.['lanhu/seenLinks'] || [];
    },
    async markClipboardSeen(hash: string) {
      const result = await app.callServerTool({ name: 'lanhu_canvas_preferences', arguments: { seen_link: hash } });
      if (result.isError) throw new Error('无法保存剪贴板链接处理记录');
    },
    async clipboardLinks() {
      const result = await app.callServerTool({ name: 'lanhu_canvas_request', arguments: { endpoint: 'clipboard' } });
      return (result._meta?.['lanhu/response'] as { data?: { links?: string[] } })?.data?.links || [];
    },
    open: (url: string) => app.openLink({ url }),
    async fetch(value: string, options: { signal?: AbortSignal } = {}) {
      const url = new URL(value, 'https://lanhu-panel.invalid');
      if (url.origin !== 'https://lanhu-panel.invalid' || !/^\/api\/[a-z]+$/.test(url.pathname)) throw new Error('不支持此画布请求');
      const args: Record<string, string | number> = { endpoint: url.pathname.slice(5) };
      for (const [key, entry] of url.searchParams) {
        if (entry === '') continue;
        if (key === 'url') args.target_url = entry;
        else if (['width', 'height', 'offset'].includes(key)) args[key] = Number(entry);
        else args[key] = entry;
      }
      if (options.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
      if (active >= 4) await new Promise<void>(resolve => waiting.push(resolve));
      else active++;
      try {
        if (options.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
        if (args.endpoint === 'status') {
          const result = await app.callServerTool({ name: 'check_login', arguments: { verify: true } }, { signal: options.signal });
          const text = result.content?.find(item => item.type === 'text');
          const status = text?.type === 'text' ? JSON.parse(text.text) : {};
          if (result.isError && !['LOGIN_REQUIRED', 'LOGIN_REJECTED', 'COOKIE_SCOPE_MISMATCH', 'LOGIN_UNVERIFIED'].includes(status.code))
            throw Object.assign(new Error(status.message || '登录状态读取失败'), { code: status.code });
          return Response.json({ mode: 'mcp', loggedIn: !result.isError && status.login?.loggedIn === true && status.login?.verification === 'upstream' });
        }
        const result = await app.callServerTool({ name: 'lanhu_canvas_request', arguments: args }, { signal: options.signal });
        if (result.isError) {
          const error = result._meta?.['lanhu/error'] as { code?: string; message?: string } | undefined;
          throw Object.assign(new Error(error?.message || '画布读取失败'), { code: error?.code });
        }
        const response = result._meta?.['lanhu/response'] as { data?: unknown; base64?: string; mime?: string };
        if (!response) throw new Error('画布数据通道没有返回结果');
        if (response.base64 !== undefined) {
          const bytes = Uint8Array.from(atob(response.base64), character => character.charCodeAt(0));
          return new Response(bytes, { headers: { 'Content-Type': response.mime || 'application/octet-stream' } });
        }
        return Response.json(response.data);
      } finally {
        const next = waiting.shift();
        if (next) next(); else active--;
      }
    }
  };
}
