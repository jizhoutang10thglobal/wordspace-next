# 实现计划:系统级中英切换(i18n)—— ui-demo 先行

- 日期:2026-07-15 · 需求:Colin(「中文版/英文版 + 切换;为未来多语言把架构提前想好;先 ui-demo 后真 app」)
- 规划:Claude(含四项拍板,见下)· 状态:**待执行,本文档只是方案,实现由执行 AI 完成**
- 基线:origin/main `a454c7d`(含 #204 图片块)或执行时的最新 main

## 已拍板(Colin 2026-07-15,别再问)

1. **三态**:跟随系统(默认)/ 中文 / English——与深色模式外观三态(v0.9.0)同构。
2. **切换入口只放设置页**(照外观选择器先例,不加顶栏快捷钮)。
3. **写进磁盘的默认名按当前语言生成**(英文态新建 → `Untitled.html`/`New Folder`);**已存在的文件永不改名**(用户数据)。
4. **Phase 1 只翻 UI chrome**:按钮/菜单/toast/对话框/空态/tooltip/设置页/斜杠菜单/快捷键面板等。**不翻**:用户文档内容(永不)、模板台的模板正文(Phase 2 单独立项,涉 Wendi 产品面)、mock 演示数据(假网站/种子文档)。

## 公共约束(动手前必读)

- **开自己的独立 worktree**:`git fetch origin main && git worktree add <目录> origin/main -b feat/ui-demo-i18n`。⚠ team-memory 2026-07-15 公告:**ui-demo 常驻 worktree 被 3+ session 并发抢,严禁共用**(实测撞车:别人切分支会劫持你未提交改动)。ui-demo 依赖可从主仓 `ui-demo/node_modules` 软链(deps 未变时)或 `cd ui-demo && npm install`。
- 一 feature 一 PR,base=main;**同一 PR 建 `docs/features/i18n.md`**(铁律:改交互必带 spec;本 feature 的 spec 是新文件,不与并行 PR 共享——上周 merge-train 血训:多 PR 改同一 spec 文件会级联冲突)。
- push/PR 用 `jizhoutang10thglobal` 账号(默认凭证 CTlandu 会 403;token 注入命令参照 `.claude/skills/remember-global/SKILL.md`)。CI required = `test`+`e2e`,PR BEHIND 先 `gh pr update-branch`。**不自合,留给 Colin**。
- 变异自检铁律:**先 commit 再变异**;变异翻红 + 还原翻绿,门才算有牙。
- 本 feature 只动 `ui-demo/`(+新增 spec/脚本),不碰 `src/`(真 app 是 Phase 2 移植,见 U8 spec 的欠账)。真 app 的 e2e(231+条)不受影响。

## 背景与架构主张

### 为什么不用 react-i18next / 现成 i18n 库(执行者别"顺手"装库)

这个 feature 的终点是**真 app**:vanilla JS renderer(`src/renderer/*.js`,无 React)+ **Electron 主进程**(菜单栏 `Menu`、原生对话框标题、主进程推的 toast 如「Wordspace 浏览器不支持下载」全是中文,都要翻)。React 生态的 i18n 库进不了主进程和 vanilla renderer。所以自研微型层:**一份纯 TS/JS 语言字典 + 一个几十行的 `t()` 函数**,React 侧只包一层 zustand hook。ui-demo 定稿后字典+t() 原样搬进真 app 两个进程(本仓「纯逻辑可移植」传统:theme-manager / tabs.js / appearance 先例)。将来加日语 = 加一个字典目录,零架构改动。

### 先例:照抄外观三态(v0.9.0 已合 main)

`ui-demo/src/appearance.ts` 是完整模板:纯函数(`normalizePref`/`effectiveTheme`)+ zustand store + localStorage 持久化(key `ws-appearance`)+ `APPEARANCE_LABELS` + `Settings.tsx` 里的选择器(`st-label`「外观」那节)。i18n 同构:`language.ts` + key `ws-language` + Settings 加一节「语言 / Language」。
**一个先例没有的差异**:系统深浅有 `matchMedia` 事件可监听,**系统语言没有浏览器事件**——`navigator.language` 只在启动时读一次,系统语言变更要重开页面才生效(真 app 用 `app.getLocale()` 同理)。这个限制写进 spec,不要试图造监听。

### 规模摸底(已扫)

ui-demo 56 个源文件含中文、约 1800 行 CJK,但**大量是代码注释(仓库惯例中文注释,不翻)和 mock 数据(不翻)**;估计真正要提取的 UI 文案 **400-600 条**。大头:`Canvas.tsx`(298 CJK 行,编辑器工具栏/斜杠菜单/块菜单/placeholder)、`ArcSidebar.tsx`(119)、`mock/store.ts`(145,内含 toast 文案和磁盘默认名=要提,种子数据=不提)、`lib/shortcutList.ts`(65,快捷键面板)。

## 实现单元

### U1 · i18n 核心层 `ui-demo/src/i18n/`(纯逻辑,可移植)

```
ui-demo/src/i18n/
  types.ts        // LangPref = 'system'|'zh'|'en';  Lang = 'zh'|'en'
  core.ts         // 纯函数:normalizeLangPref / effectiveLang(pref, systemLang) / makeT(dicts, lang)
  zh/{common,sidebar,editor,browser,modals,settings,shortcuts}.ts   // 命名空间分文件
  en/{同上}.ts
  index.ts        // 合并字典 + zustand store(useLang)+ useT() hook + localStorage('ws-language')
```

- **字典按命名空间分文件**,两个理由:①并行 session/subagent 提取不同模块时不撞同一文件(merge-train 血训);②将来加语言=加一个目录。key 形如 `sidebar.openFolder`,值支持 `{name}` 插值(`t('sidebar.openedFolder', { name })`)。
- **zh 是源语言**(=现状原文,提取时照搬);`t()` 对 en 缺 key **fallback 到 zh**,绝不显示 key 名(半翻译的界面能用,烂 key 的界面不能用)。
- `core.ts` 不 import React/zustand(真 app 主进程要直接 require 的部分);store/hook 只活在 `index.ts`。
- 语言切换即时生效:store 变更 → React 全树重渲染,无刷新。`document.documentElement.lang` 同步设(`zh-CN`/`en`,可访问性+字体栈)。
- node 环境兜底(stress/audit/test-links 等脚本会 import lib):无 `navigator`/`localStorage` 时 effectiveLang 回 `zh`,不抛。

### U2 · Settings 页语言选择器

`Settings.tsx` 照「外观」那节加「语言 / Language」:三选项(跟随系统 / 中文 / English),当前生效语言的说明行(跟随系统时显示「当前:中文(跟随系统)」)。选择器自身的文案也走字典(切到 English 后设置页立刻变英文)。

### U3 · CJK 扫描门 `ui-demo/scripts/i18n-scan.mjs`(防烂的核心,先做)

- 用 ui-demo devDeps 现成的 `typescript` 走 AST:遍历 `ui-demo/src/**/*.{ts,tsx}`,只报 **StringLiteral / 模板字符串 / JSXText / JSX 属性字符串** 中含 `[一-鿿]` 的节点,输出 file:line。**注释天然不报**(AST 不含注释)——仓库的中文注释惯例不受影响,这是必须用 AST 而不是裸 grep 的原因。
- 白名单(写在脚本顶部、附注释说明为什么豁免):`src/i18n/zh/**`(字典本体)、`src/mock/seed.ts`、`src/mock/pagedSamples.ts`、`src/components/MockSites.tsx`、`src/lib/nonConformSamples.ts` 等 mock/演示数据(执行时按拍板④核对清单;`mock/store.ts` **不整档豁免**——里面 toast/默认名是 chrome,要提;种子常量部分可用行内豁免注释 `// i18n-exempt` + 脚本识别)。
- `package.json` 加 `"i18n:scan": "node scripts/i18n-scan.mjs"`;README/spec 写明:**scan 报红 = 门失败**。
- **变异自检**(先 commit):往任一组件塞一句硬编码中文 → scan 必红;还原绿。反向:往白名单文件塞 → 不报(不误伤)。
- 顺带做**字典一致性检查**(同脚本或同目录小脚本):en 相对 zh 的缺 key 列表(警告不阻断,fallback 兜着)+ zh/en 里多余的死 key(阻断,防字典烂)。

### U4-U7 · 存量提取(按簇,可并行)

提取规则(每簇统一):组件 `import { useT } from '../i18n'`,JSX 文本 → `{t('ns.key')}`;title/aria-label/placeholder 属性一并提;含变量用插值;**分不清是不是用户可见就提**(白名单外宁滥勿漏,scan 门要清零);en 翻译同步写(执行 AI 出第一版,PR 描述里 @Wendi review 术语口径);**不提**:注释、console.log、data-testid、CSS 类名。

- **U4 editor 簇**(最大头,建议执行者亲自做别交 subagent):`Canvas.tsx` + `BasicEditor.tsx` + 分页相关组件 + `lib/schemaCheck.ts` 里用户可见的降级条/校验文案。⚠ Canvas.tsx 是多 session 热点文件(图片块 #204 刚动过),勤 rebase。
- **U5 sidebar+tabs+modals 簇**:`ArcSidebar.tsx` + `CreateModal.tsx` + `PageSetupModal.tsx` + 右键菜单 + `mock/store.ts` 的 toast 文案与**磁盘默认名**(拍板③:「未命名文档」「新建文件夹」「副本」等生成点改走 `t()`,注意查重后缀逻辑对英文名同样成立)。
- **U6 browser 簇**:`WebView/NewTab/HistoryPage/BookmarksPage/Settings` 等(起始页欢迎语+安全提示「内置浏览器没有恶意网站防护…」、omnibox placeholder、历史/收藏页文案)。`MockSites.tsx` 不动(mock 网页内容)。
- **U7 杂项**:`lib/shortcutList.ts`(快捷键面板 65 条,纯数据文件改造成 key 引用)、`Agents.tsx`、`lib/links.ts`/`lib/page.ts` 的用户可见部分(多数中文是注释,仔细分)、日期显示(如「今天/昨天」类相对时间,若有,走字典或 `Intl.RelativeTimeFormat`)。

**若用 subagent 并行**:字典分文件已消除撞车面,不同簇=不同文件集;但主 session 必须逐簇 review diff——本仓血训:**subagent 全绿≠对**(bug-hunt 修复批 317 e2e 全绿之上 review 又抓出 3 真 P2)。

### U8 · spec `docs/features/i18n.md`(新文件)

内容:行为契约(三态语义/fallback 规则/翻译范围划界四条拍板/系统语言无监听的限制/磁盘默认名规则)+ 文件映射表(ui-demo 现有 ↔ 真 app 占位)+ **欠账**:①真 app 移植(renderer 双份+主进程菜单/对话框/toast、`app.getLocale()`、settings 持久化,照外观 U4-U7 的先例路径)②模板正文双语化(Phase 2,Wendi 参与)③真 app e2e 断言全按中文文案写,port 时**测试环境锁 zh**(启动 env 固定语言),新断言优先 data-testid ④mock 数据不翻的口径。

### U9 · 验收门 + 收尾

- `cd ui-demo && npx vite build` 绿(TS 编译错=漏改的 import/类型)。
- `npm run i18n:scan` 0 违规(+变异自检红/绿闭环)。
- 现有 ui-demo 脚本门全绿:`npm run test:links`、`npm run test:page`、`npm run stress:selfcheck`——**这些脚本若断言中文文案,靠 node 兜底恒 zh 保绿**;真被 en 破坏的断言要改成锁 zh,不许删断言。
- 手动双语走查清单(两种语言各过一遍,截图进 PR):设置页切换+刷新持久化 / 侧栏(新建/右键/toast)/ 编辑器(斜杠菜单/块菜单/placeholder)/ 新建 modal 模板台(chrome 英文、模板正文仍中文=预期)/ 浏览器起始页+历史+收藏 / 快捷键面板 / 英文态新建文件名=Untitled.html。
- PR 描述:四项拍板记录 + en 术语表(请 Wendi review)+ 走查截图 + 欠账清单。

## 风险与注意

- **#205(用户自定义模板)在飞**,会往 ui-demo 加新中文文案。不等它:合并顺序无所谓,谁后合谁补——scan 门会把新增硬编码中文当场揪出,补提取是一次小 PR。若 #205 先合,rebase 后跑 scan 即知增量。
- main 移动极快(昨天一天推了十几次),**每次 push PR 前 fetch+rebase**;PR CI 跑 merge commit,本地绿≠CI 绿。
- `mock/store.ts` 混着「要提的 chrome 文案」和「不提的种子数据」,是最容易提错/漏提的文件,review 重点。
- 英文 UI 会比中文长(如「置顶」→"Pin to top"),侧栏窄列注意 truncate 类是否已兜住;发现布局挤爆记进 PR 已知项,不在本 PR 修样式。
- 执行者读过就好,别再问的:react-i18next 之类库不引入(理由见上);翻译质量第一版 AI 出、Wendi 终审。

## 验收标准(checklist)

- [ ] U1-U3 地基:三态 store+t()+fallback+扫描门,变异红/绿闭环
- [ ] U4-U7 提取:i18n:scan 0 违规,en 字典完整(缺 key 警告清零或列明留待 Wendi)
- [ ] U2 设置页选择器双语可用,localStorage 持久化过刷新
- [ ] 磁盘默认名按语言生成(英文态 Untitled.html/New Folder),已有文件不动
- [ ] vite build + test:links + test:page + stress:selfcheck 全绿
- [ ] docs/features/i18n.md 落地(含真 app 移植欠账)
- [ ] PR 含双语走查截图 + en 术语表 @Wendi
