import type { Doc } from '../types'

export interface TreeNode {
  name: string
  docId?: string
  emoji?: string
  children: TreeNode[]
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
