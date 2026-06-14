/**
 * Site-wide constants shared by the root layout and leaf pages. Lives
 * outside `layout.tsx` because Next.js App Router layouts can only
 * export the well-known metadata/route fields — any other export from a
 * layout file fails the type-check at build time.
 *
 * Treat these as the canonical home-page metadata. Sub-routes that want
 * their own title/description just override at the page level; the home
 * page intentionally inherits everything here.
 */
export const SITE_URL = 'https://wordspace.ai';

export const SITE_TITLE = 'wordspace — AI-era document editor';

// Kept under ~160 characters so Google's SERP snippet and the OpenGraph
// preview render without mid-sentence truncation.
export const SITE_DESCRIPTION =
  'wordspace is a headless document editor for the AI era — bring your own AI (Claude Code, Cursor, any agent) and edit docs via a one-click Copy Prompt bridge.';
