// ============================================================================
// 文档互链的纯逻辑（与真 app 方案同构，见 doc-linking 方案文档）：
// - 磁盘/块 html 里的链接 = 纯净的**文档相对路径** <a href="../notes/另一篇.html">
//   （浏览器裸打开可跳、md 保持 [text](path) 原生、Schema 合规——不用任何自定义属性）。
// - 反链/解析全靠**运行时索引**（这里 = 每次现算；真 app = 可丢弃缓存），绝不写进文件。
// 路径都是「根内相对路径」（FileEntry.path 形态，'品牌/官网首页.html'），跨根 v1 不支持。
// ============================================================================
import type { Doc, FileEntry } from '../types'

/** 上级目录（根内路径），'a/b/c.html' → 'a/b'，根级文件 → ''。 */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

/** 文件名（含扩展名）。 */
export function baseOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

/** 规范化一条根内路径：解 './'、'..'，越过根顶(..多了)返回 null。 */
export function normalizePath(path: string): string | null {
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (!out.length) return null // 越出根 —— 跨根/越界链接，v1 判不可解析
      out.pop()
    } else {
      out.push(seg)
    }
  }
  return out.join('/')
}

/**
 * 把某文档里的相对 href 解析成根内路径。
 * fromPath = 链接所在文件的根内路径；href = 文档相对链接（'../b.html'、'子目录/c.html'）。
 * 绝对 URL（http/https/mailto…）/锚点/越界 → null（不是文档内互链）。
 */
export function resolveHref(fromPath: string, href: string): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) {
    return null
  }
  const clean = href.split('#')[0].split('?')[0]
  if (!clean) return null
  try {
    return normalizePath((dirOf(fromPath) ? dirOf(fromPath) + '/' : '') + decodeURI(clean))
  } catch {
    return null
  }
}

/** 计算 fromPath → toPath 的文档相对 href（两者都是同根内路径）。 */
export function relHref(fromPath: string, toPath: string): string {
  const from = dirOf(fromPath).split('/').filter(Boolean)
  const to = toPath.split('/').filter(Boolean)
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  const ups = from.length - i
  const rel = '../'.repeat(ups) + to.slice(i).join('/')
  return rel || baseOf(toPath)
}

/** 从一段块 html 里抽出所有 <a> 的 href（原样字符串，未解析）。 */
export function extractHrefs(html: string): string[] {
  if (!html || html.indexOf('<a') < 0) return []
  const div = document.createElement('div')
  div.innerHTML = html
  return [...div.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '').filter(Boolean)
}

/** 一篇文档（其文件在 fromPath）指向的所有根内目标路径（去重）。 */
export function outgoingTargets(doc: Doc, fromPath: string): string[] {
  const set = new Set<string>()
  for (const b of doc.blocks) {
    for (const href of extractHrefs(b.html)) {
      const t = resolveHref(fromPath, href)
      if (t) set.add(t)
    }
  }
  return [...set]
}

/** 反链条目：谁（哪个文件/文档）链接到我 + 上下文摘句。 */
export interface BacklinkEntry {
  file: FileEntry
  doc: Doc
  snippet: string // 链接所在块的纯文本（截断），给反链面板做上下文
}

/**
 * 重写一段块 html 里指向 oldTarget 的链接为新相对路径。
 * fromPath = 块所属文件路径（决定相对解析）；映射 = 根内路径 oldPath → newPath。
 * 返回 null 表示无改动（省一次 store 写）。
 */
export function rewriteHrefs(
  html: string,
  fromPath: string,
  moved: Map<string, string>,
): string | null {
  if (!html || html.indexOf('<a') < 0) return null
  const div = document.createElement('div')
  div.innerHTML = html
  let changed = false
  for (const a of div.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || ''
    const target = resolveHref(fromPath, href)
    if (target && moved.has(target)) {
      a.setAttribute('href', relHref(fromPath, moved.get(target)!))
      changed = true
    }
  }
  return changed ? div.innerHTML : null
}

/** 块 html → 纯文本摘句（反链上下文/预览用）。 */
export function snippetOf(html: string, max = 80): string {
  const div = document.createElement('div')
  div.innerHTML = html
  const t = (div.textContent || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

/** doc → 它的文件路径（根内）。共享 docId 的老 seed 文档取第一个映射（demo 简化；真 app 1 文件=1 文档）。 */
export function pathOfDoc(files: FileEntry[], rootId: string, docId: string): string | null {
  const f = files.find((x) => x.rootId === rootId && x.docId === docId)
  return f ? f.path : null
}

/**
 * 文件改名/移动/所在文件夹改名后，重写所有受影响文档里的链接（真 app 的「改名自动重写引用」同款语义）。
 * moved = 根内路径 old → new 的完整映射（单文件改名 = 一条；文件夹改名 = 子树全量）。
 * 统一算法：每个文档把每条 href 按**旧自身路径**解析出目标 → 目标过 moved 映射 → 按**新自身路径**重算 href。
 * 这同时覆盖三种情况：目标动了（重写指它的链接）、自己动了（自己的出链全部 rebase）、两者同动（子树整体移动时
 * 内部互链保持不变——旧解析+新重算天然抵消）。
 * 返回 changed 供 toast 撤销恢复旧块。
 */
export function rewriteDocsForMoves(
  docs: Doc[],
  files: FileEntry[],
  rootId: string,
  moved: Map<string, string>,
): { docs: Doc[]; changed: { docId: string; oldBlocks: Doc['blocks'] }[] } {
  const changed: { docId: string; oldBlocks: Doc['blocks'] }[] = []
  const nextDocs = docs.map((doc) => {
    const own = pathOfDoc(files, rootId, doc.id)
    if (!own) return doc // 不是这个根的文件文档（别的根/临时文档）→ 相对路径体系不同，不动
    const ownNew = moved.get(own) ?? own
    let docChanged = false
    const blocks = doc.blocks.map((b) => {
      if (!b.html || b.html.indexOf('<a') < 0) return b
      const div = document.createElement('div')
      div.innerHTML = b.html
      let blockChanged = false
      for (const a of div.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || ''
        const target = resolveHref(own, href)
        if (!target) continue // 外链/锚点/越界——不是文档互链
        const targetNew = moved.get(target) ?? target
        if (own === ownNew && targetNew === target) continue // 两头都没动
        const newHref = relHref(ownNew, targetNew)
        if (newHref !== href) {
          a.setAttribute('href', newHref)
          blockChanged = true
        }
      }
      if (!blockChanged) return b
      docChanged = true
      return { ...b, html: div.innerHTML }
    })
    if (!docChanged) return doc
    changed.push({ docId: doc.id, oldBlocks: doc.blocks })
    return { ...doc, blocks }
  })
  return { docs: nextDocs, changed }
}

/** 谁链接到 (rootId, path)：扫同根全部文件文档（= 真 app 反链索引的现算版；索引永远是可丢弃缓存）。 */
export function computeBacklinks(
  files: FileEntry[],
  docs: Doc[],
  rootId: string,
  path: string,
): BacklinkEntry[] {
  const out: BacklinkEntry[] = []
  for (const f of files) {
    if (f.rootId !== rootId || !f.docId) continue
    if (f.path === path) continue // 自链不算反链
    const doc = docs.find((d) => d.id === f.docId)
    if (!doc) continue
    for (const b of doc.blocks) {
      if (!b.html || b.html.indexOf('<a') < 0) continue
      const hit = extractHrefs(b.html).some((h) => resolveHref(f.path, h) === path)
      if (hit) {
        out.push({ file: f, doc, snippet: snippetOf(b.html) })
        break // 每个来源文件一条（取首个命中块做上下文）
      }
    }
  }
  return out
}

/** 断链修复候选：同根内文件名相同的文件（真 app 还有 doc-id 全库匹配 + ino 历史，demo 用同名近似）。 */
export function repairCandidates(files: FileEntry[], rootId: string, brokenTarget: string): FileEntry[] {
  const base = baseOf(brokenTarget)
  return files.filter((f) => f.rootId === rootId && f.docId && baseOf(f.path) === base)
}
