---
name: lanhu-login
description: 登录蓝湖设计网站、Lanhu Login、获取或刷新 Cookie 时使用。Agent 必须通过 Chrome DevTools Protocol（CDP）打开登录页并获取 lanhuapp.com Cookie，用户确认后交给 lanhu-mcp 的 set_cookie 判断登录状态；支持 UI 手动填写 Cookie 取消原登录流程。
---

# Lanhu Login（CDP）

Agent 只负责 CDP 浏览器操作、问询和 Cookie 交接；用户自行登录；Cookie 有效性完全由 lanhu-mcp 的 set_cookie 判断。不要使用内置浏览器缺少的 Cookie API，不通过 MCP 打开网站，不由 Agent 调用 check_login 或用户身份接口。

## 流程与取消

1. UI 发来的提示词可能包含 `login_attempt_id:UUID`。有 ID 时先调用 `lanhu_login_attempt({action:"status",attempt_id:UUID})`；仅 active 可以继续。cancelled、completed、expired 都应立即结束原任务，不再问询、读取或提交 Cookie；只清理本次创建的浏览器目标。该工具只是流程状态，不验证登录。
2. **通过 CDP 打开可见 Chrome 登录页** `https://lanhuapp.com/web/#/user/login`，保存本次 targetId、连接及专用 profile。采用已提供的 CDP 工具/客户端；连接与命令见下文。不要用没有 CDP/Cookie 能力的 iab 代替。
3. 打开后立即弹出问题“是否已完成蓝湖登录？”，只提供一个答案 `已登录`。例如 `request_user_input_async({questions:[{title:"是否已完成蓝湖登录？",options:["已登录"]}]})`。等待用户真正提交；验证码、密码由用户操作，不根据头像或跳转自行校验身份。
4. 用户回答后，有 attempt ID 时再次查询其状态；若 UI 已手动设置 Cookie 并取消流程，结束任务并关闭本次 target，不再访问 Cookie。
5. 通过当前登录 target 的 **CDP Network.getCookies**，限定蓝湖接口 URL 获取 Cookie；保留适用的 HttpOnly Cookie。将 name/value 在内存组装成 Cookie Header，不输出到对话、截图、日志或项目文件。
6. 调用 `set_cookie({cookie:真实CookieHeader,verify:true,login_attempt_id:UUID})`；无 attempt ID 时省略该参数。MCP 会验证并保存到其进程 COOKIE 及私有持久配置。Agent 不再调用 check_login。
7. 成功返回 login.loggedIn=true、login.verification=upstream 且无 isError：通过 CDP Target.closeTarget 关闭本次登录 target，结束任务。工具返回 LOGIN_ATTEMPT_CANCELLED：立即结束，不再重试。返回明确身份失败则保留 target，再次弹出只有“已登录”的问题，等待用户确认后获取新的 Cookie；网络或权限问题不冒充未登录。

UI 手动输入成功后会将该 attempt 标记 cancelled；set_cookie 在实际保存前也会检查状态，拒绝已取消任务晚到的 Cookie，防止覆盖手动设置。宿主暂未提供强制中断另一条对话的 API，因此这是登录流程的协作取消；任务在下一次状态查询或提交时结束，不能声称宿主已经停止了推理。

## CDP 连接与 Cookie 读取

- 首选环境已经提供且授权的 Chrome CDP 连接/工具。先阅读其实际 API，不臆造工具名。若需启动可调试 Chrome，使用本次登录专用的非默认 `--user-data-dir`、`--remote-debugging-address=127.0.0.1` 和动态 `--remote-debugging-port=0`；从专用 profile 的 DevToolsActivePort 获取端口，再连接本机 CDP WebSocket。不要复制、解密或启用调试用户的默认 Chrome profile，不绑定公网，不设置 --no-sandbox 或禁用网页安全。浏览器调试端口与 lanhu-mcp 无关，MCP 本身不监听 HTTP 端口。
- 使用 CDP `Target.createTarget({url:"https://lanhuapp.com/web/#/user/login"})` 创建目标；`Target.attachToTarget({targetId,flatten:true})` 取得 sessionId。将页面命令发到此 session，不使用默认标签页。
- 用户确认后发送 `Network.getCookies({urls:["https://lanhuapp.com/api/account/user/detail"]})`，仅获取适用于该蓝湖接口的 Cookie。保留路径/域名匹配和 HttpOnly 的结果；不要用 document.cookie 代替，不调用 Storage.getCookies 或 getAllCookies 收集其他站点 Cookie。相同名称不同路径按路径长度排序，使用浏览器返回的真实值拼接 Header。
- CDP 只用于导航与 Cookie 读取，不执行额外的网络登录校验，不调用修改 Cookie、清理存储或其他站点调试命令。仅在完成、取消或用户终止时关闭本次目标；不要 Browser.close 关闭用户原有浏览器。
- 若当前环境没有能发送 CDP 命令的工具/客户端，明确说明 CDP 连接不可用，引导用户使用蓝湖 UI 的“手动填写 Cookie”。不能把缺少 CDP 支持说成 Cookie 无效，也不能假造读取结果。

参考：[Network.getCookies](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-getCookies)、[Chrome 调试必须使用非默认 profile](https://developer.chrome.com/blog/remote-debugging-port)。

## 手动 Cookie 路径

UI 的登录/登录中页面都提供“手动填写 Cookie”，在插件内 Codex 风格 Modal 中输入，直接经 MCP set_cookie(verify=true) 校验保存，不进入对话正文。成功后取消原登录 attempt、停止 UI 轮询并显示“登录成功”，用户点击“打开项目链接”继续。不要恢复已取消的 CDP 登录任务。
