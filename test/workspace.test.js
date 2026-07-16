const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ws = require('../src/main/workspace.js');
// workspace 的默认名/错误消息走 i18n t()；测试环境配置字典到 zh(真 app 无 locale 默认 zh)断言中文。
const _i18n = require('../src/lib/i18n');
_i18n.configureI18n(require('../src/i18n').ZH, require('../src/i18n').EN);
_i18n.setActiveLang('zh');

const HTML = '<!doctype html><html><body><h1>x</h1></body></html>';

async function seed() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-wsroot-'));
  const backup = await fs.mkdtemp(path.join(os.tmpdir(), 'ws2-trash-'));
  await fs.writeFile(path.join(root, 'a.html'), HTML, 'utf8');
  await fs.mkdir(path.join(root, '数据'), { recursive: true });
  await fs.writeFile(path.join(root, '数据', 'b.html'), HTML, 'utf8');
  await fs.writeFile(path.join(root, '数据', 'c.png'), 'png', 'utf8');
  return { root, backup };
}
const isFile = async (p) => {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
};
const isDir = async (p) => {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
};

test('readTree returns sorted nested tree of the workspace', async () => {
  const { root } = await seed();
  const { tree, name } = await ws.readTree(root);
  assert.equal(name, path.basename(root));
  // 数据(folder) before a.html(file)
  assert.deepEqual(tree.map((n) => [n.name, n.isDir]), [['数据', true], ['a.html', false]]);
  const d = tree.find((n) => n.name === '数据');
  assert.deepEqual(d.children.map((n) => n.name), ['b.html', 'c.png']);
  assert.equal(d.children.find((n) => n.name === 'c.png').kind, 'image');
});

test('readTree：根「可 stat 不可 readdir」（EACCES 半失联）返回 null，不当空树（防标签被 reconcile 清光）', async (t) => {
  if (process.getuid && process.getuid() === 0) return t.skip('root 用户无视 mode，测不出'); // CI 容器兜底
  const { root } = await seed();
  await fs.chmod(root, 0o000);
  try {
    assert.equal(await ws.readTree(root), null); // 修 MR-ADV-3 前这里返回空树 {tree:[]}
  } finally {
    await fs.chmod(root, 0o755); // 恢复，别让 tmp 清理失败
  }
  assert.ok((await ws.readTree(root)).tree.length > 0); // 权限恢复后树回来（对照：确实是权限导致的 null）
});

test('newDoc creates a real .html on disk, uniquifies on collision', async () => {
  const { root } = await seed();
  const a = await ws.newDoc(root, '', '无标题文档', HTML);
  assert.ok(await isFile(path.join(root, '无标题文档.html')));
  assert.equal(a.rel, '无标题文档.html');
  const b = await ws.newDoc(root, '', '无标题文档', HTML);
  assert.equal(b.rel, '无标题文档 2.html');
  assert.ok(await isFile(path.join(root, '无标题文档 2.html')));
});

test('newDoc into a subfolder lands there', async () => {
  const { root } = await seed();
  const r = await ws.newDoc(root, '数据', 'x', HTML);
  assert.equal(r.rel, '数据/x.html');
  assert.ok(await isFile(path.join(root, '数据', 'x.html')));
});

test('makeDir creates a directory, uniquifies', async () => {
  const { root } = await seed();
  const a = await ws.makeDir(root, '', '素材');
  assert.ok(await isDir(path.join(root, '素材')));
  const b = await ws.makeDir(root, '', '素材');
  assert.equal(b.rel, '素材 2');
});

test('renamePath keeps extension, dedupes, strips illegal chars', async () => {
  const { root } = await seed();
  // a.html -> b : keeps .html
  const r = await ws.renamePath(root, 'a.html', 'b');
  assert.equal(r.rel, 'b.html');
  assert.ok(await isFile(path.join(root, 'b.html')));
  assert.ok(!(await isFile(path.join(root, 'a.html'))));
  // illegal char stripped (no dir escape): "x/y" -> "xy.html"
  const r2 = await ws.renamePath(root, 'b.html', 'x/y');
  assert.equal(r2.rel, 'xy.html');
  // rename a dir keeps no ext
  const rd = await ws.renamePath(root, '数据', '资料');
  assert.equal(rd.rel, '资料');
  assert.ok(await isDir(path.join(root, '资料')));
});

test('movePath moves a file into another folder via fs.rename', async () => {
  const { root } = await seed();
  const r = await ws.movePath(root, 'a.html', '数据');
  assert.equal(r.rel, '数据/a.html');
  assert.ok(await isFile(path.join(root, '数据', 'a.html')));
  assert.ok(!(await isFile(path.join(root, 'a.html'))));
});

test('movePath rejects moving a folder into its own subtree', async () => {
  const { root } = await seed();
  await fs.mkdir(path.join(root, '数据', 'sub'), { recursive: true });
  await assert.rejects(() => ws.movePath(root, '数据', '数据/sub'));
});

// ===== movePathAcross（跨根移动，v1 便宜档）=====
test('movePathAcross 真移动文件到另一个根（fs.rename）', async () => {
  const { root: src } = await seed();
  const { root: dst } = await seed();
  const r = await ws.movePathAcross(src, 'a.html', dst, '数据');
  assert.equal(r.rel, '数据/a.html');
  assert.ok(await isFile(path.join(dst, '数据', 'a.html'))); // 目标有了
  assert.ok(!(await isFile(path.join(src, 'a.html')))); // 源没了
});

test('movePathAcross 移动整个目录到另一个根', async () => {
  const { root: src } = await seed();
  const { root: dst } = await seed();
  const r = await ws.movePathAcross(src, '数据', dst, '');
  assert.equal(r.rel, '数据 2'); // dst 已有 数据/ → 去重
  assert.ok(await isFile(path.join(dst, '数据 2', 'b.html'))); // 子文件跟着搬
  assert.ok(!(await isDir(path.join(src, '数据')))); // 源目录没了
});

test('movePathAcross 目标撞名去重，绝不覆盖占位', async () => {
  const { root: src } = await seed();
  const { root: dst } = await seed(); // dst 根目录已有 a.html
  const r = await ws.movePathAcross(src, 'a.html', dst, '');
  assert.equal(r.rel, 'a 2.html');
  assert.ok(await isFile(path.join(dst, 'a 2.html')));
  assert.equal(await fs.readFile(path.join(dst, 'a.html'), 'utf8'), HTML); // 原占位内容不变
});

test('movePathAcross 注入 EXDEV → 原样抛，源文件纹丝不动', async () => {
  const { root: src } = await seed();
  const { root: dst } = await seed(); // dst 的 数据/ 里没有 a.html（seed 只放 b.html/c.png）→ 目标无冲突
  const exdev = () => { const e = new Error('cross-device link not permitted'); e.code = 'EXDEV'; throw e; };
  await assert.rejects(() => ws.movePathAcross(src, 'a.html', dst, '数据', { renameFn: exdev }), /EXDEV|cross-device/);
  assert.ok(await isFile(path.join(src, 'a.html'))); // 源还在
  assert.ok(!(await isFile(path.join(dst, '数据', 'a.html')))); // 目标没被创建（rename 抛了，没落地）
});

test('movePathAcross 双侧 assertInsideWorkspace：越界 relPath 被拒', async () => {
  const { root: src } = await seed();
  const { root: dst } = await seed();
  await assert.rejects(() => ws.movePathAcross(src, '../逃逸.html', dst, ''));
  await assert.rejects(() => ws.movePathAcross(src, 'a.html', dst, '../外面'));
});

test('deletePath + undoDelete round-trips a file', async () => {
  const { root, backup } = await seed();
  const { token } = await ws.deletePath(root, 'a.html', backup);
  assert.ok(!(await isFile(path.join(root, 'a.html'))));
  const r = await ws.undoDelete(root, token, backup);
  assert.equal(r.rel, 'a.html');
  assert.equal(await fs.readFile(path.join(root, 'a.html'), 'utf8'), HTML);
});

test('deletePath + undoDelete round-trips a whole folder', async () => {
  const { root, backup } = await seed();
  const { token } = await ws.deletePath(root, '数据', backup);
  assert.ok(!(await isDir(path.join(root, '数据'))));
  await ws.undoDelete(root, token, backup);
  assert.ok(await isDir(path.join(root, '数据')));
  assert.ok(await isFile(path.join(root, '数据', 'b.html')));
});

test('deletePath optionally hands to OS trash via injected trashItem', async () => {
  const { root, backup } = await seed();
  let trashed = null;
  await ws.deletePath(root, 'a.html', backup, { trashItem: (p) => (trashed = p) });
  assert.equal(trashed, path.join(root, 'a.html'));
});

// ---- 去重而非覆盖：数据安全契约（这些分支之前没被测到 → 假覆盖感） ----

test('renamePath onto an existing name dedupes, never overwrites the occupant', async () => {
  const { root } = await seed();
  await fs.writeFile(path.join(root, 'b.html'), '<html>OCCUPANT</html>', 'utf8');
  const r = await ws.renamePath(root, 'a.html', 'b'); // 撞 b.html
  assert.equal(r.rel, 'b 2.html');
  assert.ok(await isFile(path.join(root, 'b 2.html')));
  assert.equal(await fs.readFile(path.join(root, 'b.html'), 'utf8'), '<html>OCCUPANT</html>'); // 原 b.html 没被盖
});

test('P3-03 renamePath 改名不改格式：输入自带文档后缀不叠出双后缀', async () => {
  const { root } = await seed();
  // ① 同后缀重复：a.html 输 b.html → b.html（不是 b.html.html），无格式提示
  const r1 = await ws.renamePath(root, 'a.html', 'b.html');
  assert.equal(r1.rel, 'b.html');
  assert.ok(await isFile(path.join(root, 'b.html')));
  assert.ok(!(await isFile(path.join(root, 'b.html.html'))));
  assert.ok(!r1.formatKept);
  // ② 异文档后缀：b.html 输 火箭.md → 火箭.html（保原格式），formatKept=true 供上层 toast
  const r2 = await ws.renamePath(root, 'b.html', '火箭.md');
  assert.equal(r2.rel, '火箭.html');
  assert.ok(await isFile(path.join(root, '火箭.html')));
  assert.ok(!(await isFile(path.join(root, '火箭.md'))));
  assert.equal(r2.formatKept, true);
  // ③ 非文档后缀：火箭.html 输 notes.txt → notes.txt.html（.txt 当 base 一部分，维持现状）
  const r3 = await ws.renamePath(root, '火箭.html', 'notes.txt');
  assert.equal(r3.rel, 'notes.txt.html');
  assert.ok(!r3.formatKept);
  // ④ 无后缀：notes.txt.html 输 报告 → 报告.html
  const r4 = await ws.renamePath(root, 'notes.txt.html', '报告');
  assert.equal(r4.rel, '报告.html');
  assert.ok(!r4.formatKept);
});

test('P3-03 目录名带点不被当后缀剥（只对文档文件生效）', async () => {
  const { root } = await seed();
  const rd = await ws.renamePath(root, '数据', '资料.md'); // 目录 ext='' → 不进剥后缀分支
  assert.equal(rd.rel, '资料.md');
  assert.ok(await isDir(path.join(root, '资料.md')));
});

test('movePath into a dir holding a same-name file dedupes, never overwrites', async () => {
  const { root } = await seed();
  await fs.writeFile(path.join(root, '数据', 'a.html'), '<html>OCCUPANT</html>', 'utf8');
  const r = await ws.movePath(root, 'a.html', '数据'); // 数据/ 已有 a.html
  assert.equal(r.rel, '数据/a 2.html');
  assert.ok(await isFile(path.join(root, '数据', 'a 2.html')));
  assert.equal(await fs.readFile(path.join(root, '数据', 'a.html'), 'utf8'), '<html>OCCUPANT</html>'); // 目标没被盖
});

test('undoDelete restores to a deduped name when the original slot is reoccupied', async () => {
  const { root, backup } = await seed();
  const { token } = await ws.deletePath(root, 'a.html', backup);
  await fs.writeFile(path.join(root, 'a.html'), '<html>NEW</html>', 'utf8'); // 原位被新文件占了
  const r = await ws.undoDelete(root, token, backup);
  assert.equal(r.rel, 'a 2.html');
  assert.equal(await fs.readFile(path.join(root, 'a 2.html'), 'utf8'), HTML); // 还原的旧内容落到 a 2.html
  assert.equal(await fs.readFile(path.join(root, 'a.html'), 'utf8'), '<html>NEW</html>'); // 占位的新文件没被盖
});

test('renamePath to blank / separators-only rejects and leaves the file untouched', async () => {
  const { root } = await seed();
  await assert.rejects(() => ws.renamePath(root, 'a.html', '   '));
  await assert.rejects(() => ws.renamePath(root, 'a.html', '/'));
  assert.ok(await isFile(path.join(root, 'a.html')));
});

test('all ops reject path traversal outside the workspace root', async () => {
  const { root } = await seed();
  await assert.rejects(() => ws.newDoc(root, '../evil', 'x', HTML));
  await assert.rejects(() => ws.renamePath(root, '../../etc/passwd', 'pwned'));
  await assert.rejects(() => ws.movePath(root, 'a.html', '../..'));
});

test('MP-16 undoDelete：畸形 token（含 ../）被拒，不越出 backupRoot', async () => {
  const { root, backup } = await seed();
  await assert.rejects(() => ws.undoDelete(root, '../../etc/x', backup), /非法的撤销令牌/);
  await assert.rejects(() => ws.undoDelete(root, 'del-x/../../y', backup), /非法的撤销令牌/);
  await assert.rejects(() => ws.undoDelete(root, '', backup), /非法的撤销令牌/);
});

test('隐藏/临时文件不进树：dotfile + .ws2tmp（新旧命名）都被过滤', async () => {
  const { root } = await seed();
  await fs.writeFile(path.join(root, '.DS_Store'), 'x');           // dotfile
  await fs.writeFile(path.join(root, '.hidden.md'), 'x');           // 点开头的隐藏 md
  await fs.mkdir(path.join(root, '.obsidian'), { recursive: true }); // 隐藏目录
  await fs.writeFile(path.join(root, 'a.html.ws2tmp-999-0'), 'x');  // 新命名原子写 tmp（MP-2 后）
  await fs.writeFile(path.join(root, 'old.html.ws2tmp'), 'x');      // 旧命名
  const names = [];
  (function w(nodes) { for (const n of nodes) { names.push(n.name); if (n.children) w(n.children); } })((await ws.readTree(root)).tree);
  assert.ok(!names.some((n) => n.startsWith('.')), '不该出现 dotfile：' + names.join(','));
  assert.ok(!names.some((n) => n.includes('.ws2tmp')), '不该出现原子写临时文件：' + names.join(','));
  assert.deepEqual(names.sort(), ['a.html', 'b.html', 'c.png', '数据'].sort()); // 只剩正常文件
});

test('隐藏文件不进树：Windows/云盘垃圾（非点号，大小写不敏感）都被过滤', async () => {
  const { root } = await seed();
  await fs.writeFile(path.join(root, 'desktop.ini'), 'x');          // Windows
  await fs.writeFile(path.join(root, 'Desktop.INI'), 'x');          // 大小写变体
  await fs.writeFile(path.join(root, 'Thumbs.db'), 'x');            // Windows 缩略图
  await fs.writeFile(path.join(root, 'ehthumbs.db'), 'x');
  await fs.writeFile(path.join(root, '~$报告.docx'), 'x');          // Office 锁文件（~$ 前缀）
  await fs.writeFile(path.join(root, 'Icon\r'), 'x');               // macOS 自定义图标（名带回车）
  await fs.mkdir(path.join(root, '$RECYCLE.BIN'), { recursive: true });
  await fs.mkdir(path.join(root, 'System Volume Information'), { recursive: true });
  // 反误伤：形似但合法的用户文件名必须保留（防过滤过宽——S4「弱门」教训）。
  await fs.writeFile(path.join(root, 'desktop.html'), 'x');         // 含 desktop 但不是 desktop.ini
  await fs.writeFile(path.join(root, '~波浪号.html'), 'x');         // 单 ~、不带 $
  await fs.writeFile(path.join(root, 'Iconography.html'), 'x');     // 以 Icon 开头但不是 "Icon\r"
  const names = [];
  (function w(nodes) { for (const n of nodes) { names.push(n.name); if (n.children) w(n.children); } })((await ws.readTree(root)).tree);
  const junk = ['desktop.ini', 'Desktop.INI', 'Thumbs.db', 'ehthumbs.db', '~$报告.docx', 'Icon\r', '$RECYCLE.BIN', 'System Volume Information'];
  for (const j of junk) assert.ok(!names.includes(j), '不该出现云盘垃圾：' + j + ' | tree=' + names.join(','));
  for (const keep of ['desktop.html', '~波浪号.html', 'Iconography.html']) {
    assert.ok(names.includes(keep), '误伤了合法文件：' + keep + ' | tree=' + names.join(','));
  }
});
