/* src/lib/doc-id.js —— U7 双层身份的「修复锚」：wordspace-doc-id meta 注入 + 读取（纯逻辑，可单测）。
 *
 * 定位：相对 href 是主身份；doc-id 是稳定的修复锚——文件被改名/移动后（哪怕引用没自动重写、如 Finder
 * 里手动改的），靠这个跨会话稳定的 id 认出文件搬去哪、给修复卡精准候选。
 *
 * 铁律：① 只在用户主动保存时补（不后台扫描静默改盘，Colin 拍板要明示）② id 不参与合规判定
 * （schema-validate 不看它）③ 字节层最小插入——只在缺失时往 <head> 加一行 meta，不重序列化、其余字节不动。
 *
 * ⚠ 当前只处理有 <head> 的 html（合规文档 + 绝大多数）。无 head 的野生 HTML / md frontmatter 记欠账。
 */
'use strict';

const RE = /<meta\s+name=["']wordspace-doc-id["'][^>]*\scontent=["']([^"']*)["'][^>]*>/i;

// 读一份 html 的 doc-id（没有 → null）。
function readDocId(html) {
  const m = String(html == null ? '' : html).match(RE);
  return m ? m[1] : null;
}

// 确保 html 带 doc-id。已有 → 原样返回。缺失 → 用 opts.id（优先，如从磁盘旧文件读到的）或 opts.gen()
// 生成一个，插到 <head> 开标签后。无 <head> / 没 id 可用 → 不动（changed=false）。
function ensureHtmlDocId(html, opts) {
  const src = String(html == null ? '' : html);
  const existing = readDocId(src);
  if (existing) return { html: src, id: existing, changed: false };
  const id = (opts && opts.id) || (opts && typeof opts.gen === 'function' && opts.gen()) || null;
  if (!id) return { html: src, id: null, changed: false };
  const m = src.match(/<head[^>]*>/i);
  if (!m) return { html: src, id: null, changed: false }; // 无 head：不硬塞（欠账）
  const at = m.index + m[0].length;
  const meta = '<meta name="wordspace-doc-id" content="' + id + '">';
  return { html: src.slice(0, at) + '\n' + meta + src.slice(at), id, changed: true };
}

module.exports = { readDocId, ensureHtmlDocId };
