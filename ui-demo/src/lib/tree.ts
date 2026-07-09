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

/**
 * Compact folders（VS Code `explorer.compactFolders` / JetBrains「Compact Middle Packages」同款，
 * 两家独立收敛 = 深层嵌套的主力解法）：把「只有一个子文件夹、且不含文件」的链合并成一行，
 * name 用 '/' 连接（如 `外部导入/2026/Q3`）——省掉深层单子链的无谓缩进、把有效深度压下来。
 * 合并后 name 含 '/'（文件/文件夹名本身不含 '/'，无歧义），路径拼接照旧正确（parentPath + '/' + name）。
 * 身份/折叠 key/拖放目标/右键操作都落在**最深那级**（VS Code 同款；改名落最深段是它的已知边角，可接受）。
 * 只在单根的子树上跑（RootSection 每根各调一次）→ 天然不跨根合并。
 */
export function compactTree(nodes: FileNode[]): FileNode[] {
  return nodes.map((n) => {
    if (n.file) return n // 文件叶子不动
    let cur = n
    let name = n.name
    // 当前 dir 恰好 1 个子节点且该子是 dir（无 file）→ 并进来，继续往深探
    while (cur.children.length === 1 && !cur.children[0].file) {
      cur = cur.children[0]
      name = name + '/' + cur.name
    }
    return { name, children: compactTree(cur.children) }
  })
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

// ---- 多根文件夹：加根前的嵌套关系判定（调研裁决：禁止真嵌套 + 智能处理）----
// canon：规范化路径用于比较（demo 是假路径，真 app 里还要 realpath 解符号链接）。
// 去尾斜杠 + 折叠大小写（macOS 默认大小写不敏感）。
export function canonPath(p: string): string {
  return p.replace(/\/+$/, '').toLowerCase()
}
export type RootRelation =
  | { rel: 'same'; other: string } // 完全相同路径
  | { rel: 'child'; parent: string } // 新根是某已有根的子目录 → 别单独开，进它里面
  | { rel: 'parent'; children: string[] } // 新根包住了一个或多个已有根 → 确认后吸收
  | { rel: 'independent' } // 无重叠 → 正常加

// 前缀判定必须带分隔符边界，否则 /foo/bar 会误判成 /foo/bar-baz 的父目录。
function isUnder(childCanon: string, parentCanon: string): boolean {
  return childCanon.startsWith(parentCanon + '/')
}
export function classifyRoot(newPath: string, existingPaths: string[]): RootRelation {
  const a = canonPath(newPath)
  for (const ex of existingPaths) {
    if (canonPath(ex) === a) return { rel: 'same', other: ex }
  }
  for (const ex of existingPaths) {
    if (isUnder(a, canonPath(ex))) return { rel: 'child', parent: ex } // 新根在已有根里
  }
  const contained = existingPaths.filter((ex) => isUnder(canonPath(ex), a)) // 已有根在新根里
  if (contained.length) return { rel: 'parent', children: contained }
  return { rel: 'independent' }
}
