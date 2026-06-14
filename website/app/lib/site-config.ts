/**
 * Site-wide constants shared by the root layout and leaf pages. Lives
 * outside `layout.tsx` because Next.js App Router layouts can only
 * export the well-known metadata/route fields — any other export from a
 * layout file fails the type-check at build time.
 */
export const SITE_URL = 'https://wordspace.ai';

export const SITE_TITLE = 'Wordspace Next — 本地 HTML 文档编辑器';

// 控制在中文 SERP / OpenGraph 预览不至于中途截断的长度。
export const SITE_DESCRIPTION =
  'Wordspace Next 是一款本地运行的 HTML 文档编辑器：打开 .html 文件，像普通文档一样编辑，再存回干净的 HTML。免费，不上云、不用账号。';
