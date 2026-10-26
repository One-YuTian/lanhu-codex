# 蓝湖 MCP · Codex 插件

独立的蓝湖 Codex 插件与 Git 插件市场。提供登录及 Cookie 管理、团队与项目浏览、设计稿画布、图层和样式读取、标注追加到 Composer、切图查询与下载。

本工程从 `lanhu-codex/lanhu-mcp` 提取，不包含 Chrome 扩展、独立 Web 服务、浏览器调试数据、导出缓存或旧项目文档。原 Web 工程中被 MCP 使用的画布模块已并入 `panel/canvas/`，资源处理已并入 `src/assets.mjs`，共享协议已并入 `src/shared.ts`。

## 安装到 Codex

运行环境需要 Node.js 20.19 或更高版本，`node` 必须在 Codex 可用的 PATH 中。

1. 将本仓库推送到自己的 Git 远程仓库。
2. 在 Codex 的插件市场添加入口中填入仓库地址，使用仓库根目录。
3. 从“蓝湖插件市场”安装 `lanhu-mcp`，然后打开蓝湖画布。
4. 按登录技能通过 CDP 登录，或在插件设置/画布中手动填写 Cookie。

市场清单位于 `.agents/plugins/marketplace.json`，插件来源路径 `./` 相对仓库根目录。仓库包含已打包的 `dist/index.cjs`、`dist/panel.html` 和 `dist/canvas.html`；从 Git 安装后的运行不需要 pnpm 或 node_modules。无需启动独立 Web 服务。

本地调试可将本目录注册为本地插件市场。仅克隆源码并修改文件不会自动更新 Codex 已安装的缓存，需要通过 Codex 更新或重新安装插件。

格式参考：[OpenAI 插件打包文档](https://developers.openai.com/plugins/build/plugins)、[插件市场清单](https://learn.chatgpt.com/docs/enterprise/plugin-management)。

## 开发

使用 pnpm 12.6.0，依赖版本由 `pnpm-lock.yaml` 固定。

```powershell
pnpm install --frozen-lockfile
pnpm check
```

| 命令 | 用途 |
| --- | --- |
| `pnpm build` | 打包 MCP 和内嵌画布，同步兼容清单 |
| `pnpm dev` | 监听服务端及其依赖，成功构建后重启 stdio 子进程 |
| `pnpm start` | 启动打包后的 MCP stdio 服务 |
| `pnpm typecheck` | 检查服务端与面板类型 |
| `pnpm test` | 构建并运行 MCP、登录、画布和标注回归测试 |
| `pnpm verify` | 核对市场与插件清单，并在无依赖的临时目录验证 MCP 和 UI 资源 |
| `pnpm check` | 类型检查、构建、回归测试、插件可移植性验证 |

`pnpm dev` 监听服务端模块；修改画布模板、样式或浏览器代码后执行 `pnpm build` 并重新连接。开发命令的 stdout 为 MCP 协议通道，使用支持 stdio 的客户端连接。

## 目录

```text
.agents/plugins/marketplace.json   Git 插件市场入口
.codex-plugin/plugin.json         Codex 兼容清单（构建生成并提交）
plugin.json / mcp.json             插件身份及标准 MCP 启动配置
.mcp.json                         Codex 兼容 MCP 配置（构建生成并提交）
src/                              MCP 服务、蓝湖 API、登录和本机共享管道
panel/                            MCP 接收面板和画布适配层
panel/canvas/                     内嵌画布及 UI 模块
skills/                           连接、登录、页面元素与切图技能
assets/                           插件 Logo 和侧栏图标
scripts/                          构建、兼容清单同步与可移植性检查
tests/                            功能回归测试与合成测试数据
dist/                             Git 安装直接使用的运行产物
```

`node_modules/`、`.cache/`、`dist/dev/` 和本机凭据不进入版本库。保留技能说明及 `THIRD_PARTY_NOTICES.md`，画布图标许可证位于 `panel/canvas/icons/LICENSE`。

## 凭据与发布

MCP 通过 stdio 和私有本机管道工作，不启动 HTTP/TCP/WebSocket 服务。Cookie 保存在 `PLUGIN_DATA/settings.json`；宿主未提供该变量时兼容使用用户目录下的 `.lanhu-codex/settings.json`。旧路径保留以兼容既有配置。插件清单中的 COOKIE 始终为空，真实凭据由用户配置，不提交到 Git。

发布更新时同步修改 `package.json` 和 `plugin.json` 的版本号；服务端、共享管道和画布从 package.json 读取版本。运行 `pnpm check`，提交更新后的 `dist/` 与兼容清单，再推送仓库。Git 安装不能假设宿主自动安装依赖或构建。

当前工程仅准备本地 Git 仓库和市场文件，不绑定远程仓库，也不自动安装到 Codex。
