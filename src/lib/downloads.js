// 浏览器下载功能的纯逻辑（spec docs/browser-feature-spec.md §4.11）。
// 只在主进程用（will-download 命名管线 + browser-store 第四 cell 的 load 校验），
// 纯 CJS、零 Electron/DOM/React 依赖——node:test 直接 require 单测。照 src/lib/web-history.js 先例。
//
// 两块：
//  ① 从 ui-demo lib/downloads.ts 逐函数移植（语义一字不改，只删 TS 类型 / 换 CJS）：
//     isTerminal / canRetry / canReveal / canRemove / uniquify / stripUniquifySuffix /
//     truncateMiddle / aggregateProgress / filenameFromUrl / formatBytes。
//  ② 真 app 独有（磁盘是真的 → 要防路径穿越、要在 load 时把退出中断的在途翻成 interrupted）：
//     sanitizeFilename / sanitizeDownloads / capDownloads。
//
// entry 形状（与 ui-demo 对齐 + 真 app 加 savePath）：
//   { id, filename, sourceUrl, sizeBytes, receivedBytes, state, startedAt, savePath }
// state 属于 downloading | completed | canceled | failed | interrupted | fileMissing

// —— 状态机判定：逐状态操作集的单一真相源（renderer 经 IPC 载荷取用，别各写各的）——
// 移植自 ui-demo lib/downloads.ts
const isTerminal = (s) => s !== 'downloading';
// 移植自 ui-demo lib/downloads.ts：失败 / 已取消 / 已中断可重试（= 新条目置顶重下）。
const canRetry = (s) => s === 'failed' || s === 'canceled' || s === 'interrupted';
// 移植自 ui-demo lib/downloads.ts：仅完成态可「在访达中显示」。
const canReveal = (s) => s === 'completed';
// 移植自 ui-demo lib/downloads.ts：进行中不可单条移除（只能取消）；其余终态都能移除。
const canRemove = (s) => s !== 'downloading';

/**
 * 移植自 ui-demo lib/downloads.ts。
 * Chrome 式重名消歧：名字已被占用就在扩展名前插 ` (n)`。
 * `报告.pdf` → `报告 (1).pdf` → `报告 (2).pdf`；无扩展名 `foo` → `foo (1)`。
 * taken = 磁盘上已有的名字 ∪ 当前在途下载的名字（调用方组装），绝不覆盖已有文件。
 */
function uniquify(name, taken) {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 1;
  let candidate = `${base} (${n})${ext}`;
  while (taken.has(candidate)) {
    n++;
    candidate = `${base} (${n})${ext}`;
  }
  return candidate;
}

/**
 * 移植自 ui-demo lib/downloads.ts。
 * 去掉一层 ` (n)` 消歧后缀，拿回原始请求名——重试时用它重走一遍 uniquify（否则会叠成 `x (1) (1)`）。
 * `报告 (1).pdf` → `报告.pdf`；`报告.pdf` → `报告.pdf`（无后缀原样返回）。
 */
function stripUniquifySuffix(name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const stripped = base.replace(/ \(\d+\)$/, '');
  return stripped + ext;
}

/**
 * 移植自 ui-demo lib/downloads.ts。
 * 中段截断长文件名：头部 + `…` + 尾部，尾部保住扩展名与 ` (n)` 后缀。
 * 按码点切（Array.from），不切断中文/emoji。整名 title 属性另给（这里只管显示串）。
 */
function truncateMiddle(name, max = 34) {
  const chars = Array.from(name);
  if (chars.length <= max) return name;
  const tail = Math.max(10, Math.floor(max * 0.4));
  const head = Math.max(1, max - tail - 1);
  return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('');
}

/**
 * 移植自 ui-demo lib/downloads.ts。
 * 聚合进度（工具栏进度环，P2）：对「当前批次」条目算 pct = Σ已收 / Σ总量。
 * 批次 = 在途 + 本批内已完成的条目（由调用方的 batchIds 圈定）——完成的留在分子分母里，
 * 单条先完成时环只前进不回退。active = 在途条数（徽标数字）；active 为 0 = 批次结束，环隐藏。
 */
function aggregateProgress(batch) {
  const active = batch.filter((e) => e.state === 'downloading').length;
  if (active === 0) return { active: 0, pct: 0 };
  const recv = batch.reduce((s, e) => s + e.receivedBytes, 0);
  const total = batch.reduce((s, e) => s + e.sizeBytes, 0);
  return { active, pct: total > 0 ? Math.min(1, recv / total) : 0 };
}

/**
 * 移植自 ui-demo lib/downloads.ts。
 * 从 URL 的 path 段派生下载文件名（右键存图 / 链接另存为用）。
 * `https://news.design/img/hero.jpg` → `hero.jpg`；无 path 回落 host + 扩展名。
 */
function filenameFromUrl(url, fallbackExt = '') {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last && /\.[a-z0-9]{1,8}$/i.test(last)) return decodeURIComponent(last);
    if (last) return decodeURIComponent(last) + fallbackExt;
    return u.host.replace(/^www\./, '') + fallbackExt;
  } catch {
    return 'download' + fallbackExt;
  }
}

/** 移植自 ui-demo lib/downloads.ts。人类可读字节：14.2 MB / 680 MB / 320 KB。 */
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

// ================= 真 app 独有 =================

const FALLBACK_NAME = 'download';
// 控制字符 U+0000-001F + RTL/LTR override（U+202A-202E, U+2066-2069）。
// override 字符能让文件名视觉上倒序显示（把可执行名伪装成图片名之类的文件名欺骗），必须剥。
// 用 \u 转义（不写字面控制字符）——字面 NUL 会让 git 把整份源文件当二进制、diff 不出来。
const STRIP_RE = /[\u0000-\u001F\u202A-\u202E\u2066-\u2069]/g;

/**
 * 真 app 独有：清洗磁盘落盘用的文件名（R10 防路径穿越 + 视觉欺骗）。
 *  - 剥控制字符与方向覆盖字符；
 *  - 按路径分隔符（/ \）切段，丢弃 `.` / `..` / 空段再拼回（`../../etc/passwd` → `etcpasswd`）；
 *  - 剥首尾点与空格；
 *  - 空 / 全非法回落 'download'。
 * 只清洗单一名字段，绝不产生跨目录路径——落盘路径由调用方 join(dlDir, name) 锁定在下载目录内。
 */
function sanitizeFilename(name) {
  if (typeof name !== 'string') return FALLBACK_NAME;
  let s = name.replace(STRIP_RE, '');
  s = s
    .split(/[/\\]+/)
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('');
  s = s.replace(/^[.\s]+|[.\s]+$/g, '');
  return s || FALLBACK_NAME;
}

const VALID_STATES = new Set([
  'downloading',
  'completed',
  'canceled',
  'failed',
  'interrupted',
  'fileMissing',
]);

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 真 app 独有：从磁盘 browser-downloads.json 载入时清洗（供 browser-store downloads cell load 用，
 * 镜像 web-history.sanitize）。
 *  - 形状校验：丢弃缺 id / filename 或 state 不在枚举的坏条目（防旧/毒数据）；
 *  - 退出 app 时在途转 interrupted（spec §4.11：磁盘上没有可续的进行中下载）——把所有 downloading 翻 interrupted；
 *  - 数值字段强转（receivedBytes / sizeBytes / startedAt 转数，缺省 0）。
 */
function sanitizeDownloads(rawEntries) {
  if (!Array.isArray(rawEntries)) return [];
  const out = [];
  for (const e of rawEntries) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.id !== 'string' || !e.id) continue;
    if (typeof e.filename !== 'string' || !e.filename) continue;
    if (!VALID_STATES.has(e.state)) continue;
    const state = e.state === 'downloading' ? 'interrupted' : e.state;
    out.push({
      id: e.id,
      filename: e.filename,
      sourceUrl: typeof e.sourceUrl === 'string' ? e.sourceUrl : '',
      sizeBytes: toNum(e.sizeBytes),
      receivedBytes: toNum(e.receivedBytes),
      state,
      startedAt: toNum(e.startedAt),
      savePath: typeof e.savePath === 'string' ? e.savePath : '',
    });
  }
  return out;
}

/**
 * 真 app 独有（移植 ui-demo mock/downloads.ts 的 capped 语义）：CAP 裁剪。
 * entries 新在前（index 0 = 最新）。超上限时从最老端挤**终态**条目；**在途（downloading）绝不挤**。
 */
function capDownloads(entries, cap = 100) {
  if (!Array.isArray(entries)) return [];
  if (entries.length <= cap) return entries;
  const out = entries.slice();
  for (let i = out.length - 1; i >= 0 && out.length > cap; i--) {
    if (isTerminal(out[i].state)) out.splice(i, 1);
  }
  return out;
}

module.exports = {
  isTerminal,
  canRetry,
  canReveal,
  canRemove,
  uniquify,
  stripUniquifySuffix,
  truncateMiddle,
  aggregateProgress,
  filenameFromUrl,
  formatBytes,
  sanitizeFilename,
  sanitizeDownloads,
  capDownloads,
  VALID_STATES,
};
