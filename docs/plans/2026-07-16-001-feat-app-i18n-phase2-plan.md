# i18n Phase 2:真 app 移植(中英切换进 `src/`)

> status: active · origin: `docs/features/i18n.md`(Phase 1 已合 #223)+ plan #214 · 日期 2026-07-16
>
> Phase 1(ui-demo)已上 main:纯 core + 9 命名空间字典 + 三态偏好 + 三道防漂移门。本 plan 把同套架构搬进真 app(Electron 主进程 + vanilla renderer)。**执行前先读 `ui-demo/src/i18n/core.ts` 和 `docs/features/i18n.md`——四项拍板与架构主张全部继承,不再重新讨论。**

## 公共约束(执行者必读)

- 从 **origin/main** 开新 worktree(分支 `feat/app-i18n`),别在共享目录干活。push/PR 用 `jizhoutang10thglobal` token(CTlandu 403)。单 PR 交付(先例:browser-port)。
- CI required = test+e2e;PR BEHIND 先 `gh pr update-branch`。开发迭代只跑受影响 spec + dot reporter;**本 feature 动 sidebar.js/shell.js/ipc.js 等共享核心,推 PR 前本地 `npm run test:e2e:dot` 全量兜底**(CLAUDE.md 纪律的例外条款命中)。
- 手测 Electron:唯一 `WS2_USERDATA`、按 PID 树杀,严禁 `pkill electron`。
- 变异自检:先 commit 再变异。
- 真 app 单测用 **node:test**(不是 vitest——doc-images 先例);lib 模块是 CJS。

## 范围(继承拍板④:只翻 UI chrome)

**翻**:菜单栏、原生对话框(title/button/filter name)、主进程 toast、renderer 全部界面文案(侧栏/标签/文件树/toast/弹窗/右键菜单/查找/@提及/工具条/块菜单/浏览器子页面/更新 UI)、`index.html` 静态外壳、磁盘默认名(按创建时语言,拍板③)、schema 校验 violation 消息(用户在降级条/详情里看得到)。

**不翻**(记欠账,不做):`doc-templates.js` 的**模板正文 HTML**(会议纪要/项目方案整段内容——落盘进用户文档,产品决策 + Wendi 参与,同 Phase 1 拍板④;模板的 `name`/`desc` 是 chrome,翻)。用户文档内容、日志(实测 console 全英文,零工作量)。

**规模摸底**(两路侦察实测,origin/main@e8703f9):JS 可见字符串 ≈637 条 + index.html ≈50 条,去重后预计 **480-560 个 key**。Top:sidebar.js 179 / shell.js 66 / blockedit.js 61 / browser.js 60 / schema-validate.js 47 / toolbar.js 41 / doc-templates.js 35 / update-status.js 30 / 菜单栏 33 / 对话框 ~18。**≈104 行是 `'中文'+变量+'中文'` 拼接,要逐条改写成 `{param}` 占位模板——这是最大的逐条工作量与风险点,不能脚本化。**

## 核心决策(plan 拍死,执行不再纠结)

1. **切语言 = 整窗重载,不做实时替换。** 静态外壳(~100 条:index.html 50 + 工具条 41 + 固定 title)建一次不重建,实时替换要给全部节点打 data-i18n + 写扫描替换 + 拆重建工具条,投入大;其余 ~500 条本来就按需重建、下次渲染自动新语言。做法:设置页改语言 → 主进程 setPref + `buildMenu()`(菜单即时生效)→ renderer 弹确认「重新加载以应用语言」→ 用户确认后 `location.reload()`(自动保存已 flush;有未保存临时文档时提示先保存)。跟随系统态改系统语言 = 重启 app 生效(`app.getLocale()` 只在启动读,**没有** nativeTheme 那样的事件——别照抄 appearance 的 `nativeTheme.on('updated')` 造死监听)。
2. **菜单 role+中文 label 覆盖策略:全部继续 t()。**(`剪切/拷贝/粘贴/全选/退出` 是 role + 中文 label 覆盖,main.js:159-162。)不删 label 交给 Electron:系统本地化按 OS 语言、我们按 app 语言,用户锁中文跑英文系统会出现「半中半英」。唯一例外 `role:'windowMenu'` 子项(Electron 自动填,无法 t)——顶级 label t(),子项接受跟系统,记欠账。
3. **e2e 锁 zh = `WS2_LANG` env seam。** 主进程读 pref 时:`!app.isPackaged && process.env.WS2_LANG` → 强制该值,优先于 store 和 `app.getLocale()`(照 WS2_USERDATA 等 seam 惯例,main.js:13 的闸)。28 个 spec 各自 `electron.launch`、无共享 helper:**最小改动 = 逐个 launch env 补 `WS2_LANG:'zh'`**,不做 helper 大重构(230 处中文断言全保住,零改写)。此项必须在**第一个提取单元合并前**就位,否则 CI(en runner)上已提取的文案变英文、断言翻红。
4. **renderer 拿字典的通道:preload 一次性注入,不走每次跨桥调用。** renderer `nodeIntegration:false` 没 require(S3 教训);preload(`sandbox:false` 已设)`require('../lib/i18n')` + 字典,把 `{ lang, dict }` 经 `contextBridge` 一次性暴露(`ws2.i18nBoot()`),renderer 侧 `i18n-ui.js`(照 appearance-ui.js 的形状)boot 时构建**全局 `window.wsT`**,各 renderer 模块直接用。每次 t() 不跨 contextBridge(几百次调用的开销免掉)。editor iframe 内模块怎么拿 t 是实现时确认项(照 find-in-doc 跨 iframe 先例处理)。

## 架构映射(照 appearance 先例,一一对应)

| 环节 | appearance(已存在) | i18n(本 plan 新建) |
|---|---|---|
| 纯逻辑 | `src/lib/appearance.js` | `src/lib/i18n.js`(从 ui-demo core.ts 翻成 CJS:normalizePref/langOfSystem/effectiveLang/makeT/configureI18n/setActiveLang/t) |
| 字典 | — | `src/i18n/{zh,en}/*.js`(CJS,main+preload 共用;命名空间按真 app 模块:menu/dialog/sidebar/shell/editor/browser/update/schema/common…具体切法执行时定,原则同 Phase 1:按模块分文件防撞车) |
| 持久化 | `src/main/appearance-store.js`(userData/appearance.json,原子写) | `src/main/language-store.js` 同款(userData/language.json,init/getPref/setPref,路径作参数 node:test 可测) |
| 主进程枢纽 | main.js applyAppearance(:122)+ 启动序列(:332-338) | applyLanguage():setPref + setActiveLang + buildMenu() + 广播;whenReady 里 languageStore.init + `app.getLocale()` + configureI18n(紧挨 appearanceStore.init) |
| IPC | get/set-appearance + appearance-changed | get-language / set-language / language-changed |
| preload | ws2.getAppearance 等(:50-53) | ws2.getLanguage/setLanguage/onLanguageChanged + **i18nBoot()**(决策4) |
| renderer 胶水 | appearance-ui.js | i18n-ui.js(boot 构建 window.wsT + index.html 静态外壳替换 + 重载确认) |
| 设置页 | browser.js renderSettingsPage 外观段(:950-975) | 同函数加「语言」段(三态 select,紧挨外观段,照 ui-demo Settings.tsx 语言段) |
| 系统值监听 | nativeTheme.on('updated')(:338) | **无对应物,不建**(决策1) |

## 实现单元

**U1 · 纯核心 + 字典骨架**(纯加法,不改任何界面)
`src/lib/i18n.js`(CJS 版 core,与 ui-demo core.ts 逻辑逐行对齐)+ `src/i18n/{zh,en}/` 目录与 index 合并器 + `test/i18n.test.js`(node:test:三态归一/effectiveLang/makeT fallback/参数替换/无 locale 回 zh)。Verification:node:test 绿。

**U2 · store + 主进程接线 + e2e 锁 zh**(先于一切提取)
`src/main/language-store.js` + main.js 启动序列/IPC/applyLanguage + preload 暴露 + **WS2_LANG seam** + **28 个 e2e spec 的 launch env 补 `WS2_LANG:'zh'`**。Verification:node:test(store 原子写/init 归一);e2e 全量回归绿(此时界面仍硬编码中文,断言不受影响——本单元只是把闸提前装好)。

**U3 · 主进程文案提取**(menu/dialog 命名空间)
菜单栏 33 条(buildMenu 全部 label → t,切语言重建)+ 对话框 11 处 title/buttons/filters + 主进程 toast(web-tabs.js:51 等)+ **磁盘默认名 main 兜底**(workspace.js:175/193、ipc.js:759、md-adapter.js:295——拍板③:renderer 不传时兜底也要按当前语言,否则英文态新建仍写中文名)。Verification:e2e 回归 + 手测英文态菜单。

**U4 · renderer 胶水 + 静态外壳 + 设置页**
i18n-ui.js(全局 wsT + boot 时替换 index.html 的 50 条静态文案——给节点补 data-i18n 属性或 boot 扫描已知 id/selector,执行时选省的)+ 设置页语言段 + 切换确认重载流程。Verification:手测三态切换 + 重载生效 + 持久化。

**U5 · renderer 大头提取**:sidebar.js(179)+ shell.js(66)+ browser.js(60)。
**U6 · editor + 其余 renderer**:blockedit/toolbar/linkview/insert/mention/find/basic-edit/slashmenu/pdf-viewer/update-ui/draghandle 等(~250 条)。
**U7 · lib 可见文案**:update-status(30)/web-context-menu(17)/bookmarks(4)/doc-templates 的 name+desc/schema-validate violations(47)。
U5-U7 可 subagent 并行(按不重叠文件 + 不重叠命名空间字典切,Phase 1 已验证的执行模式;**主 session 逐簇兜底,subagent 全绿≠对**)。拼接串(~104 行)优先人工改写成 `{param}` 模板,不许 subagent 用字符串裁剪糊弄。Verification:每单元 build + 定向 e2e。

**U8 · 三道门 + CI 接线 + 语言 e2e**
`scripts/i18n-scan.mjs`/`i18n-parity.mjs`/`i18n-usage.mjs` 真 app 版(扫 `src/`,AST 对 .js 同样有效,注释天然豁免;白名单:doc-templates 模板正文等)+ **接进 CI test job**(真 app 的门在 CI 有牙——ui-demo 侧的门只本地跑,这里别复刻那个盲区)+ 新 `e2e/language.spec.js`(WS2_LANG=en 启动断言菜单/设置页英文 + zh 启动断言中文 + 变异自检:掏空一个字典 key 断言门翻红)。Verification:三门绿 + 变异自检双向 + 全量 e2e。

依赖:U1→U2→U3/U4 并行→U5/U6/U7 并行→U8。**U2 必须整体合入后才允许 U3+ 开始**(锁 zh 先行)。

## 风险与止损

- **e2e 翻红面**:230 处中文断言,任何一处 launch 漏补 WS2_LANG 就翻红一批——U2 交付时 grep 门:`grep -L "WS2_LANG" e2e/*.spec.js` 必须为空(有 launch 的文件)。
- **拼接改写引入回归**:104 行逐条改写,U5-U7 每单元跑受影响 spec;linkview/mention 的插值(「在 X 新建「Y」」)语序要 en 单独措辞,别直译。
- **editor iframe 的 t 通道**是唯一架构性未知(文档 iframe 是 sandbox srcdoc,window.wsT 不可达?)——U6 开工前先 spike 半小时,照 find-in-doc(constructable stylesheet 跨 iframe)/blockedit 现有注入方式确认,写进 U6 交付说明。
- **英文文案偏长挤爆布局**:发现记已知项,不在本 feature 修布局(同 Phase 1 欠账口径)。

## 交付物

`feat/app-i18n` 单 PR:U1-U8 + `docs/features/i18n.md` 更新(文件映射表填真路径、Phase 2 欠账划掉、新欠账:windowMenu 子项跟系统 / 模板正文 / 英文超长)+ CHANGELOG。英文术语沿用 Phase 1 术语表(605 条对照表已给 Colin,真 app 新增的 key 补进同一张表)。
