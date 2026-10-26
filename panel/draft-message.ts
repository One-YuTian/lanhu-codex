import type { OpenAIMessageParams } from '@openai/mcp-extensions/app';
import { selectionLinks, type SelectionContent } from '../src/selection-links';
import { ANNOTATION_DESTINATION } from './annotation-draft';

export type DraftContent = SelectionContent;
export function draftMessage(draft: DraftContent): OpenAIMessageParams {
  return {
    role: 'user',
    // Use the same resource identity returned by the native mention picker.
    // No plain-text or titled-text fallback: those render differently.
    content: selectionLinks(draft),
    _meta: { 'openai/message': { ...ANNOTATION_DESTINATION } }
  };
}
