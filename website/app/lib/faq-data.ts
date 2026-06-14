export interface FaqItem {
  q: string;
  a: string;
}

/**
 * Single source of truth for the homepage FAQ. Rendered by `FAQ.tsx`
 * and also serialized as JSON-LD `FAQPage` schema in `page.tsx` — keep
 * one list so the visible copy and the structured data can't drift.
 */
export const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'Do I need my own AI account?',
    a: 'Yes. wordspace has no built-in model — you bring the AI. Most people use Claude Code, Cursor, or another agent they already pay for. That also means no wordspace subscription for AI tokens.',
  },
  {
    q: 'Which AI tools are supported?',
    a: 'Anything that can call an HTTP API. That includes Claude Code, Cursor, and custom agents built on the Anthropic, OpenAI, or any OpenAI-compatible SDK. The Copy Prompt output works the same way for all of them.',
  },
  {
    q: 'What is a .wsp file?',
    a: 'wordspace\u2019s native document format. Currently a JSON file that captures content, page format, and editing context. In the future it will evolve into a folder-based package so AI collaboration history travels with the document.',
  },
  {
    q: 'How does the app update itself?',
    a: 'wordspace checks for new versions on startup. Downloads are published through wordspace.ai/downloads/mac and wordspace.ai/downloads/win, which always point at the latest build in our public release mirror on GitHub.',
  },
];
