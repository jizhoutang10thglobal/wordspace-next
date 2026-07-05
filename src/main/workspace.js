// 工作区的真实文件能力：递归读目录成树、新建文档(模板)、建子文件夹、改名、移动、
// 删除(带临时备份 → 可撤销, 可选丢系统废纸篓)、撤销删除。所有写操作前都用工作区根
// 约束路径(assertInsideWorkspace)防越权。
//
// 保持 electron-free（系统废纸篓走 opts.trashItem 注入），照 recents.js/files.js 把根 / 备份根
// 作参数传入 → node:test 用 tmpdir 直接驱动（CLAUDE.md S1 教训）。
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { buildFileTree, kindOf, assertInsideWorkspace, cleanLeafName } = require('../lib/file-tree');
const files = require('./files');

// 不进树的噪音：隐藏文件 / 版本目录 / 原子写的临时文件。
const IGNORE = new Set(['node_modules', '.git']);
const skip = (name) => name.startsWith('.') || name.endsWith('.ws2tmp') || IGNORE.has(name);

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

// 递归走盘 → { files:[{path,kind}], dirs:[rel] }，path/rel 均为工作区内 '/' 分隔相对路径。
async function walk(root) {
  const filesOut = [];
  const dirsOut = [];
  async function rec(absDir, rel) {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        dirsOut.push(childRel);
        await rec(path.join(absDir, e.name), childRel);
      } else if (e.isFile()) {
        filesOut.push({ path: childRel, kind: kindOf(e.name) });
      }
    }
  }
  await rec(root, '');
  return { files: filesOut, dirs: dirsOut };
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
  const { files: fl, dirs } = await walk(r);
  await Promise.all(
    fl.map(async (f) => {
      try {
        const st = await fs.stat(path.join(r, f.path.split('/').join(path.sep)), { bigint: true });
        f.ino = String(st.ino);
      } catch {
        f.ino = undefined;
      }
    }),
  );
  return { root: r, name: path.basename(r), tree: addAbs(buildFileTree(fl, dirs), r) };
}

// 在 dirRel 目录里新建一个 .html（内容由调用方给——模板 HTML）。dirRel '' = 工作区根。
async function newDoc(root, dirRel, baseName, html) {
  const r = path.resolve(root);
  const destDir = assertInsideWorkspace(r, dirRel || '.');
  const base = cleanLeafName(baseName) || '未命名';
  await fs.mkdir(destDir, { recursive: true });
  const leaf = uniqueLeaf(new Set(await listNames(destDir)), base, '.html');
  const abs = assertInsideWorkspace(r, path.join(destDir, leaf));
  await files.writeDocSafe(abs, html); // 原子写、拒空——字节层落盘,不过编辑器序列化器
  return { rel: toRel(r, abs), abs };
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

// 改名：保留扩展名(文件)，同目录去重，剥非法字符。
async function renamePath(root, relPath, newLeaf) {
  const r = path.resolve(root);
  const abs = assertInsideWorkspace(r, relPath);
  const base = cleanLeafName(newLeaf);
  if (!base) throw new Error('empty name');
  const isDir = (await fs.stat(abs)).isDirectory();
  const ext = isDir ? '' : path.extname(abs);
  const dir = path.dirname(abs);
  const taken = new Set((await listNames(dir)).filter((n) => n !== path.basename(abs)));
  const dest = assertInsideWorkspace(r, path.join(dir, uniqueLeaf(taken, base, ext)));
  if (dest === abs) return { rel: relPath, abs };
  await fs.rename(abs, dest);
  return { rel: toRel(r, dest), abs: dest };
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
  newDoc,
  makeDir,
  renamePath,
  movePath,
  deletePath,
  undoDelete,
  sweepBackups,
};
