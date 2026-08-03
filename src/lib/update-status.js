// 更新状态机 + 展示模型。纯模块、不带 require('electron')，node:test 直测（S1 教训）。
// main 端：把 electron-updater 事件流折算成整包状态（nextStatus），「available 后要不要自动开下载」
//   这类策略也编码在状态机里（进 downloading = 该下载，main 按 shouldStartDownload 执行），
//   不再各自维护 manualCheck/manualDownloading 布尔（旧 S5 实现靠手工对齐两个标志，MP-7 就是漏对齐）。
// renderer 拿到的 panel/pill 模型也在 main 算好（sandbox:true 下 preload require 不了项目模块），
//   renderer 只管画——所以这里的模型函数覆盖了「UI 长什么样」的全部判定，单测在这层兜。
const i18n = require('./i18n');

function initialStatus() {
  return {
    state: 'idle', // idle | checking | available | downloading | ready | uptodate | error | dev
    manual: false, // 是否用户手动发起（决定弹面板还是只挂 pill；checking 事件打上后向后续事件继承）
    version: null,
    notes: null, // parseReleaseNotes 的产物：[{t:'h'|'li'|'p', text}]
    percent: null, // null = 下载已开始但还没有首个进度事件
    transferred: null,
    total: null,
    bytesPerSecond: null,
    message: null, // error 态的人话说明
    retry: null, // error 态重试语义：'check' | 'download'
  };
}

function nextStatus(prev, evt) {
  const p = prev || initialStatus();
  switch (evt.type) {
    case 'checking':
      return { ...initialStatus(), state: 'checking', manual: !!evt.manual };
    case 'available': {
      const base = { ...p, version: evt.version || null, notes: evt.notes || null };
      // 自动路径（启动检查）：保持既有静默下载策略 → 直接进 downloading；手动路径停在 available 等用户点。
      return p.manual ? { ...base, state: 'available' } : { ...base, state: 'downloading', percent: null };
    }
    case 'not-available':
      return p.manual ? { ...p, state: 'uptodate' } : { ...p, state: 'idle' };
    case 'download-started': // 用户在面板点「下载」/ error 态点「重试下载」
      return { ...p, state: 'downloading', percent: null, message: null, retry: null };
    case 'progress':
      return {
        ...p,
        state: 'downloading',
        percent: typeof evt.percent === 'number' ? evt.percent : p.percent,
        transferred: evt.transferred != null ? evt.transferred : p.transferred,
        total: evt.total != null ? evt.total : p.total,
        bytesPerSecond: evt.bytesPerSecond != null ? evt.bytesPerSecond : p.bytesPerSecond,
      };
    case 'downloaded':
      return { ...p, state: 'ready', version: evt.version || p.version, percent: 100 };
    case 'error': {
      // 静默自动检查失败（没在下载、也不是手动查）→ 回 idle 不打扰用户，文件日志兜底可查。
      const visible = p.manual || p.state === 'downloading' || p.state === 'ready';
      if (!visible) return { ...p, state: 'idle' };
      return {
        ...p,
        state: 'error',
        message: evt.message || i18n.t('update.unknownError'),
        retry: p.state === 'downloading' ? 'download' : 'check',
      };
    }
    case 'dev-check': // dev（未打包）态点「检查更新…」
      return { ...initialStatus(), state: 'dev', manual: true };
    default:
      return p;
  }
}

// 「该不该真正调 downloadUpdate()」的唯一判定：状态刚跨进 downloading。
// 覆盖三条入口：自动路径 available 直落、手动点下载、error 重试；进度更新（downloading→downloading）不算。
function shouldStartDownload(prev, next) {
  return next.state === 'downloading' && (!prev || prev.state !== 'downloading');
}

// GitHub release body → 面板可读的纯文本行。输出只当 textContent 用（绝不 innerHTML，release body 不可信）。
// 我们的 Release 约定（docs/releasing.md）：**顶部放简洁版**（1 句导语 + ≤5 条要点；app 面板显示的
// 就是这段，Wendi 2026-07-17「更新通知尽量简洁,完整的放 changelog」）、`---` 以下是链接与自动 PR 列表
// → 只取线上部分。opts.max 是硬保险：万一谁把全量 changelog 贴上来，截断并以 opts.moreText 收尾
// （面板本就有「更新日志」按钮直达完整版）。
function parseReleaseNotes(raw, opts) {
  const max = (opts && opts.max) || 24;
  const moreText = (opts && opts.moreText) || null;
  let text = '';
  if (Array.isArray(raw)) text = raw.map((n) => (n && (n.note || '')) || '').join('\n');
  else if (typeof raw === 'string') text = raw;
  if (!text) return [];
  text = text.replace(/<!--[\s\S]*?-->/g, ''); // <!-- ws-note --> 等标记注释
  const cut = text.search(/^\s*-{3,}\s*$/m);
  if (cut !== -1) text = text.slice(0, cut);
  text = text.replace(/<[^>]+>/g, ''); // provider 可能给 HTML 化的 body，剥掉标签只留文本
  const lines = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line) continue;
    let t = 'p';
    if (/^#{1,6}\s/.test(line)) { t = 'h'; line = line.replace(/^#{1,6}\s+/, ''); }
    else if (/^[-*+]\s/.test(line)) { t = 'li'; line = line.replace(/^[-*+]\s+/, ''); }
    line = line
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .trim();
    if (!line) continue;
    lines.push({ t, text: line });
    if (lines.length >= max) break; // 面板别无限长
  }
  // 真被截断（还有剩余非空行没进来）→ 尾行提示去看完整版
  if (moreText && lines.length >= max) {
    const seen = lines.length;
    const totalNonEmpty = text.split('\n').map((l) => l.trim()).filter(Boolean).length;
    if (totalNonEmpty > seen) lines.push({ t: 'p', text: moreText });
  }
  return lines;
}

function formatBytes(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
  if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

function formatSpeed(bps) {
  const s = formatBytes(bps);
  return s ? s + '/s' : '';
}

function clampPercent(percent) {
  if (typeof percent !== 'number' || !isFinite(percent)) return null;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

// 侧栏底部 pill：只在「后台有事发生」的两个状态出现，其余一律 null（不占地）。
function pillModel(status) {
  const s = status || initialStatus();
  if (s.state === 'downloading') {
    const pct = clampPercent(s.percent);
    return {
      kind: 'downloading',
      text: i18n.t('update.pillDownloading') + (s.version ? ' v' + s.version : ''),
      percent: pct, // null = 起步中，pill 显示不定进度
    };
  }
  if (s.state === 'ready') {
    return { kind: 'ready', text: i18n.t('update.pillReady'), percent: 100 };
  }
  return null;
}

// 更新面板的完整展示模型。返回 null = 该状态没有面板内容（idle）。
function panelModel(status, currentVersion) {
  const s = status || initialStatus();
  const v = s.version ? 'v' + s.version : '';
  switch (s.state) {
    case 'checking':
      return { state: 'checking', title: i18n.t('update.checkTitle'), body: [{ t: 'p', text: i18n.t('update.checking') }], spinner: true, buttons: [] };
    case 'available': {
      const body = s.notes && s.notes.length ? s.notes : [{ t: 'p', text: i18n.t('update.availableFallback') }];
      return {
        state: 'available',
        title: i18n.t('update.availableTitle', { v }),
        body,
        buttons: [
          { id: 'download', label: i18n.t('update.downloadInstall'), primary: true },
          { id: 'changelog', label: i18n.t('update.changelogBtn'), title: i18n.t('update.changelogTip') },
          { id: 'close', label: i18n.t('update.later') },
        ],
      };
    }
    case 'downloading': {
      const pct = clampPercent(s.percent);
      const detail = pct == null
        ? i18n.t('update.startingDownload')
        : formatBytes(s.transferred) + ' / ' + formatBytes(s.total) + (s.bytesPerSecond ? ' · ' + formatSpeed(s.bytesPerSecond) : '');
      return {
        state: 'downloading',
        title: i18n.t('update.downloadingTitle', { target: v || i18n.t('update.updateNoun') }),
        body: [],
        progress: { percent: pct, detail },
        buttons: [{ id: 'close', label: i18n.t('update.downloadInBackground') }],
      };
    }
    case 'ready':
      return {
        state: 'ready',
        title: i18n.t('update.readyTitle'),
        body: [{ t: 'p', text: i18n.t('update.readyBody', { target: v || i18n.t('update.newVersionNoun') }) }],
        buttons: [
          { id: 'install', label: i18n.t('update.restartNow'), primary: true },
          { id: 'changelog', label: i18n.t('update.changelogBtn') },
          { id: 'close', label: i18n.t('update.laterAutoInstall') },
        ],
      };
    case 'uptodate':
      return {
        state: 'uptodate',
        title: i18n.t('update.checkTitle'),
        body: [{ t: 'p', text: currentVersion ? i18n.t('update.uptodateWithVer', { ver: currentVersion }) : i18n.t('update.uptodate') }],
        buttons: [
          { id: 'changelog', label: i18n.t('update.recentChanges') },
          { id: 'close', label: i18n.t('common.ok') },
        ],
      };
    case 'error':
      return {
        state: 'error',
        title: i18n.t('update.errorTitle'),
        body: [{ t: 'p', text: s.message || i18n.t('update.unknownError') }, { t: 'p', text: i18n.t('update.errorHint') }],
        buttons: [
          { id: s.retry === 'download' ? 'download' : 'check', label: i18n.t('common.retry'), primary: true },
          { id: 'close', label: i18n.t('common.close') },
        ],
      };
    case 'dev':
      return {
        state: 'dev',
        title: i18n.t('update.checkTitle'),
        body: [{ t: 'p', text: i18n.t('update.devMode') }],
        buttons: [{ id: 'close', label: i18n.t('common.ok') }],
      };
    default:
      return null;
  }
}

module.exports = {
  initialStatus,
  nextStatus,
  shouldStartDownload,
  parseReleaseNotes,
  formatBytes,
  formatSpeed,
  clampPercent,
  pillModel,
  panelModel,
};
