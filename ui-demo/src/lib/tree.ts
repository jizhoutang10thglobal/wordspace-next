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

/** Build a filesystem tree from a connected folder's file list (any file type). */
export function buildFileTree(files: FileEntry[]): FileNode[] {
  const root: FileNode = { name: '', children: [] }
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean)
    let cur = root
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1
      if (isFile) {
        cur.children.push({ name: part, file: f, children: [] })
      } else {
        let next = cur.children.find((c) => c.name === part && !c.file)
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
