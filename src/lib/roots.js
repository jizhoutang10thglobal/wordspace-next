// 多根工作区的纯逻辑：加根前的嵌套关系判定 + 绝对路径归属哪个根。
// 语义移植自 ui-demo/src/lib/tree.ts 的 classifyRoot（调研裁决：禁止真嵌套 + 智能引导）——
// Wordspace 的文件身份模型（keyOf=rootId:rel、按根 watch）撑不住重叠根，所以嵌套在入口就拦。
// 只在主进程消费（renderer 永远不发根路径）；无 fs 依赖，路径先由调用方 resolve/realpath 好再进来。
const path = require('path');

// 大小写折叠只在默认大小写不敏感的文件系统上做（mac/win）；Linux 区分大小写，折叠反而误判。
// opts.fold 可显式注入，供测试跨平台确定性。
function defaultFold() {
  return process.platform === 'darwin' || process.platform === 'win32';
}

// 规范化用于比较：resolve + 去尾分隔符（根目录 '/' 保留）+ 按需折叠大小写。
function canonPath(p, opts) {
  let c = path.resolve(p).replace(/[\\/]+$/, '');
  if (!c) c = path.sep;
  const fold = opts && 'fold' in opts ? opts.fold : defaultFold();
  return fold ? c.toLowerCase() : c;
}

// 前缀判定必须带分隔符边界，否则 /foo/bar 会误判成 /foo/bar-baz 的父目录。
function isUnder(childCanon, parentCanon) {
  if (parentCanon === path.sep) return childCanon.length > 1 && childCanon.startsWith(path.sep);
  return childCanon.startsWith(parentCanon + path.sep);
}

// 加根前判定新路径与已有根的关系（roots = [{ id, path }]）：
//   { rel: 'same', rootId }            完全相同 → 不重复加
//   { rel: 'child', parentId }         新根在某已有根里 → 别单独开，去那个根里展开
//   { rel: 'parent', childIds: [...] } 新根包住了一个或多个已有根 → 确认后吸收（子根标签 rebase 进新根）
//   { rel: 'independent' }             无重叠 → 正常加
function classifyRoot(newPath, roots, opts) {
  const a = canonPath(newPath, opts);
  for (const r of roots) {
    if (canonPath(r.path, opts) === a) return { rel: 'same', rootId: r.id };
  }
  for (const r of roots) {
    if (isUnder(a, canonPath(r.path, opts))) return { rel: 'child', parentId: r.id };
  }
  const childIds = roots.filter((r) => isUnder(canonPath(r.path, opts), a)).map((r) => r.id);
  if (childIds.length) return { rel: 'parent', childIds };
  return { rel: 'independent' };
}

// 绝对路径归属哪个根（等于根本身 → rel=''）。嵌套已被入口拦死，最多命中一个根。
// rel 用原始（resolve 后）字符串切片取，保住磁盘上的真实大小写。
function ownerOf(abs, roots, opts) {
  const a = canonPath(abs, opts);
  const absResolved = path.resolve(abs).replace(/[\\/]+$/, '') || path.sep;
  for (const r of roots) {
    const c = canonPath(r.path, opts);
    if (a === c) return { rootId: r.id, rel: '' };
    if (isUnder(a, c)) {
      const base = c === path.sep ? 1 : c.length + 1;
      return { rootId: r.id, rel: absResolved.slice(base).split(path.sep).join('/') };
    }
  }
  return null;
}

// 父根吸收子根时的 rel 前缀：子根相对父根的路径（'子/孙'；同目录不可能——same 已被单独分类）。
function prefixUnder(parentPath, childPath) {
  const p = path.resolve(parentPath);
  const c = path.resolve(childPath);
  return c.slice(p.length + 1).split(path.sep).join('/');
}

module.exports = { canonPath, classifyRoot, ownerOf, prefixUnder };
