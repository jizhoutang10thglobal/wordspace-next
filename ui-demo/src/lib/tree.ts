import type { Doc, FileEntry } from '../types'

export interface TreeNode {
  name: string
  docId?: string
  emoji?: string
  children: TreeNode[]
}

export interface FileNode {
  name: string
  children: FileNode[]
  file?: FileEntry // leaf: a real file in the connected folder
}

/** Folders first, then files; each group sorted by name (zh, numeric-aware). */
function sortFileNodes(nodes: FileNode[]): FileNode[] {
  nodes.sort((a, b) => {
    const aDir = !a.file
    const bDir = !b.file
    if (aDir !== bDir) return aDir ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })
  })
  for (const n of nodes) if (n.children.length) sortFileNodes(n.children)
  return nodes
}

/** Walk to (creating along the way) the directory node for a '/'-joined path. */
function ensureDir(root: FileNode, dirPath: string): FileNode {
  let cur = root
  for (const part of dirPath.split('/').filter(Boolean)) {
    let next = cur.children.find((c) => c.name === part && !c.file)
    if (!next) {
      next = { name: part, children: [] }
      cur.children.push(next)
    }
    cur = next
  }
  return cur
}

/**
 * Build a filesystem tree from a connected folder's file list (any file type).
 * `dirs` lists known directory paths (e.g. freshly created empty subfolders)
 * so a folder with no files in it still shows up. Result is folders-first,
 * name-sorted at every level.
 */
export function buildFileTree(files: FileEntry[], dirs: string[] = []): FileNode[] {
  const root: FileNode = { name: '', children: [] }
  for (const d of dirs) ensureDir(root, d)
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean)
    if (!parts.length) continue
    const dir = parts.slice(0, -1).join('/')
    const leaf = parts[parts.length - 1]
    const parent = dir ? ensureDir(root, dir) : root
    parent.children.push({ name: leaf, file: f, children: [] })
  }
  return sortFileNodes(root.children)
}

/** Build a filesystem-style tree from each doc's localPath (the "local repo" space). */
export function buildLocalTree(docs: Doc[]): TreeNode[] {
  const root: TreeNode = { name: '', children: [] }
  for (const d of docs) {
    const rel = d.localPath.replace(/^~\/Wordspace\/?/, '')
    const parts = rel.split('/').filter(Boolean)
    let cur = root
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1
      if (isFile) {
        cur.children.push({ name: part, docId: d.id, emoji: d.emoji, children: [] })
      } else {
        let next = cur.children.find((c) => c.name === part && !c.docId)
        if (!next) {
          next = { name: part, children: [] }
          cur.children.push(next)
        }
        cur = next
      }
    })
  }
  return root.children
}
