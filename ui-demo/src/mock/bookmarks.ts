import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 收藏夹（mock，无后端，全在 localStorage）。书签 = { url, title, 所属文件夹 }；文件夹分组。
// 「书签栏」是一个特殊根文件夹(id=BAR),它的书签显示在网页顶部的书签栏上。
// 导入导出走 Netscape Bookmark HTML 格式——和 Chrome/Safari/Firefox/Edge 全通。
export interface Bookmark {
  id: string
  title: string
  url: string
  folderId: string
  addedAt: number // ms
  favicon?: string
}
export interface BmFolder {
  id: string
  name: string
}

export const BM_BAR = 'bm-bar' // 书签栏
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`
// 固定 seed 时间(避免 SSR/持久化不稳);演示用。
const T0 = 1_720_000_000_000

const seedFolders: BmFolder[] = [
  { id: BM_BAR, name: '书签栏' },
  { id: 'bm-work', name: '工作' },
  { id: 'bm-read', name: '稍后读' },
]
const seedBookmarks: Bookmark[] = [
  { id: 'b1', title: 'Tenth Global', url: 'https://tenthglobal.com', folderId: BM_BAR, addedAt: T0 },
  { id: 'b2', title: 'FlowDesk', url: 'https://flowdesk.app', folderId: BM_BAR, addedAt: T0 + 1000 },
  { id: 'b3', title: 'Designer News · 行业动态', url: 'https://news.design/today', folderId: 'bm-read', addedAt: T0 + 2000 },
]

// ---- Netscape Bookmark File Format ----
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const sec = (ms: number) => Math.floor(ms / 1000) // ADD_DATE 是 Unix 秒

function toNetscapeHtml(folders: BmFolder[], bookmarks: Bookmark[]): string {
  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. It will be read and overwritten. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ]
  for (const f of folders) {
    const isBar = f.id === BM_BAR
    lines.push(`    <DT><H3${isBar ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ''}>${esc(f.name)}</H3>`)
    lines.push('    <DL><p>')
    for (const b of bookmarks.filter((x) => x.folderId === f.id)) {
      lines.push(`        <DT><A HREF="${esc(b.url)}" ADD_DATE="${sec(b.addedAt)}">${esc(b.title)}</A>`)
    }
    lines.push('    </DL><p>')
  }
  lines.push('</DL><p>')
  return lines.join('\n')
}

// 宽松解析(Netscape HTML 闭标签故意不闭合,不能当 XML 解析)。用 DOMParser 的 text/html(宽松)。
function fromNetscapeHtml(html: string): { folders: BmFolder[]; bookmarks: Bookmark[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const folders: BmFolder[] = []
  const bookmarks: Bookmark[] = []
  const fid = () => uid('imf')
  // 遍历每个 H3(文件夹)对应的紧随 DL,里面的 A 是书签。无文件夹归属的 A 落书签栏。
  const seen = new Set<string>()
  const h3s = Array.from(doc.querySelectorAll('h3'))
  for (const h3 of h3s) {
    const name = (h3.textContent || '文件夹').trim()
    const isBar = h3.getAttribute('personal_toolbar_folder') === 'true'
    const folderId = isBar ? BM_BAR : fid()
    if (!isBar) folders.push({ id: folderId, name })
    // 紧随的 DL
    let dl = h3.nextElementSibling
    while (dl && dl.tagName !== 'DL') dl = dl.nextElementSibling
    if (!dl) continue
    for (const a of Array.from(dl.querySelectorAll(':scope > dt > a, :scope > a'))) {
      const url = a.getAttribute('href') || ''
      if (!/^https?:/i.test(url) || seen.has(folderId + url)) continue
      seen.add(folderId + url)
      const add = a.getAttribute('add_date')
      bookmarks.push({ id: uid('imb'), title: (a.textContent || url).trim(), url, folderId, addedAt: add ? Number(add) * 1000 : T0 })
    }
  }
  // 兜底:没有任何 H3 的裸 A 列表,全落书签栏
  if (!bookmarks.length) {
    for (const a of Array.from(doc.querySelectorAll('a'))) {
      const url = a.getAttribute('href') || ''
      if (!/^https?:/i.test(url) || seen.has(BM_BAR + url)) continue
      seen.add(BM_BAR + url)
      bookmarks.push({ id: uid('imb'), title: (a.textContent || url).trim(), url, folderId: BM_BAR, addedAt: T0 })
    }
  }
  return { folders, bookmarks }
}

interface BmState {
  folders: BmFolder[]
  bookmarks: Bookmark[]
  add: (b: { title: string; url: string; folderId?: string; favicon?: string }) => string
  removeByUrl: (url: string) => void
  removeOne: (id: string) => void
  isBookmarked: (url: string) => boolean
  update: (id: string, patch: Partial<Pick<Bookmark, 'title' | 'url' | 'folderId'>>) => void
  addFolder: (name: string) => string
  renameFolder: (id: string, name: string) => void
  removeFolder: (id: string) => void
  exportHtml: () => string
  importHtml: (html: string) => number
}

export const useBookmarks = create<BmState>()(
  persist(
    (set, get) => ({
      folders: seedFolders,
      bookmarks: seedBookmarks,
      add: ({ title, url, folderId = BM_BAR, favicon }) => {
        const id = uid('bm')
        set((s) => ({ bookmarks: [{ id, title: title || url, url, folderId, addedAt: Date.now(), favicon }, ...s.bookmarks] }))
        return id
      },
      removeByUrl: (url) => set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.url !== url) })),
      removeOne: (id) => set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) })),
      isBookmarked: (url) => get().bookmarks.some((b) => b.url === url),
      update: (id, patch) => set((s) => ({ bookmarks: s.bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b)) })),
      addFolder: (name) => { const id = uid('bmf'); set((s) => ({ folders: [...s.folders, { id, name: name || '新文件夹' }] })); return id },
      renameFolder: (id, name) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) })),
      removeFolder: (id) => { if (id === BM_BAR) return; set((s) => ({ folders: s.folders.filter((f) => f.id !== id), bookmarks: s.bookmarks.filter((b) => b.folderId !== id) })) },
      exportHtml: () => toNetscapeHtml(get().folders, get().bookmarks),
      importHtml: (html) => {
        const { folders, bookmarks } = fromNetscapeHtml(html)
        if (!bookmarks.length) return 0
        set((s) => {
          // 合并文件夹(书签栏共用),导入的非书签栏文件夹直接追加
          const existingUrls = new Set(s.bookmarks.map((b) => b.folderId + '|' + b.url))
          const fresh = bookmarks.filter((b) => !existingUrls.has(b.folderId + '|' + b.url))
          return { folders: [...s.folders, ...folders], bookmarks: [...s.bookmarks, ...fresh] }
        })
        return bookmarks.length
      },
    }),
    { name: 'wordspace-bookmarks' },
  ),
)
