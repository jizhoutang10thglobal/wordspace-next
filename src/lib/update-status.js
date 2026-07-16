// 更新状态机 + 展示模型。纯模块、不带 require('electron')，node:test 直测（S1 教训）。
// main 端：把 electron-updater 事件流折算成整包状态（nextStatus），「available 后要不要自动开下载」
//   这类策略也编码在状态机里（进 downloading = 该下载，main 按 shouldStartDownload 执行），
//   不再各自维护 manualCheck/manualDownloading 布尔（旧 S5 实现靠手工对齐两个标志，MP-7 就是漏对齐）。
// renderer 拿到的 panel/pill 模型也在 main 算好（sandbox:true 下 preload require 不了项目模块），
//   renderer 只管画——所以这里的模型函数覆盖了「UI 长什么样」的全部判定，单测在这层兜。

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
        message: evt.message || '未知错误',
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
// 我们的 Release 约定（docs/releasing.md）：人话说明在最上、`---` 分隔线以下是自动 PR 列表 → 只取线上部分。
function parseReleaseNotes(raw) {
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
    if (lines.length >= 24) break; // 面板别无限长
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
      text: '正在下载更新' + (s.version ? ' v' + s.version : ''),
      percent: pct, // null = 起步中，pill 显示不定进度
    };
  }
  if (s.state === 'ready') {
    return { kind: 'ready', text: '更新已就绪 · 重启安装', percent: 100 };
  }
  return null;
}

// 更新面板的完整展示模型。返回 null = 该状态没有面板内容（idle）。
function panelModel(status, currentVersion) {
  const s = status || initialStatus();
  const v = s.version ? 'v' + s.version : '';
  switch (s.state) {
    case 'checking':
      return { state: 'checking', title: '检查更新', body: [{ t: 'p', text: '正在检查更新…' }], spinner: true, buttons: [] };
    case 'available': {
      const body = s.notes && s.notes.length ? s.notes : [{ t: 'p', text: '这个版本包含功能改进与问题修复。' }];
      return {
        state: 'available',
        title: '发现新版本 ' + v,
        body,
        buttons: [
          { id: 'download', label: '下载并安装', primary: true },
          { id: 'changelog', label: '更新日志', title: '在 wordspace.ai 查看历史版本更新说明' },
          { id: 'close', label: '以后再说' },
        ],
      };
    }
    case 'downloading': {
      const pct = clampPercent(s.percent);
      const detail = pct == null
        ? '正在开始下载…'
        : formatBytes(s.transferred) + ' / ' + formatBytes(s.total) + (s.bytesPerSecond ? ' · ' + formatSpeed(s.bytesPerSecond) : '');
      return {
        state: 'downloading',
        title: '正在下载 ' + (v || '更新'),
        body: [],
        progress: { percent: pct, detail },
        buttons: [{ id: 'close', label: '后台下载' }],
      };
    }
    case 'ready':
      return {
        state: 'ready',
        title: '更新已就绪',
        body: [{ t: 'p', text: (v || '新版本') + ' 已下载完成，重启后生效。' }],
        buttons: [
          { id: 'install', label: '立即重启安装', primary: true },
          { id: 'changelog', label: '更新日志' },
          { id: 'close', label: '稍后（退出时自动安装）' },
        ],
      };
    case 'uptodate':
      return {
        state: 'uptodate',
        title: '检查更新',
        body: [{ t: 'p', text: '已是最新版本' + (currentVersion ? '（当前 v' + currentVersion + '）' : '') + '。' }],
        buttons: [
          { id: 'changelog', label: '最近更新了什么' },
          { id: 'close', label: '好' },
        ],
      };
    case 'error':
      return {
        state: 'error',
        title: '更新出错',
        body: [{ t: 'p', text: s.message || '未知错误' }, { t: 'p', text: '可以稍后再试，或检查网络连接。' }],
        buttons: [
          { id: s.retry === 'download' ? 'download' : 'check', label: '重试', primary: true },
          { id: 'close', label: '关闭' },
        ],
      };
    case 'dev':
      return {
        state: 'dev',
        title: '检查更新',
        body: [{ t: 'p', text: '开发模式无法检查更新，打包后的正式版本才支持。' }],
        buttons: [{ id: 'close', label: '好' }],
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
