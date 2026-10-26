export function renderLoginState(root, requestLogin, reportError, manualLogin = async () => {}) {
  const state = root.querySelector('#state');
  const flow = { pending: false, attemptId: undefined, manual: false };
  const manual = root.createElement('button'); manual.id = 'manual-cookie-button'; manual.className = 'login-manual'; manual.textContent = '手动填写 Cookie';
  manual.addEventListener('click', async () => {
    if (flow.manual) return;
    flow.manual = true;
    try { await manualLogin(flow.attemptId); } catch (error) { reportError(error.message); }
    finally { flow.manual = false; }
  });
  const heading = root.createElement('h2'); heading.textContent = '登录蓝湖，开始查看设计';
  const description = root.createElement('p'); description.textContent = '登录后即可浏览项目、查看页面元素和下载切图。点击下方按钮，在新对话中开始登录。';
  const button = root.createElement('button'); button.id = 'login-button'; button.className = 'primary'; button.textContent = '登录';
  button.addEventListener('click', async () => {
    if (flow.pending || flow.manual) return;
    flow.pending = true; flow.attemptId = crypto.randomUUID(); button.disabled = true;
    const spinner = root.createElement('div'); spinner.className = 'login-spinner'; spinner.setAttribute('role', 'status'); spinner.setAttribute('aria-label', '正在等待登录');
    heading.textContent = '登录中'; description.textContent = '请在新对话中完成蓝湖登录，登录成功后此页面会自动更新。';
    const hint = root.createElement('p'); hint.className = 'login-help';
    const label = root.createElement('span'); label.textContent = '未自动打开新对话？复制提示词，手动创建对话并发送：';
    const prompt = root.createElement('code'); prompt.textContent = '登录蓝湖设计网站。';
    const copy = root.createElement('button'); copy.id = 'copy-login-prompt'; copy.textContent = '复制提示词';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(prompt.textContent + `\nlogin_attempt_id:${flow.attemptId}`); copy.textContent = '已复制'; }
      catch { reportError('复制失败，请选择下方提示词文本手动复制：登录蓝湖设计网站。'); }
    });
    hint.append(label, prompt, copy);
    state.replaceChildren(spinner, heading, description, hint, manual);
    try {
      await requestLogin(flow.attemptId);
    } catch (error) { description.textContent = error.message; reportError(error.message); }
  });
  state.replaceChildren(heading, description, button, manual);
  return flow;
}

export function renderLoginSuccess(root, openProject = () => {}) {
  const symbol = root.createElement('div'); symbol.className = 'login-success-icon'; symbol.textContent = '✓';
  const heading = root.createElement('h2'); heading.textContent = '登录成功';
  const description = root.createElement('p'); description.textContent = '蓝湖登录已通过校验，可以开始浏览项目。';
  const button = root.createElement('button'); button.id = 'open-project-link'; button.textContent = '打开项目链接'; button.addEventListener('click', openProject);
  root.querySelector('#state').replaceChildren(symbol, heading, description, button);
}
