/**
 * Site-wide constants shared by the root layout and leaf pages. Lives
 * outside `layout.tsx` because Next.js App Router layouts can only
 * export the well-known metadata/route fields — any other export from a
 * layout file fails the type-check at build time.
 */
export const SITE_URL = 'https://wordspace.ai';

export const SITE_TITLE = 'Wordspace Next — a local HTML document editor';

// Kept under ~160 characters so Google's SERP snippet and the OpenGraph
// preview render without mid-sentence truncation.
export const SITE_DESCRIPTION =
  'Wordspace Next is a clean desktop editor for HTML documents — open a file, edit it like a doc, and it saves straight back to clean HTML. Local and free.';
