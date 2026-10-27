---
name: lanhu-compressed-picture
description: 调用蓝湖 MCP 压缩指定图片或目录中的图片，或打开 Lanhu Compressed Picture 内联面板。
---

# Lanhu Compressed Picture

- 打开面板：调用 `lanhu_compressed_picture`。用户指定图片或目录时，将其绝对路径放入 `paths` 数组；未指定时省略参数。
- 仅打开面板或添加待处理图片时，调用后结束，不继续调用处理工具，也不主动追加确认问题、实现说明或操作总结。
- 用户要求由 Agent 执行压缩时，先调用 `lanhu_compression_list`，用 `paths` 添加指定路径并读取 `items`；再使用返回的真实 `id` 调用 `lanhu_compression_run`。
- 根据返回的 `status` 判断结果：`done` 已完成，`unchanged` 已跳过，`error` 失败。需要查看最新状态时，不传 `paths` 调用 `lanhu_compression_list`。遇到实际失败时简要告知结果，不无限重试。
- 图片处理全部通过上述 MCP 工具完成，不另写脚本或自行读写图片。
