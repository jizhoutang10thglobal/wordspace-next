// 多根功能宿主冒烟：真开 Electron，走「加根→再加根→嵌套检测→吸收→移除撤销→重启恢复」主链路。
// 用法：node scripts/multiroot-smoke.js（宿主跑，需真 electron 二进制）。
// 隔离：WS2_USERDATA 指到临时目录，不碰用户真数据、不撞正式版单实例锁。
const { _electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? ' — ' + extra : ''));
  if (!ok) process.exitCode = 1;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2-multiroot-'));
  const userData = path.join(tmp, 'userdata');
  const rootA = path.join(tmp, '甲方项目');
  const rootB = path.join(tmp, '资料库');
  const parentDir = path.join(tmp, '总目录');
  const rootC = path.join(parentDir, '子项目');
  for (const d of [userData, rootA, path.join(rootA, '素材'), rootB, parentDir, rootC]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(rootA, 'a.html'), '<!doctype html><html><body><p>A</p></body></html>');
  fs.writeFileSync(path.join(rootA, '素材', '同名.html'), '<!doctype html><html><body><p>A素材</p></body></html>');
  fs.writeFileSync(path.join(rootB, '同名.html'), '<!doctype html><html><body><p>B</p></body></html>');
  fs.writeFileSync(path.join(rootC, 'c.html'), '<!doctype html><html><body><p>C</p></body></html>');

  const launch = () => _electron.launch({
    args: ['--no-sandbox', path.join(__dirname, '..', 'src', 'main', 'main.js')],
    env: { ...process.env, WS2_USERDATA: userData, WS2_FOLDER_IN: rootA },
  });

  let app = await launch();
  let page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // 1) 加第一个根
  await page.click('#home-open-folder');
  await page.waitForSelector('.sb-root-head[data-root]', { timeout: 5000 });
  check('加根A：根标题行出现', await page.locator('.sb-root-head').count() === 1);
  check('加根A：树里有 a.html', await page.locator('.sb-file[data-rel="a.html"]').count() === 1);

  // 2) 加第二个根（换 seam 目标后走「添加文件夹…」行）
  await app.evaluate(({ }, dir) => { process.env.WS2_FOLDER_IN = dir; }, rootB);
  await page.click('#sb-add-root');
  await page.waitForFunction(() => document.querySelectorAll('.sb-root-head').length === 2, null, { timeout: 5000 });
  check('加根B：两节', true);

  // 3) 同 rel 不同根不串：展开两边、各开「同名.html」
  const rootIds = await page.$$eval('.sb-root-head', (els) => els.map((e) => e.dataset.root));
  await page.click('.sb-dir[data-rel="素材"][data-root="' + rootIds[0] + '"]');
  await page.click('.sb-file[data-rel="素材/同名.html"][data-root="' + rootIds[0] + '"]');
  await page.waitForSelector('#sb-tabs .sb-tab[data-rel="素材/同名.html"]', { timeout: 5000 });
  await page.click('.sb-file[data-rel="同名.html"][data-root="' + rootIds[1] + '"]');
  await page.waitForFunction(() => document.querySelectorAll('#sb-tabs .sb-tab').length === 2, null, { timeout: 5000 });
  check('同名文件两根各一个标签、不串键', true);

  // 4) 嵌套检测：再选 rootA（same）→ toast、不加节
  await app.evaluate(({ }, dir) => { process.env.WS2_FOLDER_IN = dir; }, rootA);
  await page.click('#sb-add-root');
  await page.waitForSelector('.sb-toast', { timeout: 5000 });
  check('same：toast 提示已打开', (await page.locator('.sb-toast').textContent()).includes('已经打开'));
  check('same：节数不变', await page.locator('.sb-root-head').count() === 2);

  // 5) child：选 rootA/素材 → 提示在里面、不加节
  await app.evaluate(({ }, dir) => { process.env.WS2_FOLDER_IN = dir; }, path.join(rootA, '素材'));
  await page.click('#sb-add-root');
  await page.waitForFunction(() => { const t = document.querySelector('.sb-toast'); return t && t.textContent.includes('里了'); }, null, { timeout: 5000 });
  check('child：toast 提示已在某根里', true);
  check('child：节数不变', await page.locator('.sb-root-head').count() === 2);

  // 6) parent 吸收：先加 rootC，再选 parentDir → 确认框 → 并入，rootC 的标签 rebase 不关
  await app.evaluate(({ }, dir) => { process.env.WS2_FOLDER_IN = dir; }, rootC);
  await page.click('#sb-add-root');
  await page.waitForFunction(() => document.querySelectorAll('.sb-root-head').length === 3, null, { timeout: 5000 });
  const cId = await page.$$eval('.sb-root-head', (els) => els[els.length - 1].dataset.root);
  await page.click('.sb-file[data-rel="c.html"][data-root="' + cId + '"]');
  await page.waitForSelector('#sb-tabs .sb-tab[data-rel="c.html"]', { timeout: 5000 });
  await app.evaluate(({ }, dir) => { process.env.WS2_FOLDER_IN = dir; }, parentDir);
  await page.click('#sb-add-root');
  await page.waitForSelector('.sb-modal-confirm', { timeout: 5000 });
  check('parent：出「并入并添加」确认框', (await page.locator('.sb-modal-confirm').textContent()).includes('并入'));
  await page.click('.sb-modal-confirm .sb-btn-primary');
  await page.waitForFunction(() => {
    const heads = [...document.querySelectorAll('.sb-root-head:not(.sb-root-missing)')];
    return heads.length === 3 && heads.some((h) => h.textContent.includes('总目录'));
  }, null, { timeout: 5000 });
  check('parent：子根并入成新节', true);
  const rebasedTab = page.locator('#sb-tabs .sb-tab[data-rel="子项目/c.html"]');
  check('吸收后标签 rebase（子项目/c.html）不关', await rebasedTab.count() === 1);

  // 7) 移除根B + 撤销
  const bId = rootIds[1];
  await page.click('.sb-root-head[data-root="' + bId + '"]', { button: 'right' });
  await page.click('#sb-ctx .sb-ctx-item.is-danger');
  await page.waitForFunction((id) => !document.querySelector('.sb-root-head[data-root="' + id + '"]'), bId, { timeout: 5000 });
  check('移除根B：节消失', true);
  check('移除根B：它的标签撤走', await page.locator('#sb-tabs .sb-tab[data-root="' + bId + '"]').count() === 0);
  await page.click('.sb-toast-action'); // 撤销
  await page.waitForSelector('.sb-root-head[data-root="' + bId + '"]', { timeout: 5000 });
  check('撤销：根B原位回来', true);
  await page.waitForSelector('#sb-tabs .sb-tab[data-root="' + bId + '"]', { timeout: 5000 });
  check('撤销：根B标签回来', true);

  // 8) 重启恢复：全部根 + 标签都在
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForFunction(() => document.querySelectorAll('.sb-root-head').length === 3, null, { timeout: 8000 });
  check('重启：3 节恢复', true);
  await page.waitForFunction(() => document.querySelectorAll('#sb-tabs .sb-tab').length >= 3, null, { timeout: 5000 });
  check('重启：标签恢复(≥3)', true);
  await app.close();

  const errReal = errors.filter((e) => !/DevTools|Autofill/.test(e));
  check('无 renderer 错误', errReal.length === 0, errReal.slice(0, 3).join(' | '));
  console.log('\n' + results.filter((r) => r.ok).length + '/' + results.length + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
