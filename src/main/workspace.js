// 工作区的真实文件能力：递归读目录成树、新建文档(模板)、建子文件夹、改名、移动、
// 删除(带临时备份 → 可撤销, 可选丢系统废纸篓)、撤销删除。所有写操作前都用工作区根
// 约束路径(assertInsideWorkspace)防越权。
//
// 保持 electron-free（系统废纸篓走 opts.trashItem 注入），照 recents.js/files.js 把根 / 备份根
// 作参数传入 → node:test 用 tmpdir 直接驱动（CLAUDE.md S1 教训）。
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { buildFileTree, kindOf, assertInsideWorkspace, cleanLeafName, isSkippedName, isBundleName } = require('../lib/file-tree');
const files = require('./files');
const perfDiag = require('./perf-diag');

// 跳过/包 判定挪进 lib/file-tree（isSkippedName / isBundleName / isNoisePath）——
// workspace-watcher 的噪音事件过滤要用同一份规则，两处不一致会白烧全量重扫。
const isBundle = isBundleName;
const skip = isSkippedName;

async function listNames(absDir) {
  try {
    return await fs.readdir(absDir);
  } catch {
    return [];
  }
}
async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
const toRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

// 同目录下不重名的「<base><ext>」（已存在则 <base> 2<ext>…，对齐 ui-demo uniqueFileInDir）。
function uniqueLeaf(taken, base, ext) {
  let name = `${base}${ext}`;
  let n = 2;
  while (taken.has(name)) {
    name = `${base} ${n}${ext}`;
    n++;
  }
  return name;
}

// 条目预算（Colin 拍板 15 万；诊断 D3）：walk 遍历中计数「过 skip 后真正进树的条目」（文件 + 目录），
// 到预算即停止遍历、返回 truncated=true。防大根（家目录/桌面级，几十万~百万条目）把
// walk → 每文件 stat → 建树 → 几百 MB IPC → renderer 堆一路 O(N) 冻死（Colin/Wendi 病根）。
// WS2_TREE_BUDGET 是测试 seam：node:test 直接改 process.env、e2e 经 launch env 传小值；生产不设即恒 15 万。
const DEFAULT_TREE_BUDGET = 150000;
function treeBudget() {
  const v = parseInt(process.env.WS2_TREE_BUDGET, 10);
  return Number.isInteger(v) && v > 0 ? v : DEFAULT_TREE_BUDGET;
}

// 单层预算（P0b lazy 模式，readDir）：一个目录的直接子项超过它 → 截断本层。VS Code 在单目录百万直接
// 子项上也会卡死（issue #281507），全量扫架构没这护栏 renderdir 一次就爆内存。默认 5 万；WS2_DIR_BUDGET
// 是测试 seam（同 WS2_TREE_BUDGET）。跟 treeBudget 是两回事：treeBudget 管「整根走全量还是走 lazy」，
// dirBudget 管「lazy 模式下单层最多渲染多少直接子项」。
const DEFAULT_DIR_BUDGET = 50000;
function dirBudget() {
  const v = parseInt(process.env.WS2_DIR_BUDGET, 10);
  return Number.isInteger(v) && v > 0 ? v : DEFAULT_DIR_BUDGET;
}

// 递归走盘 → { files:[{path,kind}], dirs:[rel], truncated, entryCount }，path/rel 均为工作区内 '/' 分隔相对路径。
// startRel 非空 = 只走该子树（watcher 报了变化目录时的子树级重扫，见 readSubtrees）。
async function walk(root, startRel = '') {
  const filesOut = [];
  const dirsOut = [];
  const budget = treeBudget();
  let count = 0; // 已进树的条目数（文件 + 目录，过 skip 后）
  let truncated = false;
  async function rec(absDir, rel) {
    if (truncated) return;
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip(e.name)) continue;
      if (count >= budget) { truncated = true; return; } // 预算用尽即停（恰好等于预算不算超——第 budget+1 个才触发）
      count++;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        dirsOut.push(childRel);
        if (isBundle(e.name)) continue; // macOS 包：树上显示成一个节点，但不递归进去（否则钻进内部上万文件、卡死）
        await rec(path.join(absDir, e.name), childRel);
        if (truncated) return;
      } else if (e.isFile()) {
        filesOut.push({ path: childRel, kind: kindOf(e.name) });
      }
    }
  }
  await rec(startRel ? path.join(root, startRel.split('/').join(path.sep)) : root, startRel);
  return { files: filesOut, dirs: dirsOut, truncated, entryCount: count };
}

// 并发限流的逐文件 stat 取 ino——无界 Promise.all 在大根上会同时压几万个 stat 进 libuv 线程池
// （默认 4 线程），打开/保存文档的 fs 操作全排在后面 → 整个 app 卡住（Wendi 卡顿病根之一）。
// 分批限流总耗时几乎不变，但别的 I/O 能插队。
const STAT_BATCH = 64;
async function fillInos(rootAbs, fl) {
  for (let i = 0; i < fl.length; i += STAT_BATCH) {
    await Promise.all(
      fl.slice(i, i + STAT_BATCH).map(async (f) => {
        try {
          const st = await fs.stat(path.join(rootAbs, f.path.split('/').join(path.sep)), { bigint: true });
          f.ino = String(st.ino);
        } catch {
          f.ino = undefined;
        }
      }),
    );
  }
}

// IPC 载荷字节估算（诊断 §7 盲区）：O(N) 从 rel 长度粗估，不真 JSON.stringify——真序列化会给普通根加一
// 整趟 O(N) 大字符串分配（红线：普通根零回归）。每文件 ≈ rel*2(abs 同量级) + kind/ino/结构常量；目录同理。
function estPayloadBytes(fl, dirs) {
  let n = 0;
  for (const f of fl) n += (f.path.length + 2) * 2 + 140;
  for (const d of dirs) n += (d.length + 2) * 2 + 80;
  return n;
}

// 给每个节点补绝对路径（主进程算路径，渲染层不做路径运算——点 .html 直接用 abs 喂 openDoc）。
function addAbs(nodes, root) {
  for (const n of nodes) {
    n.abs = path.join(root, n.rel.split('/').join(path.sep));
    if (n.children.length) addAbs(n.children, root);
  }
  return nodes;
}

// 读整个工作区为排序好的树（节点带 rel + abs + ino）。
// ino（inode，文件在磁盘上的唯一身份号，改名/移动不变）给「外部改名/移动 → 标签跟随」做匹配身份。
// 并行 stat 填充（bigint 防大 inode 精度丢失，转字符串作比较键）；stat 失败留 undefined（该文件退化成「删=关标签」）。
async function readTree(root) {
  const r = path.resolve(root);
  const __t0 = process.hrtime.bigint(); // 诊断探针：量整个 readTree（walk + 每文件 stat）的墙钟成本
  // 修 SB-3/MP-3：根不可达（外部删除/改名 / 网络盘断连 / U 盘拔出）时返回 null，与「根在但空」区分开——
  // 否则 walk 对读不到的根静默返回空树 → renderer 把它当「文件夹空了」，reconcile 清空全部标签+置顶并持久化，
  // 盘回来也回不来。onTreeChanged 对 null 现成 return（不 reconcile 不写盘），保持现状。
  try { const st = await fs.stat(r); if (!st.isDirectory()) return null; } catch { return null; }
  // 「可 stat 不可 readdir」（EACCES 权限收回 / EIO / TCC 拒授权）同样算不可达（对抗审查 MR-ADV-3）：
  // stat 只要祖先的 execute 位就能过，walk 对 readdir 失败又静默吞成空树 → 半失联的根被当成「空了」，
  // 标签+置顶全被 reconcile 清光。根层 readdir 探一次，抛错即 null；子目录级失败维持吞掉（局部问题局部退化）。
  try { await fs.readdir(r); } catch { return null; }
  const { files: fl, dirs, truncated, entryCount } = await walk(r);
  // 超条目预算（D3）：**不建局部树、不 fillInos**——半棵树比没有更误导，且 15 万次 stat + 几百 MB IPC
  // + renderer 再存一份正是「卡死」本体。回空树 + truncated 旗标，renderer 据此渲染「过大」提示行 + 移除
  // 入口、并对该根的 watcher 事件 no-op（不重扫）。tree=[] 保证 IPC 载荷恒定微小。
  if (truncated) {
    perfDiag.recordRead(r, Number(process.hrtime.bigint() - __t0) / 1e6, entryCount, { dirCount: dirs.length, bytes: 0 });
    return { root: r, name: path.basename(r), tree: [], truncated: true, entryCount };
  }
  await fillInos(r, fl);
  perfDiag.recordRead(r, Number(process.hrtime.bigint() - __t0) / 1e6, fl.length, { dirCount: dirs.length, bytes: estPayloadBytes(fl, dirs) });
  return { root: r, name: path.basename(r), tree: addAbs(buildFileTree(fl, dirs), r) };
}

// 子树级重扫（watcher 报得出变化路径时的便宜路径，替代全量 readTree）：只重扫受影响目录，
// 返回每个目录排好序的 children，节点形状与 readTree 完全一致（rel/abs/ino/kind，rel 均相对根）。
// 目录在事件与扫描之间被删/改名 → 上移到最近还存在的祖先目录；上移到根 → 返回 null（调用方回落全量）。
// 段里带 skip/bundle 的目录直接略过（扫描本来就看不见它，patch 进树反而引入全量扫不出的幽灵节点）。
async function readSubtrees(root, dirRels) {
  const r = path.resolve(root);
  const __t0 = process.hrtime.bigint();
  const resolved = new Set();
  for (const d of dirRels || []) {
    let rel = String(d || '');
    if (!rel) return null; // '' 属全量，不该走这条路
    assertInsideWorkspace(r, rel);
    if (rel.split('/').some((s) => isSkippedName(s) || isBundleName(s))) continue;
    while (rel) {
      try {
        const st = await fs.stat(path.join(r, rel.split('/').join(path.sep)));
        if (st.isDirectory()) break;
      } catch { /* 不存在 → 上移一层 */ }
      rel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    }
    if (!rel) return null; // 波及根层 → 全量
    resolved.add(rel);
  }
  // 祖先归并（上移后可能出现包含关系，a 与 a/b 只扫 a）
  const kept = [];
  for (const d of [...resolved].sort((a, b) => a.length - b.length)) {
    if (!kept.some((k) => d === k || d.startsWith(k + '/'))) kept.push(d);
  }
  const subtrees = [];
  for (const dirRel of kept) {
    const { files: fl, dirs } = await walk(r, dirRel);
    await fillInos(r, fl);
    // buildFileTree 吃根相对路径 → 结果树含 dirRel 的祖先链；把 dirRel 自己也报成已知目录（空目录也有节点），
    // 然后顺链取到 dirRel 节点的 children。
    let nodes = buildFileTree(fl, [...dirs, dirRel]);
    let node = null;
    for (const part of dirRel.split('/')) {
      node = nodes.find((n) => n.isDir && n.name === part);
      if (!node) break;
      nodes = node.children;
    }
    subtrees.push({ dir: dirRel, children: node ? addAbs(node.children, r) : [] });
  }
  perfDiag.recordScoped(r, Number(process.hrtime.bigint() - __t0) / 1e6);
  return { subtrees };
}

// 单层读取（P0b lazy 模式：展开哪层读哪层，VS Code 路线）。只 readdir 一层、不递归、不 stat（无 ino）——
// 这是「过大」根（超 treeBudget、走 lazy 的根）能秒级浏览的核心：成本 O(本层直接子项)、与整棵树规模无关。
// dirRel '' = 根本身。返回 { dir, children:[…], truncated, entryCount }，children 节点形状对齐 readTree
//（name/rel/abs/isDir/kind，dir 带 childrenLoaded），但**无 ino**（lazy 根走路径匹配、不做 inode 跟随，V3）。
// 复用 walk 的跳过规则（isSkippedName/isBundleName）；bundle 目录（.app）标 childrenLoaded=true+空 children
//（树上是单节点、不钻进去，与全量 walk 一致）。单层预算 dirBudget：直接子项超它 → 截断 + truncated。
// assertInsideWorkspace 约束 dirRel（渲染层路径不可信，同 readSubtrees 威胁模型）。
async function readDir(root, dirRel = '') {
  const r = path.resolve(root);
  const rel = String(dirRel || '');
  const absDir = rel ? assertInsideWorkspace(r, rel) : r;
  const __t0 = process.hrtime.bigint();
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    perfDiag.recordDirRead(r, Number(process.hrtime.bigint() - __t0) / 1e6);
    return { dir: rel, children: [], truncated: false, entryCount: 0 }; // 不可达/权限：空层（父级仍在，别当整根失联）
  }
  const budget = dirBudget();
  const nodes = [];
  let count = 0;
  let truncated = false;
  for (const e of entries) {
    if (skip(e.name)) continue;
    if (count >= budget) { truncated = true; break; } // 恰好等于预算不算超——第 budget+1 个才触发（同 walk）
    count++;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    const abs = path.join(absDir, e.name);
    if (e.isDirectory()) {
      // bundle（.app 等）：树上单节点、不递归（childrenLoaded=true+空，避免 lazy 展开钻进去上万文件）
      nodes.push({ name: e.name, rel: childRel, abs, isDir: true, children: [], childrenLoaded: isBundle(e.name) });
    } else if (e.isFile()) {
      nodes.push({ name: e.name, rel: childRel, abs, isDir: false, kind: kindOf(e.name), children: [] });
    }
  }
  // 与 buildFileTree/sortNodes 同口径排序（文件夹优先，同组中文拼音/数字）——lazy 层与全量树观感一致。
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
  });
  perfDiag.recordDirRead(r, Number(process.hrtime.bigint() - __t0) / 1e6);
  return { dir: rel, children: nodes, truncated, entryCount: count };
}

// 在 dirRel 目录里新建一个 .html（内容由调用方给——模板 HTML）。dirRel '' = 工作区根。
async function newDoc(root, dirRel, baseName, html, ext) {
  const e = ext === '.md' ? '.md' : '.html'; // U4 断链「新建」尊重断链后缀；默认 .html（@新建/旧调用方不传）
  const r = path.resolve(root);
  const destDir = assertInsideWorkspace(r, dirRel || '.');
  const base = cleanLeafName(baseName) || '未命名';
  await fs.mkdir(destDir, { recursive: true });
  const leaf = uniqueLeaf(new Set(await listNames(destDir)), base, e);
  const abs = assertInsideWorkspace(r, path.join(destDir, leaf));
  await files.writeDocSafe(abs, html); // 原子写、拒空——字节层落盘,不过编辑器序列化器
  return { rel: toRel(r, abs), abs };
}

// 列出根内所有文档文件（.html/.htm/.md）的根内相对路径。U5 改名/移动重写要逐文档扫 href。
async function listDocs(root) {
  const { files } = await walk(path.resolve(root));
  return files.filter((f) => /\.(html?|md)$/i.test(f.path)).map((f) => f.path);
}

// 在 dirRel 下建子文件夹。
async function makeDir(root, dirRel, name) {
  const r = path.resolve(root);
  const parent = assertInsideWorkspace(r, dirRel || '.');
  const base = cleanLeafName(name) || '新建文件夹';
  const leaf = uniqueLeaf(new Set(await listNames(parent)), base, '');
  const abs = assertInsideWorkspace(r, path.join(parent, leaf));
  await fs.mkdir(abs, { recursive: true });
  return { rel: toRel(r, abs), abs };
}

// 编辑器能打开的文档后缀——改名不改格式（P3-03）的判定用同一份。
const DOC_EXTS = new Set(['.html', '.htm', '.md']);

// 改名：保留扩展名(文件)，同目录去重，剥非法字符。
// P3-03「改名不改格式」：文档文件（原后缀 ∈ DOC_EXTS）时，若用户输入本身以某个已知文档后缀结尾，
// 剥掉它再拼回原后缀——避免「火箭.md」落成「火箭.md.html」双后缀，也避免「火箭.html」变「火箭.html.html」。
// 输入后缀与原后缀不同（想换格式）→ v1 不做真转换（md↔html 是格式转换、乱改会坏文件），仍保原后缀 +
// 回 formatKept=true 让上层 toast 引导走「另存为/导出」。非文档后缀（.txt）继续当 base 一部分、维持现状。
async function renamePath(root, relPath, newLeaf) {
  const r = path.resolve(root);
  const abs = assertInsideWorkspace(r, relPath);
  let base = cleanLeafName(newLeaf);
  if (!base) throw new Error('empty name');
  const isDir = (await fs.stat(abs)).isDirectory();
  const ext = isDir ? '' : path.extname(abs);
  let formatKept = false;
  if (!isDir && DOC_EXTS.has(ext.toLowerCase())) {
    const typedExt = path.extname(base);
    if (DOC_EXTS.has(typedExt.toLowerCase())) {
      base = base.slice(0, base.length - typedExt.length);
      if (typedExt.toLowerCase() !== ext.toLowerCase()) formatKept = true;
    }
  }
  if (!base) throw new Error('empty name'); // 剥后只剩空（用户只输了「.md」）——拒绝
  const dir = path.dirname(abs);
  const taken = new Set((await listNames(dir)).filter((n) => n !== path.basename(abs)));
  const dest = assertInsideWorkspace(r, path.join(dir, uniqueLeaf(taken, base, ext)));
  if (dest === abs) return { rel: relPath, abs, formatKept };
  await fs.rename(abs, dest);
  return { rel: toRel(r, dest), abs: dest, formatKept };
}

// 移动到 destDirRel（'' = 根）。同目录 = no-op；不许移进自己子树；目标内去重。
async function movePath(root, relPath, destDirRel) {
  const r = path.resolve(root);
  const abs = assertInsideWorkspace(r, relPath);
  const destDir = assertInsideWorkspace(r, destDirRel || '.');
  if (path.dirname(abs) === destDir) return { rel: relPath, abs };
  if (destDir === abs || destDir.startsWith(abs + path.sep)) throw new Error('cannot move into itself');
  const leaf = path.basename(abs);
  const ext = path.extname(leaf);
  const baseName = leaf.slice(0, leaf.length - ext.length);
  await fs.mkdir(destDir, { recursive: true });
  const dest = assertInsideWorkspace(
    r,
    path.join(destDir, uniqueLeaf(new Set(await listNames(destDir)), baseName, ext)),
  );
  await fs.rename(abs, dest);
  return { rel: toRel(r, dest), abs: dest };
}

// 跨根移动到另一个根的 destDirRel（'' = 目标根根目录）。v1「便宜档」：直接试 rename——同一文件系统
// （绝大多数场景）瞬间成功；真跨盘 fs.rename 抛 EXDEV，原样上抛（ipc 层按 code 分流成 toast，不做复制回退）。
// 双侧 assertInsideWorkspace 防越权；目标撞名走同款 uniqueLeaf 去重（绝不覆盖占位文件，同 movePath）。
// opts.renameFn 是测试 seam（照 deletePath 注入 trashItem 先例）：单测注入抛 EXDEV 的假 rename，真 tmp 目录
// 造不出跨文件系统。「移进自己子树」在跨根不可能发生（嵌套禁令保证两根永不重叠），无需防。
async function movePathAcross(srcRoot, relPath, destRoot, destDirRel, opts = {}) {
  const sr = path.resolve(srcRoot);
  const dr = path.resolve(destRoot);
  const abs = assertInsideWorkspace(sr, relPath);
  const destDir = assertInsideWorkspace(dr, destDirRel || '.');
  const leaf = path.basename(abs);
  const ext = path.extname(leaf);
  const baseName = leaf.slice(0, leaf.length - ext.length);
  await fs.mkdir(destDir, { recursive: true });
  const dest = assertInsideWorkspace(
    dr,
    path.join(destDir, uniqueLeaf(new Set(await listNames(destDir)), baseName, ext)),
  );
  await (opts.renameFn || fs.rename)(abs, dest);
  return { rel: toRel(dr, dest), abs: dest };
}

// 删除(文件或整棵子树),先拷进 backupRoot/<token>/ 留撤销;可选 opts.trashItem(abs) 丢系统废纸篓。
async function deletePath(root, relPath, backupRoot, opts = {}) {
  const r = path.resolve(root);
  const abs = assertInsideWorkspace(r, relPath);
  const token = `del-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const backupDir = path.join(backupRoot, token);
  await fs.mkdir(backupDir, { recursive: true });
  await fs.cp(abs, path.join(backupDir, path.basename(abs)), { recursive: true });
  await fs.writeFile(
    path.join(backupDir, 'manifest.json'),
    JSON.stringify({ rel: relPath, leaf: path.basename(abs), at: Date.now() }),
    'utf8',
  );
  if (opts.trashItem) await Promise.resolve(opts.trashItem(abs)).catch(() => {});
  await fs.rm(abs, { recursive: true, force: true });
  return { token, rel: relPath };
}

// 撤销删除：从备份还原回原位（原位被占则去重），清掉该备份。
async function undoDelete(root, token, backupRoot) {
  const r = path.resolve(root);
  // 修 MP-16：token 直接进 path.join，畸形值（含 ../ 或分隔符）能把 backupDir 指出 backupRoot。加固：
  // 只认 deletePath 生成的格式（del-<base36>-<hex>），不符即拒——正常 UI 流不可达，防御 renderer 被攻破。
  if (!/^del-[0-9a-z]+-[0-9a-f]+$/.test(String(token || ''))) throw new Error('非法的撤销令牌');
  const backupDir = path.join(backupRoot, token);
  const manifest = JSON.parse(await fs.readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
  const origAbs = assertInsideWorkspace(r, manifest.rel);
  let dest = origAbs;
  if (await exists(dest)) {
    const dir = path.dirname(origAbs);
    const leaf = path.basename(origAbs);
    const ext = path.extname(leaf);
    const base = leaf.slice(0, leaf.length - ext.length);
    dest = path.join(dir, uniqueLeaf(new Set(await listNames(dir)), base, ext));
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(path.join(backupDir, manifest.leaf), dest, { recursive: true });
  await fs.rm(backupDir, { recursive: true, force: true });
  return { rel: toRel(r, dest), abs: dest };
}

// 清掉过期的删除备份（未撤销的会堆积）。在 app 启动 / 删除时机会性调用。
async function sweepBackups(backupRoot, maxAgeMs = 24 * 60 * 60 * 1000) {
  let dirs;
  try {
    dirs = await fs.readdir(backupRoot);
  } catch {
    return;
  }
  const now = Date.now();
  for (const d of dirs) {
    const mf = path.join(backupRoot, d, 'manifest.json');
    try {
      const { at } = JSON.parse(await fs.readFile(mf, 'utf8'));
      if (now - at > maxAgeMs) await fs.rm(path.join(backupRoot, d), { recursive: true, force: true });
    } catch {
      /* 损坏的备份目录也清掉 */
      await fs.rm(path.join(backupRoot, d), { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  readTree,
  readSubtrees,
  readDir,
  listDocs,
  newDoc,
  makeDir,
  renamePath,
  movePath,
  movePathAcross,
  deletePath,
  undoDelete,
  sweepBackups,
};
