---
name: lanhu-compressed-picture
description: 打开蓝湖图片压缩 UI 面板，在前台展示指定图片或目录中图片的压缩过程。
---

# Lanhu Compressed Picture

- 每次调用本技能，必须先调用 `lanhu_compressed_picture` 唤起前台 UI 面板，让用户看到任务列表、压缩进度和结果；由其他技能自动触发压缩时也必须如此。用户指定图片或目录时，将其绝对路径放入 `paths` 数组；未指定时省略参数。面板未成功打开时，报告问题，不转为后台执行。
- 仅打开面板或添加待处理图片时，调用后结束，不继续调用处理工具，也不主动追加确认问题、实现说明或操作总结。
- 用户要求由 Agent 执行压缩时，打开面板后调用 `lanhu_compression_list` 读取 `items`，仅处理本次指定图片。面板已自动开始的任务通过列表查询进度，不重复启动；需要由 Agent 开始的待处理任务，使用列表返回的真实 `id` 调用 `lanhu_compression_run`。不得仅调用列表和处理工具而省略 UI 面板，也不关闭面板隐藏处理过程。
- 根据返回的 `status` 判断结果：`done` 已完成，`unchanged` 已跳过，`error` 失败。需要查看最新状态时，不传 `paths` 调用 `lanhu_compression_list`。遇到实际失败时简要告知结果，不无限重试。
- 图片处理全部通过上述 MCP 工具完成，不另写脚本或自行读写图片。
