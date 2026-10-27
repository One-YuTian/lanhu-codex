export function renderLoginState(root, reportError, manualLogin) {
  const flow = { manual: false };
  const heading = root.createElement('h2'); heading.textContent = '填写 Cookie，连接蓝湖';
  const description = root.createElement('p'); description.textContent = '登录蓝湖网站后，复制浏览器请求头中的 Cookie 并填写。校验成功后继续浏览。';
  const button = root.createElement('button'); button.id = 'manual-cookie-button'; button.className = 'primary'; button.textContent = '填写 Cookie';
  button.addEventListener('click', async () => {
    if (flow.manual) return;
    flow.manual = true; button.disabled = true;
    try { await manualLogin(); } catch (error) { reportError(error.message); }
    finally { flow.manual = false; button.disabled = false; }
  });
  root.querySelector('#state').replaceChildren(heading, description, button);
  return flow;
}
