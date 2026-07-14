// 工作区文件树的纯逻辑：把主进程走完磁盘得到的「相对路径列表」整理成排序好的嵌套树，
// 外加文件类型判定与工作区根的路径守卫。纯 Node 模块（仅 path，无 require('electron')）→
// node:test 可直接 require（CLAUDE.md S1 教训：纯逻辑与 Electron 解耦才好单测）。
// 镜像 ui-demo/src/lib/tree.ts 的 buildFileTree / 排序语义，但每个节点带 rel（工作区内相对路径），
// 供渲染层把「点了哪个节点」回传给主进程做真实文件操作。
const path = require('path');

// 文件名 → 类型。html/htm 与 md 能在编辑器里打开（md 走读写两端适配）；其余按扩展名归类，仅用于图标 + 「点了走系统默认程序」。
function kindOf(name) {
  if (String(name).indexOf('.') < 0) return 'other'; // 无扩展名（含 README 等）
  const ext = String(name).split('.').pop().toLowerCase();
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
    case 'md': // 单列 kind（不并进 'html'）：保住「这是 md」的信息，将来树上要标
      return 'md';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return 'image';
    case 'pdf':
      return 'pdf';
    case 'doc':
    case 'docx':
      return 'word';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'sheet';
    case 'ppt':
    case 'pptx':
      return 'slides';
    default:
      return 'other';
  }
}

// 文件夹优先，其后文件；同组按名称排序（中文按拼音、数字按数值，对齐 ui-demo）。递归。
function sortNodes(nodes) {
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
  });
  for (const n of nodes) if (n.children.length) sortNodes(n.children);
  return nodes;
}

// 走到（必要时沿途创建）一个目录节点，rel 累积为「a/b/c」。
function ensureDir(root, parts) {
  let cur = root;
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    let next = cur.children.find((c) => c.isDir && c.name === part);
    if (!next) {
      next = { name: part, rel: acc, isDir: true, children: [] };
      cur.children.push(next);
    }
    cur = next;
  }
  return cur;
}

/**
 * 由文件 + 目录列表（均为工作区内相对路径，'/' 分隔）构造排序好的嵌套树。
 * @param files {Array<{path:string, kind?:string}>} 文件，path 形如 '素材/封面.png'
 * @param dirs  {Array<string>} 已知目录（含空目录，让用户显式建的空文件夹也显示——文件夹是一等公民）
 * @returns 顶层节点数组，节点 = { name, rel, isDir, kind?, children }
 */
function buildFileTree(files, dirs = []) {
  const root = { name: '', rel: '', isDir: true, children: [] };
  for (const d of dirs) {
    const parts = String(d).split('/').filter(Boolean);
    if (parts.length) ensureDir(root, parts);
  }
  for (const f of files) {
    const parts = String(f.path).split('/').filter(Boolean);
    if (!parts.length) continue;
    const leaf = parts.pop();
    const parent = parts.length ? ensureDir(root, parts) : root;
    parent.children.push({
      name: leaf,
      rel: f.path,
      isDir: false,
      kind: f.kind || kindOf(leaf),
      ino: f.ino, // 文件 inode（字符串）：改名/移动不变，给「外部改名→标签跟随」做匹配身份；无则 undefined
      children: [],
    });
  }
  return sortNodes(root.children);
}

/**
 * 工作区根约束：把 target（相对或绝对）resolve 到 root 之下，断言没逃逸。返回解析后的绝对路径。
 * 渲染层传来的路径一律不可信——每个文件操作在主进程用它重新 confine，防 '../' / 绝对路径越权
 * （src/main/ipc.js assertHtmlPath 同款威胁模型：篡改 recents/workspace.json 注入任意路径）。
 */
function assertInsideWorkspace(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(r, target);
  if (t !== r && !t.startsWith(r + path.sep)) {
    throw new Error(`path escapes workspace: ${target}`);
  }
  return t;
}

// 剥掉路径分隔符并 trim——改名输入不能凭空造出目录层级（对齐 ui-demo cleanName）。返回 '' 表示无效。
function cleanLeafName(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[/\\]/g, '')
    .trim();
}

// ===== 扫描跳过规则（workspace.walk 与 workspace-watcher 共用同一份判定——两处不一致会造出
// 「watcher 为一个树上根本不存在的路径触发全量重扫」的白烧）=====

// 不进树的噪音：隐藏文件 / 依赖·构建·缓存目录 / 原子写的临时文件。
// B 档只列「工具生成、绝不会是用户文档文件夹名」的目录，且都是文件数炸弹（node_modules 常 10 万+）——
// 不含 build/dist/out/target 这种普通词（怕误伤真文件夹）。点开头的（.git/.next/.cache/.venv/.gradle/.idea/
// .svn/.Spotlight-V100…）已被 isSkippedName 的 name.startsWith('.') 覆盖，不用在这重列。
const IGNORE = new Set([
  'node_modules', '.git', 'bower_components', '__pycache__', 'Pods', 'DerivedData', 'venv',
]);
// macOS 包（package/bundle）：Finder 当单个文件、内部可含上万文件（.app 应用包 / .photoslibrary 照片图库…）。
// 文档工作区里递归钻进去 → 文件数爆炸、readTree 卡死（Wendi「打开桌面特别卡」根因 = 桌面上的 Minecraft.app，
// 一个 .app 内部可几千到十几万文件）。学 Finder：树上显示成单个节点、不往里递归。按后缀判定（够用，不引 UTI）。
const BUNDLE_EXTS = new Set([
  'app', 'framework', 'bundle', 'plugin', 'kext', 'xpc', 'component', 'mdimporter', 'qlgenerator',
  'prefpane', 'wdgt', 'dsym', 'pkg', 'mpkg', 'photoslibrary', 'photolibrary', 'fcpbundle',
  'imovielibrary', 'tvlibrary', 'aplibrary', 'musiclibrary',
]);
function isBundleName(name) {
  const i = String(name).lastIndexOf('.');
  return i > 0 && BUNDLE_EXTS.has(String(name).slice(i + 1).toLowerCase());
}
// Windows / 云盘垃圾文件：靠「隐藏属性」藏身、名字不带点。跨系统同步（共享云盘上的 Windows 同事，
// Wendi 2026-07-14 报的场景）后隐藏属性丢失 → 在 macOS 上现形进树。大小写不敏感（Windows 文件系统
// 保留任意大小写、比较不敏感）。desktop.ini / Thumbs.db（Windows）、$RECYCLE.BIN / System Volume
// Information（外置盘/同步盘残留目录）。`~$xxx.docx` 是 Office 打开文档时的锁文件（`~$` 前缀）。
// `Icon\r` 是 macOS 自定义文件夹图标文件（名字是 "Icon"+回车、靠 UF_HIDDEN 隐藏、也不带点）。
// 已知限制：任意文件上的 macOS chflags hidden（UF_HIDDEN）按名字判不出来，Node fs 读不到 BSD flags——
// 见 docs/features/workspace-file-tree.md 欠账。
const JUNK = new Set(['desktop.ini', 'thumbs.db', 'ehthumbs.db', '$recycle.bin', 'system volume information']);
// 原子写 tmp 命名从 `.ws2tmp` 改成了 `.ws2tmp-<pid>-<seq>`（防并发保存互踩，files.js），endsWith('.ws2tmp')
// 匹配不上新名字 → 存盘时临时文件漏进侧栏树。用 includes 兜住新旧两种命名（不该给用户看的写盘中间产物）。
const isSkippedName = (name) =>
  String(name).startsWith('.') || String(name).includes('.ws2tmp') || IGNORE.has(name) ||
  JUNK.has(String(name).toLowerCase()) || String(name).startsWith('~$') || name === 'Icon\r';

// 整条相对路径（'/' 分隔）是不是「扫描根本不会看见」的噪音——是的话这个磁盘事件不可能改变树，
// watcher 层直接丢弃（.DS_Store / .git 内部 / node_modules 内部的 churn 占外部事件的大头）。
// 中间段是 bundle（.app 内部变化）也算噪音；**最后一段是 bundle 不算**——bundle 自身增删/改名会改父目录列表。
function isNoisePath(relPath) {
  const parts = String(relPath).split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (isSkippedName(parts[i])) return true;
    if (i < parts.length - 1 && isBundleName(parts[i])) return true;
  }
  return false;
}

/**
 * 由 watcher 报来的变化路径列表算「需要重扫的目录」（每条取父目录 = 增删/改名会变的那层列表；
 * 内容变化事件也落在父目录，重扫它顺带刷新该文件 stat）。祖先归并（a 与 a/b 只留 a）。
 * 返回 null = 该走全量重扫：任何路径的父目录是根（''，重扫根子树 = 全量）、或归并后仍超 cap（事件太散，
 * 分头扫不如整扫一次）。
 */
function affectedDirsOf(relPaths, cap = 8) {
  const dirs = new Set();
  for (const p of relPaths) {
    const parts = String(p).split('/').filter(Boolean);
    if (parts.length <= 1) return null; // 根层变化 → 全量
    dirs.add(parts.slice(0, -1).join('/'));
  }
  const sorted = [...dirs].sort((a, b) => a.length - b.length); // 短(浅)的在前,后面的只需对已保留项查前缀
  const kept = [];
  for (const d of sorted) {
    if (!kept.some((k) => d === k || d.startsWith(k + '/'))) kept.push(d);
  }
  if (!kept.length || kept.length > cap) return null;
  return kept;
}

module.exports = {
  buildFileTree, kindOf, sortNodes, assertInsideWorkspace, cleanLeafName,
  isSkippedName, isBundleName, isNoisePath, affectedDirsOf,
};
