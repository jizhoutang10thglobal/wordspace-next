# 分页文档拆分为 Schema 2(流式/分页双 Schema)——实现计划

**日期**:2026-07-23 · **类型**:refactor + feat · **状态**:active · 经 5-persona doc review 修订(同日,抓出防漂移门/范式轨现状/多 page 块等 8 处,已全部吸收)
**背景**:Wendi 提出把分页从 Schema 1 里拆出去,成为独立的 **Schema 2「分页文档」**(Word 式,后续承载页眉/页脚/纸张等强分页功能);Schema 1 = **「流式文档」**(类 Notion,不分页)。这推翻 2026-07-08 的「分页 = Schema 1 可选版式」口径(docs/features/paged-doc.md 开头那条),回到最初的 Schema 2 构想。
**执行者注意**:本 plan 由另一个模型执行。所有 file:line 锚点在 origin/main `2c02390`(2026-07-23)上核实过;执行前先 fetch 最新 main、锚点若漂移以真代码为准。

---

## 0. 决策记录(Colin 2026-07-23 拍板,覆盖旧口径)

1. **分页文档 = 独立 Schema 2**,不再是 Schema 1 的可选版式。用户可见命名:Schema 1 =「流式文档」、Schema 2 =「分页文档」(Wendi 的叫法,两侧 UI 与文档统一用这套名,不要自创)。
2. **范围 = 拆分重构 + 第一个新功能**:页眉+页脚自定义文字(屏显每页纸顶/纸底边距区 + 导出 PDF 同口径)。视觉细节(字号/位置/与页码共存排布)初版拍死一个合理方案,PR 描述标「待 Wendi 真机验收调整」。
3. **page 块写坏(解析不出)→ 宽容回退 Schema 1**:文档按流式打开、分页不生效、不降级。等于现状行为,由 registry 的顺序遍历天然实现(见 §2)。
4. **转换入口**:保留「页面设置」弹窗的分页开关,其语义显性化为「流式 ↔ 分页文档转换」;同时**两侧新建文档 modal 的范式轨把「范式 2」解灰**(现在是灰色 placeholder),命名换成「分页文档」,选中后给分页文档模板。
5. **ui-demo 同步改**(不是只更 spec)。

历史脉络(执行者了解即可):2026-07-08 前真做过一版独立 Schema 2(旧 worktree,已废);2026-07-08 反转为「Schema 1 版式」并按此实现合入 main(PR #164);本次是二次反转,但**只动身份/路由层,V4 分页引擎与页面设置实现全部保留**。

---

## 1. 现状锚点(已核实)

| 东西 | 位置 | 现状 |
|---|---|---|
| Schema 注册表 | `src/lib/schema-registry.js` | descriptor `{id,detect,validate}` + `classify()`,2026-07-02 预埋,注释原话「加 Schema #2 = 新 descriptor + register()」。`:28` 现在把 schema-1 注册为兜底(detect 恒真) |
| 打开分流 | `src/renderer/shell.js:286` `routeDoc` | 已走 `classify()`,但结果压成布尔 `docConform`(`:44`);`docPageCfg`(`:43`)在 routeDoc 里顺带解析 head 的 `style[data-ws-schema-css="page"]` |
| 分页引擎挂载 | `shell.js:398` 附近 | 条件 =「conform + docPageCfg 非空」→ `WS2Pagination.attach` |
| 分页引擎/纯逻辑 | `src/editor/pagination.js` / `src/lib/schema-page.js` | V4 推挤引擎 + buildPageCss/parsePageCss/PAGED_PRINT_CSS。**本 plan 一行不改引擎算法** |
| 页面设置 | `shell.js:1091` `openPageSetupModal` / `:1061` gating / `applyPageSetup` | 开关写入/移除 page 块 + `meta[name="ws-page-numbers"]`,轻量重接引擎、不动 undoMgr |
| 校验器 | `src/lib/schema-validate.js:167` `validateHead` | head 白名单放行 `meta[name]` 与 `style[data-ws-schema-css]` → paged 文档天然也过 Schema 1 结构校验 |
| PDF 导出 | `shell.js:1380` 附近 + `src/main/pdf-export.js` | 分页文档走 preferCSSPageSize;页码走 footerTemplate,开关读 `meta[name="ws-page-numbers"]` |
| md 导出 gating | `shell.js:1448` | `docConform` 参与 gating(paged 文档现在可导 md,拆分后**不许回归**) |
| 真 app 新建 modal 范式轨 | `src/renderer/sidebar.js:2519` 附近(spec §4.5.1) | 范式 1 可用,2/3 灰态「敬请期待」;i18n key `sidebar.paradigm2` |
| ui-demo 新建 modal | `ui-demo/src/components/CreateModal.tsx:16` PARADIGMS | 同款范式轨,2/3 带 `soon` 标记;i18n `modals.paradigm2` |
| ui-demo 分页 | `ui-demo/src/components/Canvas.tsx` + `PageSetupModal.tsx` + `ui-demo/src/mock/paged.ts` | localStorage per-doc 配置,无 schema 身份概念 |
| meta 提示写入点 | `shell.js:27`(@新建/断链新建互链文档 `__wsCreateLinkedDoc`)、`src/main/md-adapter.js:298` | 都写死 `content="1"`。⚠ `doc-templates.js` 的模板(含临时文档)目前**不写任何** wordspace-schema meta——meta 缺失是常态,由「归类只认内容」+ U4「缺失就补」兜住 |
| AI 创作资产 | `skills/wordspace/SKILL.md`(+`references/schema-1.md`)、`src/renderer/ai-guide.md`、`docs/schema-1-ai-authoring.md` | schema 表只有 #1;meta 只当提示、校验器不看(铁律不变) |
| 验证门 | `e2e/paged.spec.js`(8 条)、`test/schema-registry.test.js`、`test/schema-page.test.js`、`test/serialize.test.js` | 全绿是本次重构的行为不回归权威门 |
| 对齐 spec | `docs/features/paged-doc.md` | 开头就是旧口径原文,要反转重写 |

---

## 2. 架构方案(身份与归类语义)

**Schema 2 descriptor**(新文件 `src/lib/schema-2-paged.js`,CJS + window 双导出,同仓惯例):

- `id: 'schema-2'`
- `detect(doc)`:head 里存在 `style[data-ws-schema-css="page"]`(结构性快速筛;不看 meta——校验器三铁律①不变(正本 `docs/schema-1-draft-v0.md` §4.3),meta 永远只是提示)
- `validate(doc)`:复用 `schema-validate.js` 的全部结构规则(直接调用 `WSV.validate`)**加一条**:page 块必须可解析(`WS2SchemaPage.parsePageCss` 非 null)。解析不出 → 本 schema 不认
- **多 page 块语义(必须一致贯穿)**:detect/validate/parse 一律以**第一个** `style[data-ws-schema-css="page"]` 为准(多余块不算「写坏」);applyPageSetup 关分页时移除**所有**匹配块(`querySelectorAll`,不是现在 `:1071` 的 `querySelector` 单删——否则双块文档关分页后磁盘仍剩第二个块,重开又归回 schema-2,U4 验收自破);U7 的创作规范写明「恰好一个 page 块」为 canonical

**注册顺序 = 归类语义**(必须有单测锁死):schema-2 注册在 schema-1 之前;schema-1 保持 detect 恒真兜底,head 白名单**不禁** page 块。由此 `classify()` 自然给出:

| 文档 | 归类 | 行为 |
|---|---|---|
| 结构合规 + page 块可解析 | schema-2 | 块编辑 + 分页引擎 |
| 结构合规 + 无 page 块 | schema-1 | 块编辑,流式 |
| 结构合规 + page 块写坏 | schema-1(宽容回退,拍板③) | 流式打开,分页不生效,不降级 = 现状 |
| 结构不合规 | null | 基础编辑降级 = 现状 |

**路由升级**(shell.js):`docConform` 布尔 → `docSchema`(存 classify 结果 `{schemaId, conform}` 级别的对象)。挂分页引擎条件从「conform + docPageCfg」改为「schemaId === 'schema-2'」;docPageCfg 的解析移到 schema-2 命中分支(或保留在 routeDoc,但只在 schema-2 时非空)。这是 2026-07-02 预埋时刻意缓做的那一步(`shell.js:288-289` 注释原话),现在补上。

**转换 = 内容变更**:身份只认内容,所以 applyPageSetup 写入/移除 page 块本身就是转换;开关打开时**同步把 `meta[name="wordspace-schema"]` 提示改为 `"2"`**(关闭改回 `"1"`;meta 缺失就补),并更新 `docSchema`。校验器依旧不看 meta。

**注册机制(定死,不留自由度)**:descriptor 文件是**被动数据模块**——只导出/挂 window 一个纯 descriptor 对象,**不自注册、不 require registry**(自注册有两个实证坑:① CJS 循环 require——registry 的 IIFE 到末尾才赋 `module.exports`,descriptor 反向 require 拿到半成品、`register` 是 undefined;② 现有 node 消费方 `e2e/images.spec.js:108/:180`、`e2e/paged.spec.js:156/:184/:217` 都只 `require('../src/lib/schema-registry.js')` 就调 `classify`——若注册散落在 descriptor 文件里,它们拿到空注册表、conform 断言全翻红,而且炸的是 plan 没列的文件、看起来像行为回归)。**registry 是唯一收口**:CJS 分支自己按优先级 require 两个 descriptor(schema-2 → schema-1);浏览器分支读 window 全局(index.html 里 descriptor `<script>` 排在 registry 之前),register 幂等防重。顺序只活在 registry 一个文件里 + U1 单测断言 `schemas()` 序列;index.html 的 script 标签处加一行注释说明顺序约束。

---

## 3. 实现单元

### U1 — Schema 2 descriptor + registry 归类(纯逻辑,test-first)

**文件**:`src/lib/schema-2-paged.js`(新)、`src/lib/schema-registry.js`(注册点重构)、`src/renderer/index.html`(script 标签)、`test/schema-registry.test.js`(扩)、新 `test/schema-2-paged.test.js`。
**测试场景**(jsdom/node:test,对磁盘字节 reparse 口径):上表四行归类矩阵各至少一例;page 块写坏的具体样本(空 `@page{}`、非法尺寸、纯垃圾文本);**双 page 块样本两例**(双合法不同值→按第一个;首坏次好→按第一个=写坏回退 schema-1);meta 自称 `content="2"` 但无 page 块 → schema-1(铁律①);meta 自称 `"1"` 但有合法 page 块 → schema-2(内容优先);注册顺序断言(schemas() 序列);直接 `require('schema-registry')` 即拿到已注册满员的注册表(护住 e2e/images.spec.js 等既有 node 消费方)。
**变异自检**:把 schema-2 的 validate 改成恒真/把注册顺序倒过来,归类矩阵测试必须翻红。

### U2 — shell.js 路由升级(docConform → docSchema)

**文件**:`src/renderer/shell.js`(routeDoc 与全部 docConform 读点,约 10+ 处:`:44/:627/:666/:677/:739/:745/:806/:898/:1448` 等,执行时全量 grep)、`e2e/paged.spec.js`(如断言口径需跟随)。
**要点**:分流三态不变(块编辑/块编辑+分页/基础编辑),只是判定源换成 schemaId;`exportMdBtn` gating(`:1448`)语义 = 「schemaId 非 null」,**分页文档仍可导 md**(现状,别回归);`updatePageSetupBtn`(`:1061`)对 schema-1 与 schema-2 都开放(它是转换入口),**但 md 例外原样保留**——`!isMdPath` 在挂引擎条件(`:401`)与页面设置 gating(`:1062`)两处都不许丢:.md 永远没有流式↔分页转换入口(md 磁盘格式装不下 page 块/meta,`md-adapter.js:302` htmlToMd 只转 body、head 整个丢弃,转了也会在保存时静默蒸发);临时文档/历史恢复/外部改动重判(`:666/:806`)各路径的 docConform 赋值点全部升级,**别漏 `:934` 关文档清理**。
**测试**:现有 `e2e/paged.spec.js` 8 条全绿 = 行为不回归权威门;补 1 条 e2e:同一文档开分页→关分页,身份随之在块编辑±分页引擎间切换、内容无损。
**这是共享核心**(shell.js):推 PR 前本地 `npm run test:e2e:dot` 全量兜底一次(CLAUDE.md 纪律的唯一例外情形)。

### U3 — 新建入口:范式 2 解灰(真 app)

**文件**:`src/renderer/sidebar.js:2519` 附近、`src/lib/doc-templates.js`、`src/i18n/zh|en/sidebar.js`(范式命名:范式 1「流式文档」/范式 2「分页文档」+ 一句描述;范式 3 维持灰态)、spec 联动 `docs/browser-feature-spec.md` §4.5.1。
**⚠ 现状比「解灰」远(doc review 实查,别按字面理解工作量)**:范式轨的 p1/p2/p3 现在是**纯展示 `<span>`**——没有 onclick、没有 cursor 样式、p1 只是静态挂了 `is-on`;模板 grid 在范式轨 append 之前就同步建好,**不存在**「按选中范式换模板列表」的机制;而且范式轨只在 `if (omniRow)` 分支(⌘T 新标签页路径,`:2313/:3219`)渲染——文件夹「+」(`:728`)/右键「新建文档」(`:1411/:1429`)调 `openCreateModal` 不带 temp,**根本不画范式轨**。
**行为(拍定)**:范式轨在**所有** `openCreateModal` 路径渲染(把 secRow 构建挪出 `if (omniRow)`),p1/p2 做成真交互(真 `<button>` 元素、可聚焦;点击切 active 态 + 右侧模板区按当前范式重建——照抄 `ui-demo/src/components/CreateModal.tsx` 的 rail/pane 结构);p3 维持灰态不可点。选中范式 2 → 模板列表给「空白分页文档」(最小:空文档 + 默认 A4 canonical page 块(`buildPageCss`)+ `meta wordspace-schema content="2"`;要过 `scripts/validate-schema.js` 自查)。doc-templates 加 schema 维度(模板挂在哪个范式下),范式 1 现有模板不动。若「全路径」实现中发现工作量失控,回退底线 = 先只做 ⌘T omni 路径、文件夹路径列欠账进 spec——但默认按全路径做,别悄悄缩水。
**测试**:doc-templates 单测(分页模板过校验器且归类 schema-2);e2e:⌘T modal 选范式 2 → 新建 → 文档以分页视图打开;文件夹「+」路径选范式 2 → 新建进该文件夹 → 分页视图打开。

### U4 — 转换语义显性化(页面设置)

**文件**:`src/renderer/shell.js` applyPageSetup/openPageSetupModal、`src/i18n/*/shell.js`。
**行为**:开关文案改为「分页文档」语义(如「转为分页文档 / 转回流式文档」,具体措辞过 i18n 字典);applyPageSetup 同步 meta 提示 + docSchema(见 §2,关分页删**所有** page 块);弹窗副标说明当前文档类型——宽容回退的文档(page 块写坏归 schema-1)副标**不做特殊区分**、与普通流式文档一致(拍板③「不降级不惩罚」的延伸)。转换仍轻量重接(不动 undoMgr,现状)。
**分页专属 meta 的保留语义(统一拍死,消 doc review 抓到的矛盾)**:关分页时 `ws-page-numbers` / `ws-page-header` / `ws-page-footer` 三个 meta **一律保留**(重开分页设置全回来,Word 直觉)。注意这是对现状的**有意小改**:现在 `:1082` 关分页会 `remove()` ws-page-numbers——改成保留,三兄弟行为一致;U5 说「沿用 ws-page-numbers 既有模式」仅指命名与 head 白名单,不指删除行为。
**测试**:e2e:开分页 → 保存 → 磁盘字节含 page 块 + meta="2" → 重开归类 schema-2;关分页 → 磁盘无 page 块(含双 page 块文档也删干净)+ meta="1" → 归类 schema-1;开→关→开 往返,页码/页眉/页脚三设置一起存活。

### U5 — 第一个 Word 功能:页眉+页脚文字

**文件**:`src/renderer/shell.js`(页面设置弹窗两个输入框 + 导出参数)、`src/editor/pagination.js`(覆盖层画页眉/页脚文字)、`src/main/pdf-export.js`(headerTemplate/footerTemplate)、`src/lib/schema-page.js`(如需常量/纯逻辑)、i18n 字典、`test/schema-page.test.js` 或新纯逻辑测试、`e2e/paged.spec.js` 扩。
**设计**:
- 入盘 = `meta[name="ws-page-header"]` / `meta[name="ws-page-footer"]`(纯文本;空/缺 = 不显示)。head 白名单本来放行 `meta[name]`,两个 schema 的 conform 都不受影响;命名与白名单沿用 `ws-page-numbers` 模式(删除行为按 U4 的统一保留语义)。
- **长度与溢出(拍死一条规则,屏显/导出同款)**:单行文本,固定宽容器 + `text-overflow: ellipsis`,同一截断规则同时用于 pagination.js 覆盖层与 headerTemplate/footerTemplate 字符串(否则「同口径」在长文本处自破);输入框 maxlength 200,读取侧对任意来路的文档防御性截断到同上限(复用 shell.js 现有 clamp 风格,不新造)。
- 屏显:分页覆盖层在**每页**纸顶边距区画页眉、纸底边距区画页脚(小字号、灰色、居左;不侵入内容流、不进持久化——复用覆盖层既有 sentinel/strip 机制)。窄边距(12.7mm≈48px)下不溢出、不与正文重叠。
- 导出:printToPDF `displayHeaderFooter` + headerTemplate(页眉居左)/footerTemplate(页脚文字居左 + 既有页码居中共存;页码开关独立不变)。屏显与导出同口径。
- **安全(必做)**:页眉/页脚文字注入 headerTemplate/footerTemplate 与覆盖层 DOM 前必须 HTML-escape。e2e 对抗用例:输入 `<img src=x onerror=...>` → 按字面文本呈现、导出模板无标签注入。
- 仅 Schema 2(分页开启)时输入框可编辑;转回流式/宽容回退(page 块写坏)时输入框禁用但 meta 值保留展示(再开分页还在)——保留成本为零且符合 Word 直觉。
**测试场景**:屏显——每页都有页眉文字且几何在纸边距区内(boundingBox 断言,别只查 DOM 存在=代理断言教训);编辑推挤后页眉跟随新页界;strip 断言(持久化字节里无覆盖层产物、meta 正常在);导出——headerTemplate 参数包含转义后的文本(可用 IPC 到达探针断言 printToPDF 参数,CI xvfb 下别依赖真渲染);对抗 escape 用例。
**PR 描述标注**:视觉细节(字号/边距/排布)待 Wendi 真机验收,参数可调。

### U6 — ui-demo 同步

**文件**:`ui-demo/src/components/CreateModal.tsx`(PARADIGMS 范式 2 解灰、命名同步、分页模板)、`PageSetupModal.tsx`(页眉/页脚输入)、`Canvas.tsx`(覆盖层画页眉/页脚)、`ui-demo/src/mock/paged.ts`(config 加 header/footer 字段)、`ui-demo/src/i18n/zh|en/modals.ts|editor.ts`。
**口径**:demo 无校验器/磁盘,身份 = per-doc paged config(现状),新建「分页文档」= 建 doc 时置 paged config on。概念与命名跟真 app 对齐即可,机制差异记入 spec「有意分歧」——**但安全控制不属于「有意分歧」**:Canvas.tsx 渲染页眉/页脚文字必须走文本安全路径(JSX 文本插值或 `.textContent`),**严禁 `dangerouslySetInnerHTML`**(同文件里块内容渲染现成就是这个写法,照抄即 stored XSS);U5 的 `<img src=x onerror=...>` 对抗用例 demo 侧同款做一遍。
**测试**:ui-demo 现有验证脚本(`ui-demo/scripts/verify-paged-v4.mjs` 等)全绿;烟测新建分页文档路径;页眉输入对抗字符串按字面呈现。

### U7 — 文档与 AI 资产收口(跨切,随各 PR 落)

- `docs/features/paged-doc.md`:口径反转重写(开头决策段、行为契约补范式轨/转换/页眉页脚、对齐锚点更新)。**铁律:随改 UI 的那个 PR 同 PR 更新**,不单独攒。
- **AI 创作资产必须走防漂移门架构,严禁直接编辑拷贝**(doc review 抓到的硬伤:`test/skill-guide-sync.test.js` 逐字节锁着 正本 `docs/schema-1-ai-authoring.md` ↔ 拷贝 `src/renderer/ai-guide.md` / `skills/wordspace/references/schema-1.md` / `ui-demo/src/lib/schema-prompt.md`——直接改任何一份拷贝,required check `test` 立刻红)。正确做法(门的头注释自带扩展说明「每 schema 一份 reference,正本↔拷贝逐对加行」):新建**正本** `docs/schema-2-ai-authoring.md`(= Schema 1 规范 + 恰好一个 page 块 + 页眉/页脚/页码 meta 约定),拷贝 = `skills/wordspace/references/schema-2.md`,锁对加进 sync 测试;`skills/wordspace/SKILL.md` schema 表加 #2 行;schema-1 侧的「加指向」只改正本、再 cp 覆盖全部锁定拷贝,同一 PR 内完成(in-app AI 弹窗本次不重构,指向段随正本分发即可)。防漂移门(`test/schema-1-ai-doc-conformance.test.js` 模式)为 schema-2 建对应最小门:规范里的示例文档必须过校验器且归类 schema-2。
- `scripts/validate-schema.js` CLI 输出加 schemaId(消费方主要是 AI 文件式回路)。
- **team-memory 公告**(PR-A 合入后立即 `/remember-global`):「分页=Schema 1 版式」口径作废,分页文档=Schema 2;各 session 的 memory/文档别再按旧口径写。

---

## 4. PR 划分与顺序

| PR | 内容 | 依赖 |
|---|---|---|
| PR-A | U1+U2(拆分核心)+ paged-doc.md 口径反转 + team-memory 公告(合后发) | — |
| PR-B | U3+U4(新建入口 + 转换显性化)+ browser-feature-spec §4.5.1 更新 | PR-A |
| PR-C | U5(页眉+页脚)+ paged-doc.md 增补 | PR-A(与 B 可并行) |
| PR-D | U6(ui-demo 全量)+ spec ui-demo 侧锚点 | 概念上依赖 A 的命名,代码独立 |
| PR-E | U7 剩余 AI 资产(skills/wordspace、ai-guide、CLI) | PR-A |

一 PR 一事;PR-B/C 都动 shell.js,先合者赢、后者 rebase(merge train 教训:全量 e2e 期间别动源码)。

## 5. 公共执行约束(每个 PR 都适用)

- 从 **origin/main 最新**开新 worktree 干活(别用旧 worktree 的分支)。
- push/PR 用 `jizhoutang10thglobal` token(`gh auth token --user jizhoutang10thglobal` + credential.helper 注入;CTlandu 403)。CI required = {test, e2e-all} strict,PR BEHIND 先 `gh pr update-branch`。
- 开发迭代只跑受影响 spec(`npx playwright test e2e/paged.spec.js` 等,dot reporter/grep 收窄输出);全量是 CI 的活。动 shell.js 的 PR(A/B/C)推前本地 `npm run test:e2e:dot` 兜底一次。
- 变异自检:**先 commit 再变异**;fixture 字符串长度也是测试变量。
- 所有新 UI 文案走 i18n 字典(CJK 扫描门连 HTML title 属性都咬);中英两份都写。
- 手测 Electron 用唯一 `WS2_USERDATA`、按 PID 树杀;**绝不 `pkill electron`**。
- 窗控/xvfb 平台坑:CI 无 WM,分页断言用几何/DOM/IPC 探针,别依赖窗口态。
- **V4 四铁则不碰**(pagination.js 引擎算法零改动;U5 只在覆盖层加绘制,清理沿用全量扫荡机制)。

## 6. 风险与已知坑

- **docConform 改名影响面**:shell.js 内 10+ 读点,漏一处 = 编辑器错挂/gating 错。执行时全量 grep + e2e 兜底,别手数。
- **注册顺序靠 script 标签默契** = 隐性炸弹,必须单测锁 classify 优先级(U1)。
- **headerTemplate HTML 注入**:页眉/页脚是用户输入,不 escape 就是打印路径的注入面(P0 级,U5 必做+对抗用例)。
- **md 导出回归**:分页文档现在能导 md,gating 改造时容易顺手禁掉——不许。
- **宽容回退的边界**:page 块写坏回退 schema-1 后,页面设置弹窗读到的 docPageCfg=null,开关显示「未开启」——用户再开会写入干净 page 块覆盖坏块,这是期望行为,e2e 补一例。
- 旧文档兼容:存量分页文档 meta 是 `"1"` 或缺失——归类只认内容,照常认成 schema-2;下次转换/保存时 meta 才更新。零迁移成本,但执行者别加「按 meta 修文件」的批量迁移(不需要且危险)。

## 7. 总验收(全部 PR 合入后)

1. 归类矩阵四行为真(单测 + e2e 各覆盖)。
2. 现有 `e2e/paged.spec.js` 8 条原断言全绿(行为不回归)。
3. 两侧新建 modal:范式 2「分页文档」可选,新建即分页视图;范式 3 仍灰。
4. 页面设置完成流式↔分页转换,磁盘字节与归类一致。
5. 页眉/页脚:屏显每页可见、几何在边距区、导出同口径、escape 对抗用例过。
6. `docs/features/paged-doc.md`/skills/ai-guide/CLI/团队公告全部新口径,无「分页=Schema 1 版式」残留(grep 验证)。
7. Wendi 真机验收:新建分页文档流程 + 页眉页脚手感(视觉参数留调整余地)。
