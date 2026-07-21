# 修复方案 001:内置浏览器访问网页总弹 CAPTCHA(UA 带 Electron 标识)

- 日期:2026-07-14 · 报告人:Wendi(v0.8.0,视频实录)· 根因调查:Claude(已闭合)
- 优先级:**P1**(浏览器搜索基本不可用——每次搜索都被 Google 拦)
- 状态:待实现。**本文档只是方案,修复由执行 AI 完成。**

## 公共约束(动手前必读)

- **从 origin/main 开新 worktree**:`git fetch origin main && git worktree add <目录> origin/main -b fix/browser-ua`。别在主仓文件夹直接干活(可能挂着过时分支、有并行 session)。本文所有 file:line 锚点均已在 origin/main(b19e382,v0.8.3)上核实。
- 一 bug 一 PR,base=main。**同一 PR 里更新 `docs/features/browser.md`**(仓库铁律:谁改真 app 行为,谁同 PR 更新 feature spec)。
- push/PR 用 `jizhoutang10thglobal` 账号(默认凭证 CTlandu 无写权限会 403)。做法参照 `.claude/skills/remember-global/SKILL.md`:`TOKEN=$(gh auth token --user jizhoutang10thglobal)`,git push 用 credential.helper 注入,`GH_TOKEN=$TOKEN gh pr create …`。
- CI required checks = `test` + `e2e`,按「合并后状态」判;PR BEHIND main 时先 `gh pr update-branch`。**不自合 PR**,留给 Colin。
- 单测 = `npm test`(node --test);e2e 开发迭代只跑受影响文件(`npx playwright test e2e/browser.spec.js`),全量 231 条交给 CI。
- 变异自检铁律:①先 commit 再变异(还原时才不会冲掉修复)②变异翻红 + 还原翻绿,门才算有牙。
- 手测 Electron:`WS2_USERDATA=<session 专属目录> npm start`;清理只按 PID 树杀自己的实例,**禁止 `pkill electron` 一刀切**(会杀并行 session 的窗口)。

## 症状与证据

Wendi 用内置浏览器(浏览器标签)访问 Google 搜索时,反复进入 `https://www.google.com/sorry/…` 反滥用拦截页 + reCAPTCHA 图块验证(「请选择包含自行车的所有图块」)。视频:`~/Desktop/wendi bug.MOV` 0-8 秒。

## 根因链(已确认)

1. 浏览器网页由 `src/main/web-tabs.js` 的 `WebContentsView` 渲染,session 为 `persist:webtabs`(`web-tabs.js:22,34`)。session 配置齐全(权限默认拒/下载 cancel/cookie 持久化),**但从头到尾没有任何 `setUserAgent`**——全仓 `setUserAgent`/`userAgentFallback`/`onBeforeSendHeaders` 零命中。
2. 因此所有网页请求带 **Electron 默认 UA**,形如:
   `Mozilla/5.0 (Macintosh; …) AppleWebKit/537.36 (KHTML, like Gecko) wordspace-next/<ver> Chrome/<ver> Electron/<ver> Safari/537.36`
   其中 `wordspace-next/…` 和 `Electron/…` 两个 token 是标准 Chrome UA 里不存在的。
3. Google 反滥用系统把非标准 UA 视为自动化/bot 信号 → 返回 `/sorry` 拦截页。社区实证一致(r/electronjs「Google blocking log in from Electron apps」:*"I removed Electron from the userAgent and it completely solved the problem"*)。
4. 次要因素(**app 控制不了**,做预期管理):IP 信誉(公司网络/VPN 出口被 Google 标记)、全新 cookie jar 冷启动(persist:webtabs 已持久化,用几次会好转)。所以验收标准是「不再必现」,不是「永不出现」。

## 实现单元

### U1 · 纯函数 `browserUA()`(可单测)

放 `src/lib/web-tabs-policy.js`(它就是 web-tabs 的纯决策逻辑之家,现有 `permissionAllowed`/`isAllowedNavUrl` 等同款模式):

```js
// 把 Electron 默认 UA 归一成标准 Chrome UA:剥 appName/<ver> 与 Electron/<ver> token。
// Google 反滥用把非标准 UA 当 bot 信号(→ /sorry + reCAPTCHA),剥掉即消除 app 侧头号触发因素。
function browserUA(defaultUA, appName) {
  if (typeof defaultUA !== 'string' || !defaultUA) return '';
  let ua = defaultUA.replace(/\sElectron\/\S+/i, '');
  if (appName) ua = ua.replace(new RegExp('\\s' + escapeRegExp(appName) + '/\\S+', 'i'), '');
  return ua.replace(/\s{2,}/g, ' ').trim();
}
```

(`escapeRegExp` 若 lib 里没有就地写一个;appName 由调用方传 `app.getName()`,不要在纯函数里 require electron——本仓惯例:`src/lib/` 不 import electron,vitest/node --test 直接可测。)

### U2 · `ensureSession()` 接线

`src/main/web-tabs.js` 的 `ensureSession()`(`:33-52`),在 `session.fromPartition` 之后加:

```js
sess.setUserAgent(policy.browserUA(sess.getUserAgent(), app.getName()));
```

- **只动 `persist:webtabs` session**,不碰主窗口/默认 session(编辑器、更新器与浏览无关,别扩大爆炸半径;也不要用全局 `app.userAgentFallback`)。
- session 级设置自动覆盖该 session 的所有 view(含 window.open 弹出的新标签),无需逐 webContents 设。
- `setUserAgent` 的第二参数 acceptLanguages 不传(Chromium 按系统 locale 自动生成 Accept-Language,现状正确)。

### U3 · 核查项(实现时验证,结果写进 PR)

- 实测 **Sec-CH-UA client hints** 是否也暴露 Electron 品牌:e2e 里用本地 http server 回显请求头(见下),看 `sec-ch-ua`。Electron 无干净 API 改 UA-CH;若确实带 Electron 品牌,不硬修,在 `docs/features/browser.md` 的「欠账」记一条已知限制即可(UA 字符串是 Google 的主要判定面,UA-CH 是弱信号)。

## 测试要求

1. **单测**(`test/web-tabs-policy.test.js`,并入现有文件):
   - 真实形状的 Electron 默认 UA 输入 → 输出不含 `Electron/`、不含 `wordspace-next/`,仍含 `Chrome/`、`Safari/`、`AppleWebKit/`;
   - 无多余双空格;appName 含正则特殊字符不崩;空/非字符串输入不抛;
   - 幂等:`browserUA(browserUA(x)) === browserUA(x)`。
2. **e2e**(并入 `e2e/browser.spec.js`,参照现有用例的本地起服模式):
   - 主进程断言:`electronApp.evaluate(({ session }) => session.fromPartition('persist:webtabs').getUserAgent())` → 不匹配 `/Electron\//`,不匹配 app 名,匹配 `/Chrome\//`;
   - 请求头断言(强门,S4 口径——别只查 API 返回值):本地 http server 回显 `user-agent` 头,开一个网页标签访问它,断言真实发出的请求头同样干净;顺带把 `sec-ch-ua` 打进测试输出供 U3 记录。
3. **变异自检**:先 commit;注释掉 U2 那行 `setUserAgent` → 上述 e2e 必须翻红;还原 → 翻绿。
4. **Wendi 复测点**(写进 PR 描述):同一网络下用内置浏览器 Google 搜索 3-5 次,预期不再必现 /sorry;若仍偶发,属 IP 信誉因素(换网络对照可证)。

## 验收标准

- [ ] 单测 + e2e 绿,变异自检红/绿闭环。
- [ ] `docs/features/browser.md` 行为契约新增一条:webtabs session 的 UA 归一为标准 Chrome UA(不带 Electron/app 标识,反 CAPTCHA);U3 结果记入(必要时加「欠账」)。
- [ ] PR 描述含:根因一句话、社区实证链接、预期管理说明(IP 因素不可控)、Wendi 复测步骤。

## 明确不做(本 PR 范围外)

- 不伪装 navigator 属性、不引入任何反检测/指纹伪装库(只是把 UA 归一成真实内核对应的 Chrome UA,不是规避检测)。
- 不改默认搜索引擎、不动 cookie 策略(persist 已正确)。
