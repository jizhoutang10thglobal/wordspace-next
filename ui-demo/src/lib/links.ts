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

// —— href 的写/读必须严格对称（对抗审查抓到的 writer/reader 不对称）：文件名里合法的 %/#/? 会
// 撞上 URL 语法，':' 开头段会被误判成 scheme。写端按段最小转义 + './' 消歧，读端按段解码。
// 对称性质：resolveHref(from, relHref(from, to)) === to（任意合法文件名）。
const escSeg = (s: string) => s.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F')
const unescSeg = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s // 不是我们写的编码（手写 href 带裸 %）→ 原样当字面量
  }
}

/** 把 href 拆成 [路径部分, 尾缀(#锚点/?查询,含分隔符)]。写端已把文件名里的 #/? 转义，此处的裸 #/? 必是真分隔符。 */
export function splitHrefSuffix(href: string): [string, string] {
  const m = href.match(/[#?].*$/)
  return m ? [href.slice(0, m.index), m[0]] : [href, '']
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
  const clean = splitHrefSuffix(href)[0]
  if (!clean) return null
  const decoded = clean.split('/').map(unescSeg).join('/')
  return normalizePath((dirOf(fromPath) ? dirOf(fromPath) + '/' : '') + decoded)
}

/** 计算 fromPath → toPath 的文档相对 href（两者都是同根内路径）。输出已按段转义（见 escSeg）。 */
export function relHref(fromPath: string, toPath: string): string {
  const from = dirOf(fromPath).split('/').filter(Boolean)
  const to = toPath.split('/').filter(Boolean)
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  const ups = from.length - i
  const rel = '../'.repeat(ups) + to.slice(i).map(escSeg).join('/')
  const out = rel || escSeg(baseOf(toPath))
  // 首段含 ':' 且无 '../' 前缀时会被读端误判成 scheme（'draft:v2.html'）→ 前缀 './' 消歧
  return !out.startsWith('.') && out.split('/')[0].includes(':') ? './' + out : out
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
 * 统一算法：每条 href 按**旧自身路径**解析出目标 → 目标过 moved 映射 → 按**新自身路径**重算 href。
 * 这同时覆盖三种情况：目标动了（重写指它的链接）、自己动了（自己的出链全部 rebase）、两者同动（子树整体移动时
 * 内部互链保持不变——旧解析+新重算天然抵消）。锚点/查询尾缀（#…/?…）原样保留。
 *
 * **按文件迭代**（不是按 doc）：解析基准必须 = 该文件自己的路径，与写入端（Canvas 按当前 tab 路径写 href）
 * 严格同基准。docId 被多个文件共享（demo 老 seed 的简化）时基准有歧义 → 整篇跳过不重写——宁可保守漏改
 * （断链有修复卡兜底），绝不用错基准反向写坏本来能用的链接。真 app 移植时把「1 文件 = 1 doc」做成断言。
 *
 * 撤销 = 用反向映射再跑一次本函数（幂等、只动 href、不回滚用户内容），别存 blocks 快照整体回滚。
 */
export function rewriteDocsForMoves(
  docs: Doc[],
  files: FileEntry[],
  rootId: string,
  moved: Map<string, string>,
): { docs: Doc[]; changed: { docId: string }[] } {
  const shareCount = new Map<string, number>()
  for (const f of files) if (f.docId) shareCount.set(f.docId, (shareCount.get(f.docId) ?? 0) + 1)
  const byId = new Map(docs.map((d) => [d.id, d]))
  const nextById = new Map<string, Doc>()
  const changed: { docId: string }[] = []
  for (const f of files) {
    if (f.rootId !== rootId || !f.docId) continue
    if ((shareCount.get(f.docId) ?? 0) > 1) continue // 共享 docId：解析基准歧义，跳过（见函数注释）
    const doc = byId.get(f.docId)
    if (!doc) continue
    const own = f.path
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
        const suffix = splitHrefSuffix(href)[1] // #锚点/?查询跟着走，不静默丢
        const newHref = relHref(ownNew, targetNew) + suffix
        if (newHref !== href) {
          a.setAttribute('href', newHref)
          blockChanged = true
        }
      }
      if (!blockChanged) return b
      docChanged = true
      return { ...b, html: div.innerHTML }
    })
    if (docChanged) {
      nextById.set(doc.id, { ...doc, blocks })
      changed.push({ docId: doc.id })
    }
  }
  return { docs: docs.map((d) => nextById.get(d.id) ?? d), changed }
}

/** moved 映射反向（撤销重写用）。 */
export function invertMoves(moved: Map<string, string>): Map<string, string> {
  const inv = new Map<string, string>()
  for (const [k, v] of moved) inv.set(v, k)
  return inv
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

/** 删文件夹的守卫输入：夹**外**文档 → 夹内文件的反链（夹内互链会随删除一起消失，不算断链）。 */
export function computeDirBacklinks(
  files: FileEntry[],
  docs: Doc[],
  rootId: string,
  dirPath: string,
): BacklinkEntry[] {
  const prefix = dirPath + '/'
  const inside = (p: string) => p === dirPath || p.startsWith(prefix)
  const seen = new Set<string>()
  const out: BacklinkEntry[] = []
  for (const f of files) {
    if (f.rootId !== rootId || !inside(f.path)) continue
    for (const e of computeBacklinks(files, docs, rootId, f.path)) {
      if (inside(e.file.path)) continue // 来源也在夹内 → 一起删，不算
      const key = `${e.file.rootId}:${e.file.path}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push(e)
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
