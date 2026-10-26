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

export function supportedDesktopVersion(version?: string): boolean {
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)(?:\D|$)/);
  if (!match) return true; // Capability negotiation remains authoritative for unversioned hosts.
  const current = match.slice(1).map(Number), minimum = [26, 928, 20710];
  for (let index = 0; index < 3; index++) if (current[index] !== minimum[index]) return current[index] > minimum[index];
  return true;
}
