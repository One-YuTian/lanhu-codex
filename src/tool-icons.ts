import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Icon } from '@modelcontextprotocol/sdk/types.js';

// SDK 1.x supports Icon on the wire but its registerTool/tools-list mapping
// omits icons. Decorate the public request handler instead of private state.
export function configureToolIcons(server: McpServer, icons: Record<string, Icon[]>) {
  const setHandler = server.server.setRequestHandler.bind(server.server);
  server.server.setRequestHandler = ((schema, handler) => {
    const method = (schema as { shape?: { method?: { value?: string } } }).shape?.method?.value;
    if (method !== 'tools/list') return setHandler(schema, handler);
    return setHandler(schema, async (request, extra) => {
      const result = await handler(request, extra);
      const list = result as { tools?: Array<{ name: string }> };
      if (!Array.isArray(list.tools)) return result;
      return { ...result, tools: list.tools.map(tool => icons[tool.name] ? { ...tool, icons: icons[tool.name] } : tool) };
    });
  }) as typeof server.server.setRequestHandler;
}
