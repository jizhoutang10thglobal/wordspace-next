import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useStore } from './store'

// ---------------------------------------------------------------------------
// Wordspace's browser side. Wordspace is also a real browser, so it needs the
// usual browser machinery: an address bar that normalizes what you type, a tiny
// per-tab history for back/forward, a bookmarks list, and a way to classify a
// URL into one of three things to render:
//   - the new-tab start page
//   - one of our polished MOCK websites (so the demo always has "the open web")
//   - a real <iframe> for a genuine typed URL (best-effort; most sites block it)
// There is no network here; everything is synchronous and lives in the browser.
// ---------------------------------------------------------------------------

export type SiteKind = 'newtab' | 'mock' | 'web'
export type SiteKey = 'search' | 'company' | 'news' | 'saas'

/**
 * A saved favorite. Wordspace's bookmarks mix the two kinds of things the app
 * can open: a local/published document (by docId) and a web page (by url).
 * `uid` is a unique per-entry id; favorites are NOT de-duplicated, so the same
 * page can be saved more than once and each entry is moved/removed on its own.
 */
export interface Bookmark {
  uid: string
  spaceId: string // favorites are scoped per space, like tabs
  kind: 'doc' | 'web'
  title: string
  url?: string // kind === 'web'
  docId?: string // kind === 'doc'
}

let bookmarkSeq = 0
export const newBookmarkUid = () => `bm-${Date.now().toString(36)}-${(bookmarkSeq++).toString(36)}`

export interface Resolved {
  kind: SiteKind
  siteKey?: SiteKey
  query?: string
  title: string
}

// Hosts we own a hand-built mock for. Typing/clicking any of these renders the
// matching <MockSite/> instead of an iframe.
const MOCK_HOSTS: Record<string, SiteKey> = {
  'tenthglobal.com': 'company',
  'www.tenthglobal.com': 'company',
  'team.tenthglobal.com': 'company',
  'news.design': 'news',
  'www.news.design': 'news',
  'flowdesk.app': 'saas',
  'www.flowdesk.app': 'saas',
}

const NEWTAB_URL = 'wordspace://newtab'

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** Pull a human-ish title for the address bar / tab from a resolved url. */
function titleFor(kind: SiteKind, siteKey: SiteKey | undefined, url: string, query?: string): string {
  if (kind === 'newtab') return '新标签页'
  if (kind === 'mock') {
    switch (siteKey) {
      case 'search':
        return query ? `${query} · Glass 搜索` : 'Glass 搜索'
      case 'company':
        return 'Tenth Global'
      case 'news':
        return 'Designer News'
      case 'saas':
        return 'FlowDesk'
    }
  }
  const u = safeUrl(url)
  return u ? u.host.replace(/^www\./, '') : url
}

/**
 * Classify a (already-normalized) url. Empty or wordspace://newtab → the start
 * page; the glass:// scheme or a known mock host → a mock site; anything else
 * → a real web page rendered in an iframe.
 */
export function resolve(url: string): Resolved {
  const raw = (url ?? '').trim()

  if (!raw || raw === NEWTAB_URL || raw === 'wordspace://' || raw === 'wordspace://home') {
    return { kind: 'newtab', title: '新标签页' }
  }

  // glass:// is our search-engine scheme. glass://search?q=… and glass://home.
  if (raw.startsWith('glass://')) {
    const rest = raw.slice('glass://'.length)
    const [path, qs = ''] = rest.split('?')
    const params = new URLSearchParams(qs)
    const query = params.get('q') ?? ''
    // glass://home (or empty) shows the search homepage; everything else is a
    // results page. Either way it is the 'search' mock.
    const siteKey: SiteKey = 'search'
    return {
      kind: 'mock',
      siteKey,
      query,
      title: titleFor('mock', siteKey, raw, query),
    }
  }

  const u = safeUrl(raw)
  if (u) {
    const host = u.host.toLowerCase()
    const siteKey = MOCK_HOSTS[host]
    if (siteKey) {
      return { kind: 'mock', siteKey, title: titleFor('mock', siteKey, raw) }
    }
    return { kind: 'web', title: titleFor('web', undefined, raw) }
  }

  // Not a parseable URL and not a known scheme → treat as a search.
  const q = raw
  const glass = 'glass://search?q=' + encodeURIComponent(q)
  return { kind: 'mock', siteKey: 'search', query: q, title: titleFor('mock', 'search', glass, q) }
}

/**
 * Turn whatever the user typed into a canonical url string.
 *  - has no scheme AND (contains a space OR has no dot) → a search query
 *  - already a glass:// or wordspace:// or http(s):// → kept as-is
 *  - otherwise a bare host/path → prefixed with https://
 */
export function normalize(input: string): string {
  const raw = (input ?? '').trim()
  if (!raw) return NEWTAB_URL

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
  if (hasScheme) return raw

  const looksLikeSearch = /\s/.test(raw) || !raw.includes('.')
  if (looksLikeSearch) {
    return 'glass://search?q=' + encodeURIComponent(raw)
  }
  return 'https://' + raw
}

interface BrowserState {
  bookmarks: Bookmark[]
  // per-tab navigation history: a stack of urls + the current cursor.
  history: Record<string, { stack: string[]; index: number }>

  navigate: (input: string) => void
  back: () => void
  forward: () => void
  canGoBack: (tabId?: string) => boolean
  canGoForward: (tabId?: string) => boolean

  addBookmark: (bm: Bookmark) => void
  removeBookmark: (uid: string) => void
  moveBookmark: (fromUid: string, toIndex: number) => void
}

const webMark = (uid: string, title: string, url: string): Bookmark => ({
  uid,
  spaceId: 'sp-tg',
  kind: 'web',
  title,
  url,
})

// Seeded favorites all live in the team space (sp-tg); the other spaces start
// empty. Deliberately mixes a document and web pages, to show a bookmark can be
// either.
const seedBookmarks: Bookmark[] = [
  { uid: 'bm-handbook', spaceId: 'sp-tg', kind: 'doc', docId: 'd-handbook', title: '员工手册' },
  webMark('bm-tg', 'Tenth Global 官网', 'https://tenthglobal.com'),
  webMark('bm-careers', '招聘 · 加入我们', 'https://tenthglobal.com/careers'),
  webMark('bm-news', 'Designer News', 'https://news.design/today'),
  webMark('bm-flowdesk', 'FlowDesk', 'https://flowdesk.app'),
]

/** Apply a resolved url to the active tab's address bar + title. */
function commitToTab(tabId: string, url: string) {
  const r = resolve(url)
  useStore.getState().setTabUrl(tabId, url, r.title)
}

export const useBrowser = create<BrowserState>()(
  persist(
    (set, get) => ({
  bookmarks: seedBookmarks,
  history: {},

  navigate: (input) => {
    const url = normalize(input)
    const tabId = useStore.getState().activeTabId
    if (!tabId) return

    set((s) => {
      const prev = s.history[tabId] ?? { stack: [], index: -1 }
      // Drop any forward entries, then push the new url.
      const stack = prev.stack.slice(0, prev.index + 1)
      // Avoid stacking the exact same url twice in a row.
      if (stack[stack.length - 1] !== url) stack.push(url)
      return { history: { ...s.history, [tabId]: { stack, index: stack.length - 1 } } }
    })

    commitToTab(tabId, url)
  },

  back: () => {
    const tabId = useStore.getState().activeTabId
    const entry = get().history[tabId]
    if (!entry || entry.index <= 0) return
    const index = entry.index - 1
    set((s) => ({ history: { ...s.history, [tabId]: { ...entry, index } } }))
    commitToTab(tabId, entry.stack[index])
  },

  forward: () => {
    const tabId = useStore.getState().activeTabId
    const entry = get().history[tabId]
    if (!entry || entry.index >= entry.stack.length - 1) return
    const index = entry.index + 1
    set((s) => ({ history: { ...s.history, [tabId]: { ...entry, index } } }))
    commitToTab(tabId, entry.stack[index])
  },

  canGoBack: (tabId) => {
    const id = tabId ?? useStore.getState().activeTabId
    const entry = get().history[id]
    return !!entry && entry.index > 0
  },

  canGoForward: (tabId) => {
    const id = tabId ?? useStore.getState().activeTabId
    const entry = get().history[id]
    return !!entry && entry.index < entry.stack.length - 1
  },

  // No de-duplication: dragging the same page in again adds another entry.
  addBookmark: (bm) => set((s) => ({ bookmarks: [...s.bookmarks, bm] })),
  removeBookmark: (uid) =>
    set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.uid !== uid) })),
  // Reorder within the favorite's own space (toIndex is relative to that space).
  moveBookmark: (fromUid, toIndex) =>
    set((s) => {
      const mark = s.bookmarks.find((b) => b.uid === fromUid)
      if (!mark) return s
      const inSpace = s.bookmarks.filter((b) => b.spaceId === mark.spaceId)
      const others = s.bookmarks.filter((b) => b.spaceId !== mark.spaceId)
      const from = inSpace.findIndex((b) => b.uid === fromUid)
      inSpace.splice(from, 1)
      inSpace.splice(Math.max(0, Math.min(toIndex, inSpace.length)), 0, mark)
      return { bookmarks: [...others, ...inSpace] }
    }),
    }),
    {
      // Only favorites persist; per-tab history stays fresh each session.
      name: 'wordspace-browser',
      version: 1, // bumped when bookmarks gained spaceId; old state reseeds
      partialize: (s) => ({ bookmarks: s.bookmarks }),
      migrate: () => ({ bookmarks: seedBookmarks }) as never,
    },
  ),
)
