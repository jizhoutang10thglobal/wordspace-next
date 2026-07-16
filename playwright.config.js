// i18n:默认锁定 e2e 语言为中文——现有 spec 全程按中文文案断言,CI runner 是英文环境,
// 不锁的话 app 会跟随系统跑成英文、中文断言全挂。各 spec 的 launch 都 `...process.env`,故在
// config 顶层设一次,所有 launch(含将来新增的 spec)自动继承,不用逐个补 WS2_LANG。
// 个别要测英文的用例(language.spec.js)在自己的 launch env 里显式覆盖 WS2_LANG:'en'。
if (!process.env.WS2_LANG) process.env.WS2_LANG = 'zh';

module.exports = {
  testDir: './e2e',
  timeout: 30000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {}
};
