import type { ResourceLink } from '@modelcontextprotocol/sdk/types.js';

export type SelectionContent = { id: string; title: string; prompt: string; items?: { title: string; prompt: string }[] };
export function selectionLinks(selection: SelectionContent): ResourceLink[] {
  return (selection.items?.length ? selection.items : [selection]).map((item, index) => ({
    type: 'resource_link', uri: `lanhu://selection/${selection.id}/${index}`,
    name: item.title, title: item.title, mimeType: 'application/json',
    description: '蓝湖所选页面或对象。通过 resources/read 读取此引用对应的完整 ID、项目和设计读取指引。'
  }));
}
