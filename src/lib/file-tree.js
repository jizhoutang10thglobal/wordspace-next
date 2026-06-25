// 工作区文件树的纯逻辑：把主进程走完磁盘得到的「相对路径列表」整理成排序好的嵌套树，
// 外加文件类型判定与工作区根的路径守卫。纯 Node 模块（仅 path，无 require('electron')）→
// node:test 可直接 require（CLAUDE.md S1 教训：纯逻辑与 Electron 解耦才好单测）。
// 镜像 ui-demo/src/lib/tree.ts 的 buildFileTree / 排序语义，但每个节点带 rel（工作区内相对路径），
// 供渲染层把「点了哪个节点」回传给主进程做真实文件操作。
const path = require('path');

// 文件名 → 类型。只有 html/htm 能在编辑器里打开；其余按扩展名归类，仅用于图标 + 「点了走系统默认程序」。
function kindOf(name) {
  if (String(name).indexOf('.') < 0) return 'other'; // 无扩展名（含 README 等）
  const ext = String(name).split('.').pop().toLowerCase();
  switch (ext) {
    case 'html':
    case 'htm':
      return 'html';
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

module.exports = { buildFileTree, kindOf, sortNodes, assertInsideWorkspace, cleanLeafName };
