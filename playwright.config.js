// i18n:默认锁定 e2e 语言为中文——现有 spec 全程按中文文案断言,CI runner 是英文环境,
// 不锁的话 app 会跟随系统跑成英文、中文断言全挂。各 spec 的 launch 都 `...process.env`,故在
// config 顶层设一次,所有 launch(含将来新增的 spec)自动继承,不用逐个补 WS2_LANG。
// 个别要测英文的用例(language.spec.js)在自己的 launch env 里显式覆盖 WS2_LANG:'en'。
if (!process.env.WS2_LANG) process.env.WS2_LANG = 'zh';

module.exports = {
  testDir: './e2e',
  // 取证探针（probe-*.spec.js）不进默认套：它们是对拍/截图用的**记录工具**，几乎不含断言
  // （跑了代码但不判定行为）。留在默认套里既拖 CI，又给出假覆盖信号——全绿里混着一批其实什么都没测的。
  // 要跑用 `WS2_PROBES=1 npx playwright test e2e/probe-xxx.spec.js`——
  // ⚠ testIgnore **连显式点名的路径一起挡**（实测：直接点名得 0 tests），所以必须留这个开关。
  // ⚠ 与 ci.yml 的「收集 spec 数 ≥ 地板 400」并存无碍：排除后仍有 670+。
  testIgnore: process.env.WS2_PROBES ? [] : /probe-.*\.spec\.js$/,
  timeout: 30000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // 无漏测第一道（e2e 策略 U2/KD6）：CI 上误提交的 test.only 会把全套收窄成一条却让门绿——直接报错拒收。
  // 本地不设（调试时 .only 方便），仅 CI 强制。配 e2e-all 的「收集 spec 数 ≥ 地板」共同挡漏测。
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {}
};
