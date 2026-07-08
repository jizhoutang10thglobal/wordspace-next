---
type: feat
status: active
date: 2026-07-08
branch: feat/browser-tabs
origin: 生产就绪评估(2026-07-08,Colin 拍板先补 1+2)
---

# Plan:浏览器分支生产加固 —— ① 网页右键菜单 + ② 打包态冒烟验证

> **给执行模型的一句话**:这是 PR #132(`feat/browser-tabs`)合并前的两件硬门槛。本文档所有 file:line 锚点基于 commit `2495b93` 实测核对过,但**动手前先 Read 目标文件确认锚点没漂移**——别盲改。做完 Part A 才做 Part B(Part B 的手动检查项里要用到右键菜单)。

## 0. 执行环境与铁律(必读,违反任何一条 = 停下来问 Colin)

- **工作位置**:worktree `/Users/ctlandu/Documents/GitHub/wordspace-next-browser`,分支 `feat/browser-tabs`。开工前 `git status` 必须 clean 且 HEAD 在 `2495b93` 或其后;不 clean 说明有并行 session 在动,停下确认。
- **不合 main、不打 tag、不发版**。PR #132 是 draft,只 push 到它;merge/release 只能 Colin 亲口说。
- **push 账号**:`CTlandu` 对本仓 403。push 前 `gh auth switch --user jizhoutang10thglobal`,push 完 `gh auth switch --user CTlandu` 切回。git push 用 `git push origin feat/browser-tabs`。
- **每个 U 单元一个 commit**(并行 session 靠 git log 同步,别攒大提交)。
- **绝不碰生产 app**:本机装着 `/Applications/Wordspace Next.app`(Colin 日常在用)。不 pkill 任何名字含 "Wordspace Next" 的进程;打包冒烟只允许用 "Wordspace Smoke" 名字的产物(见 Part B 安全门)。
- **e2e 套件跑法**:`workers:1` 串行,全套约 3–8 分钟,红一条烧满 30s。全套只在收尾跑一次,用 `cd <worktree> && nohup npx playwright test > /tmp/e2e-hardening.log 2>&1 &` 然后轮询 log(直接跑会被工具 10 分钟超时杀掉;`| tail` 会吞输出)。开发中只跑单个 spec:`npx playwright test e2e/web-context-menu.spec.js`。
- **单测框架是 `node:test` 不是 vitest**(`npm test` = `node --test test/*.test.js`);CLAUDE.md 里的 vitest 教训是历史遗留,别照搬。
- 跑任何 electron e2e 前:`pkill -9 -f "node_modules/electron"`(清掉 dev 残留,不影响生产 app——生产 app 不在 node_modules 路径下)。

## 1. 背景(为什么是这两件)

生产就绪评估(2026-07-08)结论:功能/安全/测试门都过硬,但有两个合并前必须补的洞:

1. **网页右键菜单完全缺失**——`grep -rn "context-menu" src/` 零命中。用户在网页上右键什么都不出来;拷链接/拷图片/新标签打开是浏览器地板,用户几分钟内必撞。
2. **打包态零验证**——所有测试 seam 都 `!app.isPackaged` 门控(deliberate,见 `src/main/main.js:9-11` MP-8 注释),打包后的 app 一次没启动过。WebContentsView、vendored Readability、菜单加速器在 asar+签名后的行为是零证据。且打包版与生产 app 共享 userData/单实例锁/文件关联,必须用改名产物隔离验证。

## 2. 范围边界(不做)

- 不做 spellcheck 菜单项(Electron session spellchecker 集成,v2)。
- 不做「检查元素」devtools 入口(devtools 姿态未拍板)。
- 不做 Windows 真机验证(Colin 单独拍板 mac-only 首发 vs 等 Win pass)。
- 不动文档侧(iframe)的右键——文件树已有 DOM 版 `showContextMenu`(`src/renderer/sidebar.js:315`),文档编辑区右键维持现状。
- 不做 Peek / Split View(各自有 spec 待排期)。
- 不改任何安全边界:CSP 不动、web 内容零 IPC 暴露不动、`persist:webtabs` 配置不动。

---

# Part A:网页右键菜单(估 1 天)

## A.0 设计与架构决策(已定,照做)

**为什么必须是原生 Menu 而不是 DOM 菜单**:WebContentsView 是原生层,浮在 renderer DOM 之上——sidebar 那套 `div#sb-ctx` 画在网页视图**底下**,根本看不见。只能用 `Menu.buildFromTemplate(...).popup()`(本仓首个 popup 用例,`Menu` 目前只在 `src/main/main.js:1` import 过)。原生菜单也天然豁免「纸方墨圆」自绘样式要求。

**结构 = 纯逻辑 builder + main 薄适配器 + 单一动作收口**(吸取 applyTabs 绕过收口的教训):

```
wc.on('context-menu', (e, params))            [src/main/web-tabs.js wireViewEvents]
  → buildCtxTemplate(params, ctx)             [src/lib/web-context-menu.js 纯函数,node:test 全覆盖]
  → 每个菜单项 click ⇒ executeCtxAction(key, id, args)   [唯一动作出口,e2e 直接调它]
  → Menu.buildFromTemplate(...).popup({ window: getWin() })  [不传 x/y,默认弹在鼠标处,避免 view 偏移坐标数学]
```

**菜单内容(v1 冻结,分节按序;节内条目无对应上下文时整节不出现)**:

| 节 | 出现条件 | 条目(中文 label) | 动作 |
|---|---|---|---|
| 链接 | `params.linkURL` 过 http(s) 校验 | 在新标签页打开链接 / 在后台标签页打开链接 / 拷贝链接 | `web-open-request` 漏斗(fg/bg)/ `clipboard.writeText(cleanShareUrl(url))` |
| 图片 | `params.mediaType === 'image'` | 拷贝图片 / 拷贝图片地址* / 图片存到下载 | `wc.copyImageAt(params.x, params.y)` / writeText(srcURL) / `wc.downloadURL(srcURL)`(走现有 will-download 清洗) |
| 选中文字 | `params.selectionText` 非空 | 拷贝 / 用 Bing 搜索“…” | `wc.copy()` / `searchUrl(text)` 进 `web-open-request` |
| 编辑框 | `params.isEditable` | 剪切 / 拷贝 / 粘贴 / 全选 | `wc.cut()/copy()/paste()/selectAll()`(显式调 view 的 wc,别用 role——role 作用于聚焦 window,不可靠) |
| 导航 | 恒出现 | 返回(enabled=canGoBack)/ 前进(enabled=canGoForward)/ 重新加载 | 复用现有 `nav(key, action)`(定义在 `web-tabs.js:235`,`module.exports`(:340 起)已导出,单一收口) |
| 页面 | 恒出现(垫底) | 拷贝页面链接 / 存为文档 / 导出 PDF | writeText(cleanShareUrl(rec.url)) / `sendToRenderer('web-clip-request',{key})` / 复用 `printToPdf(key)` |

\* 拷贝图片地址、图片存到下载:仅当 `srcURL` 是 http(s) 时出现(data: URI 图片只留「拷贝图片」)。选中文字搜索的 label 里文字截断 20 字符加 …。

**安全不变式(执行时逐条自检)**:
- 链接节的 URL 过滤用 `policy.isAllowedNavUrl`(`src/lib/web-tabs-policy.js`,web-tabs.js 里已 require)——`javascript:`/`data:`/`file:`/`about:` 链接**整节不出现**。
- `executeCtxAction` 内部**再校验一遍** URL(defense in depth:不信 template 传回来的 args,open/download 前重跑 isAllowedNavUrl / http(s) 检查)。
- 「在新标签打开」绝不在 main 直接建 view——只走 `sendToRenderer('web-open-request', { url, background })`(KD-15 不变式,现有 `setWindowOpenHandler` 同款,见 `web-tabs.js:169-176`)。
- 不新增任何暴露给网页内容的 IPC(web view 仍然零 preload)。

**现成锚点(实测于 2495b93)**:
- 挂钩点:`wireViewEvents(key, view)` — `src/main/web-tabs.js:122-176`(在 `render-process-gone`/`setWindowOpenHandler` 附近加 `wc.on('context-menu', ...)`)。
- `sendToRenderer(channel, payload)` — `web-tabs.js:72-75`;`getWin()` — `web-tabs.js:19`(`init` 注入)。
- electron import 要加 `Menu, clipboard`(可能还有 `app`,U2 的 seam 门控要用):`web-tabs.js:10` 现在是 `{ WebContentsView, session, net, shell, dialog }`。
- canGoBack/canGoForward:registry rec 里现成有(`createView` 建的 rec,`syncNav` 维护)——popup 时同步读,零 renderer 往返。
- `cleanShareUrl` — `src/lib/url-input.js:94`;`searchUrl(q)`(默认 Bing 模板)— `url-input.js:25`。
- 剪藏(存为文档)现有触发链:`#web-clip-btn` handler — `src/renderer/browser-chrome.js:202-227` → `window.__sbClipToDoc`;main 侧 `extractReadable(key)` — `web-tabs.js:297-322`。
- toast:`window.__sbToast(msg)`(`sidebar.js:1031` 暴露)。

## A.1 U1:纯逻辑 builder 模块 + 单测

**Goal**:`buildCtxTemplate(params, ctx)` 纯函数,输入可序列化、输出可序列化,零 electron 依赖。

**Files**:
- 新建 `src/lib/web-context-menu.js`(双导出惯例:`module.exports` + `window.WS2CtxMenu`,抄 `src/lib/url-input.js:105-107` 的写法)
- 新建 `test/web-context-menu.test.js`(shape 抄 `test/web-history.test.js`:CJS require、扁平 `test('中文描述', ...)`、`assert.strictEqual`)

**Approach**:
- 输入:`params` 取 Electron context-menu params 的子集 `{ linkURL, srcURL, mediaType, selectionText, isEditable, x, y }`;`ctx = { canGoBack, canGoForward, pageUrl, isAllowedUrl }`。
- 输出:`[{ id, label, enabled?, args? } | { type: 'separator' }]`。`id` 是动作标识(如 `'open-link'`, `'open-link-bg'`, `'copy-link'`, `'copy-image'`, `'copy-image-url'`, `'save-image'`, `'copy-selection'`, `'search-selection'`, `'cut'`, `'copy'`, `'paste'`, `'select-all'`, `'nav-back'`, `'nav-forward'`, `'reload'`, `'copy-page-url'`, `'clip-page'`, `'export-pdf'`),`args` 带该动作要的数据(url/srcURL/text/x/y)。
- URL 过滤逻辑:builder 里不 require policy(保持纯、可单测),接受 `ctx.isAllowedUrl` 函数注入,main 适配器传 `policy.isAllowedNavUrl` 进来。单测就能注入假过滤器验证分节逻辑。
- 分隔符规则:节与节之间恰一条,无前导/尾随/连续分隔符(写成后处理函数,单测覆盖)。

**Test scenarios**(每条一个 test):
1. 空 params(网页空白处右键)→ 只有导航节 + 页面节,顺序正确。
2. http 链接 → 链接节三条在最前;`javascript:` / `file:` / `data:` linkURL → 链接节整节消失(用注入的过滤器)。
3. 图片(http srcURL)→ 三条全出;图片(data: srcURL)→ 只有「拷贝图片」。
4. 选中文字 → 拷贝 + 搜索,label 截断:21+ 字符的选中文字 label 尾部是 `…`,20 字符以内不截。
5. isEditable → 剪切/拷贝/粘贴/全选四条。
6. canGoBack=false → 返回 enabled=false;canGoForward 同理。
7. 组合场景(链接+选中同时存在)→ 两节都出、分隔符恰当、无连续分隔符。
8. 变异自检性质:两组不同 params 产出的 template 必不相等(防「恒返回同一菜单」的哑实现)。

**Verification**:`npm test` 全绿(现有 477 + 新增)。**commit**:`feat: 网页右键菜单纯逻辑 builder(U1)`。

## A.2 U2:main 适配器 + 动作收口 + 探针 seam

**Goal**:把 builder 接进 web-tabs.js,动作全部走 `executeCtxAction` 单一出口,并留 e2e 可测的探针 seam。

**Files**:`src/main/web-tabs.js`(主改)。

**Approach**:
- `wireViewEvents` 里加:
  ```js
  wc.on('context-menu', (_e, params) => { openCtxMenu(key, params); });
  ```
- `openCtxMenu(key, params)`:从 `registry.get(key)` 读 rec 拼 ctx(canGoBack/canGoForward/pageUrl=rec.url,`isAllowedUrl: policy.isAllowedNavUrl`)→ `buildCtxTemplate` → **探针分支**:`if (process.env.WS2_CTXMENU_PROBE && !app.isPackaged)`(照抄其他 seam 的门控写法)则不弹菜单,改为存 `global.__ws2LastCtxMenu = { key, params: <子集>, template }` 并 return;否则 map 成 Electron menu template(separator 直通;条目 `{ label, enabled, click: () => executeCtxAction(key, item.id, item.args) }`)→ `Menu.buildFromTemplate(t).popup({ window: getWin() })`(**不传 x/y**)。
- `executeCtxAction(key, id, args)`:switch 全部动作(见 A.0 表格「动作」列);内部对 open/download 类动作重校验 URL;未知 id 静默 no-op。探针 seam 开启时同时挂 `global.__ws2CtxAction = executeCtxAction`(e2e 直接调用,与菜单 click 同一路径——这就是收口)。
- `module.exports` 追加 `executeCtxAction`。
- 「存为文档」动作:`sendToRenderer('web-clip-request', { key })`(新 push channel,renderer 侧 U3 接)。
- 「导出 PDF」:直接调本模块 `printToPdf(key)`(已存在,`web-tabs.js:249-260`,产物落下载目录并有 toast 推送)。

**Test scenarios**(自动断言进 U3 的 e2e,本单元先保证):`npm test` 不回归;`npm start` 手动冒烟——真开一个网页,右键:空白处/链接/图片/选中文字/输入框五种上下文,菜单出现且条目正确,拷贝链接真进剪贴板。

**Verification**:手动五上下文全过 + `npm test` 绿。**commit**:`feat: 网页右键菜单 main 适配器 + executeCtxAction 收口(U2)`。

## A.3 U3:renderer 剪藏接线 + e2e 真门

**Goal**:右键「存为文档」打通;整条功能上 e2e 门(含变异自检)。

**Files**:
- `src/renderer/preload.js`:`window.ws2` 加 `onWebClipRequest(cb)`(listen `'web-clip-request'`,照抄 `onWebOpenRequest` 的写法,preload.js:65)。
- `src/renderer/browser-chrome.js`:把 `#web-clip-btn` handler(browser-chrome.js:202-227)的主体抽成 `function clipTab(key)`,按钮和 `onWebClipRequest` 都调它(按钮语义不变:剪当前激活 tab;push 请求带 key,校验 key === 当前激活 web key 才执行,不是则忽略——防非激活 view 的迟到请求剪错页)。
- 新建 `e2e/web-context-menu.spec.js`(harness 抄 `e2e/arc-polish.spec.js`:本地 http fixture、`WS2_USERDATA`/`WS2_FOLDER_IN`/`WS2_NO_CLOSE_DIALOG`,launch env 额外加 `WS2_CTXMENU_PROBE: '1'` 和 `WS2_DL_DIR`)。

**Approach(e2e 怎么测原生菜单)**:原生菜单 Playwright 驱动不了,所以门分两半:template 正确性靠探针 seam 断言,动作正确性靠直接调 `global.__ws2CtxAction`(与菜单 click 同路径)。

真实右键输入,**首选 CDP 路径**(对抗审查结论,确定性最好):WebContentsView 的页面会作为 Playwright page target 暴露——轮询 `electronApp.windows()`(或 context pages)找 URL 匹配 fixture 的那个 page,然后 `viewPage.click(selector, { button: 'right' })`。CDP 注入走 Blink 输入管线,**不依赖 OS 窗口焦点**,且照样触发 webContents 的 `context-menu` 事件;还能用 selector 定位、不用写死坐标。备选(若 view 拿不到 page target):`wc.sendInputEvent({ type: 'mouseDown', button: 'right', x, y, clickCount: 1 })` + 对应 mouseUp——**但必须先强制并断言窗口焦点**(`app.evaluate` 里 `win.show(); win.focus()` + 轮询 `win.isFocused()===true`,Electron 文档明说 sendInputEvent 要求窗口聚焦),断言包一层 `expect.poll` 并允许重击一次;wc 从 main 侧拿:`webContents.getAllWebContents()` 按 URL 找。

**Test scenarios**:
1. **真右键 → 探针捕获**:右击 fixture 链接坐标 → `expect.poll(app.evaluate(() => global.__ws2LastCtxMenu))` 的 template 含「在新标签页打开链接」且 args.url 正确。
2. **开新标签动作**:`global.__ws2CtxAction(key, 'open-link', { url })` → `.sb-tab-web` 数量 +1 且新 tab 激活;`open-link-bg` → +1 但激活不变。
3. **拷贝链接清洗**:对带 `?utm_source=x&id=42` 的链接执行 `copy-link` → `clipboard.readText()`(app.evaluate)=== 去 utm 保 id 的 URL。
4. **拷贝图片地址 + 图片存到下载**:执行后剪贴板是 srcURL;`save-image` 后轮询 `WS2_DL_DIR` 目录出现清洗过文件名的图片文件(复用现有 will-download 断言套路)。
5. **Bing 搜索选中文字**:执行 `search-selection` → 新 web tab 出现且其 url(app.evaluate 读 registry 或 tab title)含 `bing.com/search?q=`(不用等页面真加载成功,断 tab/记录即可,离线环境加载失败无妨)。
6. **安全探针**:右击 `javascript:alert(1)` 链接坐标 → 探针 template 里**没有**任何 `open-link`/`copy-link` 条目。
7. **存为文档**:执行 `clip-page` → 工作区目录出现新 .html 且内容含 fixture 正文标记(抄 browser-smoke.js:139-147 的断言)。
8. **变异自检**:空白处右键的 template ≠ 链接处右键的 template(菜单真的随上下文变化,防哑门);且断言 `global.__ws2LastCtxMenu` 在右键前为 undefined、右键后非空(捕获非恒真)。

**Verification**:`npx playwright test e2e/web-context-menu.spec.js` 全绿;`npm test` 绿。**commit**:`feat: 右键存为文档接线 + web-context-menu e2e 真门(U3)`。

---

# Part B:打包态冒烟验证(估 0.5–1 天)

## B.0 安全前提(为什么不能直接打包跑,一字一句读完)

实测事实(2495b93):
1. 本机装着生产 app `/Applications/Wordspace Next.app`,Colin 日常在用。macOS 关窗 ≠ 退出(hide 驻留,`main.js:64-68`)——**生产 app 可能没窗口但持着锁**。
2. 打包产物若同名:共享 `~/Library/Application Support/Wordspace Next`(userData)、单实例锁(第二实例把 argv 甩给正跑的实例后秒退,`main.js:269-277`)、.html/.md 文件关联。**同名打包跑冒烟 = 污染 Colin 的真实数据。**
3. 所有 `WS2_*` seam 在打包态全死(`!app.isPackaged` 门控,deliberate),**env 隔离不存在**。
4. **自动更新是活的**:打包态启动即 `checkForUpdates`(`main.js:210,283`),`update-available` 自动 `downloadUpdate()`(`main.js:181`),完了弹「重启安装」对话框——本 worktree 版本 0.4.5,GitHub releases 上有更新版,**同 publish 配置打包必中招**。
5. 本地 `electron-builder` 会自动发现 keychain 签名身份(配置里没关 auto-discovery)。

**解法 = 改名冒烟产物**:productName「Wordspace Smoke」→ userData/锁/LaunchServices 全部天然隔离;去掉 publish 配置 → 打包产物里没有 `app-update.yml` → 启动的 checkForUpdates 抛错被 `.catch(() => {})`(main.js:210)静默吞掉 → 更新风险消除;`identity: null` → 明确不签名(本地构建没 quarantine 属性,Gatekeeper 不拦);去掉 fileAssociations → 不污染 Colin 的「打开方式」菜单。**生产代码零改动**——冒烟测的就是同一份 src/** 在 asar 里的行为,只有品牌不同。

**硬性安全门(违反即 abort)**:
- 冒烟构建配置里 `productName` 必须是 `Wordspace Smoke` **且带 `extraMetadata.name/productName`**(见 B.1 踩坑框——没有 extraMetadata 运行时会落到生产 userData)。
- **启动前静态身份闸(最关键,别只靠运行时 A0 兜底)**:脚本 launch 前先读打包产物 asar 内 package.json,`productName||name` 必须精确等于 `Wordspace Smoke`,否则**拒绝启动**——因为若身份错,app 一启动就碰生产 userData,而它会撞锁秒退、A0 根本来不及跑。用 `require('@electron/asar').extractFile(asar,'package.json')` 静态读。
- 冒烟脚本运行时 A0:launch 后 `path.basename(app.getPath('userData'))` 必须精确等于 `Wordspace Smoke`——否则 **立即 close + 报错退出**。
- 全程不 pkill / 不 open / 不以任何方式触碰名字含 "Wordspace Next" 的进程或目录。
- 构建时带 `CSC_IDENTITY_AUTO_DISCOVERY=false`(双保险,防 keychain 弹窗)。若仍出现任何钥匙串/签名弹窗 → 停,报告。
- **本 Part 只能在宿主 macOS 跑**(要真 Electron 二进制 + 真显示器),容器里不要试。

## B.1 U4:冒烟构建配置

**Files**:
- 新建 `scripts/smoke.builder-config.json`:
  ```json
  {
    "appId": "com.tenthglobal.wordspace-next.smoke",
    "productName": "Wordspace Smoke",
    "afterPack": "scripts/smoke-afterpack.js",
    "directories": { "output": "release-smoke" },
    "files": ["src/**", "package.json"],
    "asar": true,
    "mac": {
      "target": [{ "target": "dir", "arch": ["arm64"] }],
      "icon": "build-resources/icon.png",
      "identity": null,
      "hardenedRuntime": false
    }
  }
  ```
  (显式 `asar: true` 是为了锁死「测的就是 asar 形态」——生产配置走 electron-builder 默认 true,别让默认值漂移把门测歪。无 publish、无 notarize、无 dmg、无 fileAssociations、无 win——都是故意的,见 B.0。)
- 新建 `scripts/smoke-afterpack.js`:electron-builder 的 afterPack 钩子,打包后把**产物 asar 内** package.json 的 `name`/`productName` 改成 `Wordspace Smoke`(`@electron/asar` 解包→改一行→重打包)。**这一步是 userData 隔离的关键,不能省。**

  > **⚠⚠ 实现踩坑(2026-07-08 实测,两个坑连环,原 plan 全漏了——差点碰生产数据)**:
  > **坑1:userData 撞生产。** `build.productName` 只设 Info.plist 的 CFBundleName,**不改运行时 `app.getName()`**——它读 asar 内 package.json 的 `productName`(缺则 `name`)。本仓 package.json `name="wordspace-next"` 且无顶层 `productName`,所以裸打包的 smoke app 运行时 userData 落到 `~/Library/Application Support/wordspace-next`,**正是生产版 Wordspace Next 用的目录**(lsof 实证:生产版 userData 就是小写 `wordspace-next`)→ 撞生产单实例锁、whenReady 前秒退(表现:exitCode 0 + 零输出 + Playwright socket hang up),且共用生产真实数据。
  > **坑2:extraMetadata 会毁源文件。** 第一反应是用 electron-builder 的 `extraMetadata:{name,productName}` 注进 asar package.json——**别用**:实测它把合并后的精简 package.json **写回了源 `package.json`**,删掉 build/scripts/devDependencies(`test/file-associations.test.js` 因此变红)。
  > **正解 = afterPack 钩子改产物 asar**(源文件零改动):`asar.extractAll → 改 package.json 的 name/productName → asar.createPackage` 回写同一路径。改 asar 安全(Electron dist 的 adhoc 签名 `Sealed Resources=none`,app.asar 不在封存范围,实测重打包后 app 照常启动)。实测修后运行时探针报 `userData=…/Wordspace Smoke`、拿到自己的 SingletonLock、稳定存活。
  > **取证结论**:所幸坑1 的撞锁反而挡住了 smoke 走到写真实数据这步,mtime 取证确认 Colin 的 workspace.json/recents/history 全未改(只有可再生的 GPUCache 被碰)。**这就是为什么 U5 脚本要加「启动前静态读 asar package.json 核身份、身份错拒启动」的前置闸——运行时 A0 来不及跑。**
- `.gitignore`:确认 `release/` 已忽略,追加 `release-smoke/`。

**Approach**:构建命令(宿主,worktree 根):
```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --config scripts/smoke.builder-config.json
```
产物:`release-smoke/mac-arm64/Wordspace Smoke.app`。构建后自检四条:
1. `ls "release-smoke/mac-arm64/Wordspace Smoke.app/Contents/Resources/app.asar"` 存在(asar 真开着);
2. `npx asar list "release-smoke/mac-arm64/Wordspace Smoke.app/Contents/Resources/app.asar" | grep vendor/readability.js` 命中(vendored 文件真进包了;在 worktree 根跑,本地 `node_modules/.bin/asar` 就是 `@electron/asar`,离线可用);
3. `codesign -dv "release-smoke/mac-arm64/Wordspace Smoke.app"` 必须显示 **`Signature=adhoc`**(linker-signed,继承自 Electron dist 二进制)——**注意验收标准的方向**:`identity: null` 让 electron-builder 完全跳过签名(它不会主动 ad-hoc 重签),能跑是因为 Electron 官方二进制本来就带 linker ad-hoc 签名且它不 seal 资源;arm64 内核要求可执行文件**至少有 ad-hoc 签名**,若 codesign 报「code object is not signed at all」= 这个 app 根本起不来,**算 FAIL 去排查**,不是「未签名也算过」。若显示 Developer ID = 吃到了本地身份,也算 FAIL(说明 auto-discovery 双保险都没拦住)。
4. `ls "release-smoke/mac-arm64/Wordspace Smoke.app/Contents/Resources/"` 里**没有** `app-update.yml`(它长在 asar 旁边、不在 asar 里,所以用 ls 不是 asar list;这是 A9 更新静默的地基)。

**两条不许动的护栏**(对抗审查结论):
- **target 永远保持 dir-only**。改成 zip/dmg 的瞬间,若 shell 里恰好有 `GH_TOKEN`/`GITHUB_TOKEN`,electron-builder 会自动造出指向生产仓的 publish 配置并写出 app-update.yml——dir-only 的 early-return 才是真护栏。
- **不要往冒烟配置里加 `electronFuses`**。Playwright 靠 nodeCliInspect fuse(默认开)attach 打包产物,关了它 U5 直接瘫。

**Verification**:四条自检过。**commit**:`chore: 打包冒烟构建配置(U4)`。

## B.2 U5:`scripts/packaged-smoke.js` 冒烟脚本

**Goal**:Playwright 驱动打包产物跑一遍核心闭环,PASS/FAIL 汇报,模式抄 `scripts/browser-smoke.js`(199 行,先读它)。

**Files**:新建 `scripts/packaged-smoke.js`。

**Approach**:
- launch 方式:`electron.launch({ executablePath: 'release-smoke/mac-arm64/Wordspace Smoke.app/Contents/MacOS/Wordspace Smoke' })`——**不传 args、不传 WS2_* env**(seam 全死,给了也没用,别给,免得误导后来人)。已知现象:Playwright 会自动往 argv 前面塞 `--inspect=0 --remote-debugging-port=0` 两个 flag(attach 用),正常,不影响 app 行为。
- **确定性输入靠预埋 userData**(seam 的替代):launch 前脚本直接写 `~/Library/Application Support/Wordspace Smoke/workspace.json`。格式已对着 `src/main/workspace-store.js` 核实过,**最小种子就够**:`{ "root": "<fixture 目录绝对路径>" }`——恢复链(`ws-get-root` → `workspaceStore.load`,workspace-store.js:63-66)只要求 `root` 是 string 且目录真实存在,全程无对话框;`recents.json` 不参与恢复,不用埋。要连标签一起预埋(可选,A8 也可以靠运行中开 tab 后重启来测):entries 要过 `validEntry`(workspace-store.js:45-50)——`open===true || pinned===true`,web 条目 `abs` 以 `web:` 开头且 `url` 为 string|null。
- ⚠ **没有「文件参数」退路**(对抗审查实锤):macOS 打包态不解析 argv 里的文件路径(main.js:286-289 只在非 darwin 平台扫 argv;macOS 靠 LaunchServices 的 `open-file` 事件,Playwright 直接 exec 二进制不会触发它;`WS2_OPEN_FILE` seam 打包态也是死的)——`args: ['<fixture>/a.html']` 会**静默无效**,别试。预埋 userData 是唯一确定性路径。
- 本地 http fixture server(抄 browser-smoke.js:22-27,含 Readability 可抽正文的文章页 + 一个 1400px 定宽页)。
- 收尾清理:close app → 删 `~/Library/Application Support/Wordspace Smoke` + fixture tmp;`release-smoke/` 留着(gitignore 了,方便手动复查),报告里注明路径。
- 截图存证到 `test-results/packaged-smoke/`(test-results 已 gitignore)。

**断言清单(顺序即依赖序)**:
- **A0 安全门**:userData 路径以 `Wordspace Smoke` 结尾,否则 abort(见 B.0)。
- A1 窗口出现、侧栏渲染出预埋工作区的文件树(证明:打包态 workspace 恢复链活着)。
- A2 点开 `a.html` → 编辑器渲染 h1(证明:文档管线 + schema 分流在 asar 下活着)。
- A3 编辑一处文字 → 等自动保存 → 读磁盘文件内容变了(证明:save IPC 链)。
- A4 omnibox 输 fixture URL → web tab 出现、真实页 title 到位、恰一个 view attach(抄 browser-smoke.js:82-96 的探针)。
- A5 剪藏:fixture 文章页上触发存为文档 → 工作区多一个 .html 且含正文+图(**这是 asar 最大风险点的直接证据**:`readabilitySrc()` 用 `fs.readFileSync(path.join(__dirname,'vendor','readability.js'))`,web-tabs.js:290-296,读的是 asar 内路径——失败时它静默降级成空串、剪藏变书签,所以必须断言「真抽出了正文」而不是「没报错」)。
- A6 宽页自适应:1400px 定宽页 → 该 view `getZoomFactor() < 1`(main 侧 `webContents.getAllWebContents()` 找 view)。
- A7 菜单通道:`webContents.send('menu', 'new-tab')`(抄 browser-smoke.js:69)→ 对应 UI 出现(证明打包态菜单→renderer 通道活着)。
- A8 重启持久化:close → **等第一个进程完全退出**(`await app.close()` 后轮询 `pgrep -f "Wordspace Smoke"` 为空;不等的话单实例锁会把第二次 launch 秒杀,main.js:269)→ 重新 launch → 文档 tab + web tab 都回来、激活正确(抄 browser-smoke.js:170-188)。
- A9 更新静默:整个过程无「发现新版本/重启安装」对话框弹出(现实断言方式:全程各步截图,收尾人工翻截图确认无更新弹窗;若弹了 = publish 剥离失败,FAIL 并停——排查 asar 里是否真没有 `app-update.yml`)。
- **变异自检**:`SMOKE_MUTATE=1` 分支故意断言一个不存在的元素在 A1 时刻可见 → 脚本必须红(门是活的);写法抄 browser-smoke.js 的 `ok()` 汇报器。

**软探针(不计 FAIL,只记 WARN)**:`SMOKE_NET=1` 时开 `https://www.bing.com`,15s 内 title 非空——真外网在打包态的一手证据,网络抖动不背锅。

**Verification**:`node scripts/packaged-smoke.js` 输出 `ALL PASS`。**commit**:`feat: 打包态冒烟脚本(U5)`。

## B.3 U6:跑门 + 存证 + 汇报

1. 宿主跑 `node scripts/browser-smoke.js`(dev 冒烟,确认基线还绿;顺便取 workspace.json 模板)。
2. U4 构建 + 三条自检。
3. `node scripts/packaged-smoke.js` → ALL PASS;`SMOKE_MUTATE=1` 跑一次确认翻红;`SMOKE_NET=1` 再跑一次记录 WARN/PASS。
4. **手动目验 5 分钟**(打包产物开着时):真右键——空白/链接/图片/选中/输入框五上下文菜单都对(Part A 在打包态的眼见为实);Dock/菜单栏名字显示 "Wordspace Smoke"(没冒充生产);Cmd+Q 真退出。
5. 全套回归:`npm test` + nohup 全套 e2e(见铁律)——全绿。
6. 清理(B.2 收尾项)+ commit 未提交的代码。
7. push(账号切换舞步)→ 给 PR #132 发一条 comment:冒烟结论表(A0–A9 + 变异自检 + 手动项 + 截图路径)+「右键菜单已补、打包态验证已补」;PR body 的验证清单也更新。
8. 最终向 Colin 汇报:两件事各自的证据 + 剩余已知边界(Windows 未验、devtools 姿态、长跑浸泡——评估里已列,不新增工作)。

---

## 3. 总验收(全部满足才算完)

- [ ] `npm test` 全绿(≥477 + 新增 web-context-menu 单测)
- [ ] 全套 e2e 全绿(218 + 新 spec;已知 flake:window-close 隐藏驻留 teardown 偶发超时,单跑绿即可豁免,其他红不豁免)
- [ ] `scripts/browser-smoke.js` ALL PASS
- [ ] `scripts/packaged-smoke.js` ALL PASS + 变异自检翻红过一次 + A0 安全门从未触发
- [ ] 手动五上下文右键目验过(dev + 打包各一遍)
- [ ] 生产 app(Wordspace Next)全程未被触碰:没杀过它的进程、没动过 `~/Library/Application Support/Wordspace Next`(收尾 `stat` 留证)
- [ ] 每 U 一 commit、已 push、PR #132 comment + body 已更新
- [ ] **没有 merge、没有 tag、没有发版**

## 4. 已拍板的决策(执行时别重新打开)

- 菜单条目集 v1 按 A.0 表格冻结;spellcheck/检查元素/Windows 均明确不做(§2)。
- 原生 Menu 而非 DOM 菜单(技术必然,A.0)。
- 冒烟走「Wordspace Smoke」改名产物 + 预埋 userData,**不给打包态开任何新 env seam**(保持 MP-8 的生产纯净性)。
- 「存为文档」进右键页面节(融合是本 feature 的差异化,入口多一个成本极低)。
- 唯一留给 Colin 的口头拍板:U6 手动目验那 5 分钟他要不要亲自看一眼(执行模型目验+截图也可)。

## 5. 执行 TODO(按序勾)

- [ ] T0 开工检查:worktree clean、HEAD ≥ 2495b93、读一遍 §0 铁律
- [ ] T1 U1:`src/lib/web-context-menu.js` + 单测 8 条 → `npm test` 绿 → commit
- [ ] T2 U2:web-tabs.js 适配器 + `executeCtxAction` + `WS2_CTXMENU_PROBE` seam → 手动五上下文冒烟 → commit
- [ ] T3 U3:preload/browser-chrome 剪藏接线 + `e2e/web-context-menu.spec.js` 8 场景 → 单 spec 绿 → commit
- [ ] T4 U4:smoke.builder-config.json + .gitignore → 构建 + 三自检 → commit
- [ ] T5 U5:packaged-smoke.js(A0–A9 + 变异 + SMOKE_NET)→ ALL PASS → commit
- [ ] T6 U6:全套回归(npm test + nohup e2e)→ 手动目验 → 清理 → push → PR #132 comment/body → 汇报 Colin
