/* src/lib/image-ingest.js
 * 图片摄入的**纯逻辑 + 摄入管线**（doc-images spec Phase 1：data: 内联 + 降采样护栏）。
 * 行为权威 = ui-demo/src/lib/image.ts（Colin 实测验收，PR #204），逐字移植其语义。
 * 护栏来源 docs/schema-1-draft-v0.md §5：长边 ≤1600、单图 base64 ≤1.5MB（data: URI 实测
 * ~2MB 起卡 DOM，留余量）；拒 SVG（能内嵌脚本，与校验器同口径）。
 *
 * 纯函数段（planResize/fitsBudget/acceptsImageType/imageBlockHtml/parseImageBlockHtml）
 * 无 DOM / 无 electron，由 test/image-ingest.test.js（node:test）钉死。摄入管线 ingestImage
 * 只在 renderer 父层运行（用 createImageBitmap/canvas/FileReader），node:test 不碰它——
 * 同 format.js「DOM 命令留给 e2e」的分工。
 *
 * 双导出：renderer 里作 window.WS2ImageIngest 全局；node/主进程 require。
 */
(function (global) {
  const MAX_EDGE = 1600;
  const MAX_BASE64_BYTES = 1.5 * 1024 * 1024;

  // 位图白名单。svg 显式排除（可内嵌脚本/外链）；罕见类型（bmp/tiff…）走解码失败兜底。
  const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];

  function acceptsImageType(mime) {
    return ACCEPTED.includes(String(mime || '').toLowerCase());
  }

  // 长边超限则等比缩到 maxEdge，否则原尺寸。
  function planResize(w, h, maxEdge) {
    maxEdge = maxEdge || MAX_EDGE;
    const edge = Math.max(w, h);
    if (edge <= maxEdge || edge <= 0) return { w: w, h: h, scaled: false };
    const k = maxEdge / edge;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), scaled: true };
  }

  // base64 体积预算：data URL 的逗号后长度即 base64 字节数。
  function fitsBudget(dataUrl, maxBytes) {
    maxBytes = maxBytes == null ? MAX_BASE64_BYTES : maxBytes;
    const i = String(dataUrl).indexOf(',');
    return i >= 0 && dataUrl.length - i - 1 <= maxBytes;
  }

  // ---- 块 HTML 的 canonical 构造/解析（图片块的唯一来源，勿手拼）----
  // 两形态都是 Schema 合法顶层块：裸 <img>；有说明时 <figure><img><figcaption>。
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function unescapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&'); // &amp; 最后解，避免把 &amp;lt; 提前解成 <
  }

  function imageBlockHtml(src, alt, caption) {
    const img = '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '">';
    const cap = String(caption == null ? '' : caption).trim();
    return cap ? '<figure>' + img + '<figcaption>' + escapeHtml(cap) + '</figcaption></figure>' : img;
  }

  // 纯正则解析（无 DOM，node:test 可跑）。只消费本模块 imageBlockHtml 产出的 canonical 形态：
  // src 为 data: URL / 根内相对路径（无裸引号或 '>'），alt/caption 由我们 escape，故属性值引号安全。
  // 手写 figure 也尽量兜住（属性顺序无关、figcaption 内联标签剥成文本）。
  function parseImageBlockHtml(html) {
    const s = String(html || '');
    const imgTag = s.match(/<img\b[^>]*>/i);
    if (!imgTag) return null;
    const attr = (name) => {
      const m = imgTag[0].match(new RegExp('\\b' + name + '="([^"]*)"', 'i'));
      return m ? unescapeHtml(m[1]) : '';
    };
    const capM = s.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
    const caption = capM ? unescapeHtml(capM[1].replace(/<[^>]*>/g, '')) : '';
    return { src: attr('src'), alt: attr('alt'), caption: caption };
  }

  // 剪贴板/拖放里挑出可摄入的图片文件（文本优先的判定由调用方做）。
  function pickImageFiles(list) {
    if (!list || !list.files) return [];
    return Array.prototype.slice.call(list.files).filter((f) => acceptsImageType(f.type));
  }

  // ---- 摄入管线（renderer 父层专用；node:test 不调）----
  // File/Blob → 降采样 → data: URL。EXIF 方向在 createImageBitmap 解码时归正。
  // 拒因三类：type（非白名单）/ budget（压后仍超 1.5MB）/ decode（解不开或无 canvas）。
  function blobToDataUrl(b) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(b);
    });
  }

  async function ingestImage(file, opts) {
    opts = opts || {};
    const doc = opts.document || (typeof document !== 'undefined' ? document : null);
    const makeBitmap = opts.createImageBitmap
      || (typeof createImageBitmap !== 'undefined' ? createImageBitmap : null);
    if (!acceptsImageType(file.type)) return { ok: false, reason: 'type' };
    if (!makeBitmap || !doc) return { ok: false, reason: 'decode' };
    let bmp;
    try {
      bmp = await makeBitmap(file); // EXIF 方向在解码时归正
    } catch (e) {
      return { ok: false, reason: 'decode' };
    }
    try {
      const plan = planResize(bmp.width, bmp.height);
      // gif 不重编码（重编码会杀动图）；未缩放且不大的 png/webp 也原样内联，避免无谓质量损失。
      if (!plan.scaled && (file.type === 'image/gif' || file.size <= MAX_BASE64_BYTES * 0.75)) {
        const raw = await blobToDataUrl(file);
        if (fitsBudget(raw)) return { ok: true, src: raw, width: plan.w, height: plan.h };
        if (file.type === 'image/gif') return { ok: false, reason: 'budget' }; // gif 不能有损压，直接拒
      }
      const canvas = doc.createElement('canvas');
      canvas.width = plan.w;
      canvas.height = plan.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return { ok: false, reason: 'decode' };
      ctx.drawImage(bmp, 0, 0, plan.w, plan.h);
      let url = canvas.toDataURL('image/webp', 0.8);
      if (url.indexOf('data:image/webp') !== 0) url = canvas.toDataURL('image/jpeg', 0.8);
      if (!fitsBudget(url)) return { ok: false, reason: 'budget' };
      return { ok: true, src: url, width: plan.w, height: plan.h };
    } finally {
      if (bmp && bmp.close) bmp.close();
    }
  }

  const api = {
    MAX_EDGE: MAX_EDGE,
    MAX_BASE64_BYTES: MAX_BASE64_BYTES,
    acceptsImageType: acceptsImageType,
    planResize: planResize,
    fitsBudget: fitsBudget,
    escapeHtml: escapeHtml,
    unescapeHtml: unescapeHtml,
    imageBlockHtml: imageBlockHtml,
    parseImageBlockHtml: parseImageBlockHtml,
    pickImageFiles: pickImageFiles,
    ingestImage: ingestImage,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2ImageIngest = api;
})(typeof window !== 'undefined' ? window : globalThis);
