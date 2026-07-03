---
title: "Markdown 后端进真 app：.md 打开/编辑/保存走同一个块编辑器"
type: feat
status: active
date: 2026-07-03
origin: docs/design/2026-07-02-markdown-backend.md
branch: feat/md-backend（worktree wordspace-next-align，base = main f86f6fe，含 ux-align）
---

# Markdown 后端进真 app · 实现计划

## 问题框架

app 现在只认 `.html`。设计文档已定架构：**编辑器/校验器格式无关，格式只活在磁盘 IO 两端**——
加 markdown = 主进程读盘处插 `md→html`、写盘处插 `html→md`，中间全链路不动。
本 plan 把它落成可执行单元，并修正设计文档的一个漏洞（见 KD-1）。

## 需求追溯（origin + Colin 2026-07-03 拍板）

- R1 工作区里的 `.md` 能点开进**同一个块编辑器**，改完保存**写回 .md**（不是变成 html）。（origin TL;DR）
- R2 **MVP 只做打开已有 .md**：新建文档仍产 .html（模板台/临时文档不动）；新建选格式、跨格式另存为留下一轮。（Colin 拍板①）
- R3 **非合规 .md 同 html**：降级基础编辑、可改可存，保存写回规范化 md。（Colin 拍板②）
- R4 表现层走 **HTML 岛**（方案 b）；**默认开 GFM**；规范化可接受、序列化风格选项固定。（origin 决策 1/2/3）
- R5 「AI 改不出错」链路对 .md 同样成立：转换产物过校验器分流，HTML 岛不绕过校验。（origin 决策 4）

## 关键决策

- **KD-1｜修正设计文档「renderer 零改动」**：校验吃 `read-doc` 返回的字符串没错，但**渲染是 iframe
  `file://` 直载磁盘文件**（`shell.js:559 loadFromFile`）——`.md` 直载会被 Chromium 当纯文本渲染。
  正解：`.md` 走**已有的 `loadFromHtml`（srcdoc，`shell.js:445`）**渲染 `read-doc` 转换好的 HTML，
  `<base>`（dirUrl）注入已是现成机制、相对图片照常解析。`reloadDoc`（外部改动重载，`:379`）同理。
  renderer 改动 ≈ openDoc/reloadDoc 两处小分支 + kind 分流三处，其余不动。
- **KD-2｜kind 引入 `'md'` 而非并进 `'html'`**：`kindOf`（`src/lib/file-tree.js:9`）加 `case 'md'`。
  kind 同时服务图标/标签/查看器分流，混进 'html' 会丢掉「这是 md」的信息（将来树上要标）。代价 =
  renderer 三个 `kind === 'html'` 判定点改成「可编辑文档」判定：`shell.js:621`（打开按钮分流）、
  `sidebar.js:355`（树节点 openNode）、`sidebar.js:747`（外部标签 openTabRow）。
- **KD-3｜适配器 = 主进程独立纯模块 `src/main/md-adapter.js`**，unified 生态（origin 选型）：
  load `remark-parse + remark-gfm + remark-rehype(allowDangerousHtml) + rehype-raw + rehype-stringify`；
  save `rehype-parse + rehype-remark + remark-gfm + remark-stringify`（风格选项写死：`bullet:'-'`、
  `emphasis:'*'`、`strong:'*'`、`fence:'`'`\`）。**unified 是 ESM-only、主进程是 CJS → 适配器内
  `await import()` 动态加载 + 模块级缓存**（Node CJS 动态载 ESM 是官方路径）。
  `mdToHtml` 产**完整 HTML 文档**（doctype + charset + `wordspace-schema` meta + `<title>`=文件名去扩展名
  + body=转换产物）——校验器/`loadFromHtml` 都吃完整文档；`htmlToMd` 只转 body 内容（head 是载入时再生的，
  不进 .md）。
- **KD-4｜`assertHtmlPath` → `assertDocPath`（放行 `.md`）**，逐调用点核对（都在 `src/main/ipc.js`）：
  read-doc:89 ✓、save-doc:99 ✓、watch-doc:117 ✓（外部改动监听对 md 同样要）、path-info:125 ✓
  （md 要 name/dirUrl 给面包屑和 `<base>`）、export-pdf:131 ✓（见 KD-5）。`htmlPathFromArgv`
  （Finder 双击关联）**不动**——.md 文件关联不在 MVP。
- **KD-5｜.md 的导出 PDF 只走 wordspace 模式**：raw 模式=直印源文件，对 .md 会印出裸 markdown 文本。
  非合规文档现在走 `exportPdf(basicEdit ? 'raw' : 'wordspace')`——**md 文档一律强制 'wordspace'**
  （烤的是渲染后的 contentDocument，与格式无关、天然正确）。
- **KD-6｜另存为保持原格式**：`ws-save-doc-as`（ipc.js:208）现在写死 `.html`（leaf 拼接、filter、
  尾缀补齐三处）。加 `ext` 参数（'html'|'md'），md 文档另存为默认 `.md` + markdown filter + 写盘前
  `htmlToMd`。跨格式转换不做（R2）。
- **KD-7｜历史归档存原始 md 字节**：save-doc 的 `history.archive` 读的是磁盘 prev 字节（改动前的 .md）——
  天然正确，不用动；历史恢复（`loadFromHtml(html)`）恢复的是 md 的历史？——历史读回来的是 **md 字节**，
  恢复进编辑器前要过 `mdToHtml`。核对 `historyRead` 的 renderer 消费点，若 UI 未接（v0.2.1 删了历史 UI）
  则只记录、不做。

## Implementation Units

### U1 — `src/main/md-adapter.js` + 依赖 + 单测（地基，纯逻辑）

**Goal**：`mdToHtml(md, {title}) → 完整 HTML 文档字符串`；`htmlToMd(html) → md 字符串`；ESM 动态加载缓存。
**Files**：新建 `src/main/md-adapter.js`；`package.json` deps 加 unified 生态包；新建 `test/md-adapter.test.js`。
**Approach**：KD-3。适配器不碰 fs/ipc（纯字符串进出，node:test 可直测）。
**Patterns**：纯逻辑模块先例 `src/lib/tabs.js`（双导出不需要——主进程专用，CJS module.exports 即可）。
**Test scenarios**（node:test，async）：
- 干净映射往返：标题/段落/加粗斜体删除线行内代码链接/无序有序/GFM 任务列表(`- [x]`)/GFM 表格/引用/分隔线/围栏代码 → mdToHtml → htmlToMd 语义不变（关键行内容断言，不逐字节）。
- HTML 岛保真：md 含 `<mark>`/`<span style="color:…">`/`<u>`/`<div class="ws-callout">` → html 里原样出现 → 转回 md 原样保留。
- **转换产物过校验器**：合规样例 md 的 mdToHtml 产物 `validate(JSDOM(html))` conform=true（R5，接 `src/lib/schema-validate.js`）。
- 危险 md：内嵌 `<script>` 的 md → html 里保留（rehype-raw 直通）→ 校验器判 **不合规**（降级路径的输入正确性，不是 sanitize——分流靠校验器）。
- 风格固定：`* 项` 输入 → 存回 `- 项`（规范化断言）。
- 完整文档形态：doctype/charset/schema meta/title 都在。
**Verification**：`node --test test/md-adapter.test.js` 全绿；**打包态动态 import 可用性在 U4 e2e 真 Electron 里验**（ESM-in-asar 是本 plan 头号执行风险，见「风险」）。

### U2 — 主进程接线：ipc.js 分流 + 另存为格式

**Goal**：`.md` 路径全链路放行 + 读写两端转换；另存为保持格式。
**Files**：`src/main/ipc.js`（assertDocPath + read-doc/save-doc 分流 + ws-save-doc-as 加 ext）；`src/lib/file-tree.js`（kindOf 加 md）。
**Approach**：KD-4/KD-6/KD-7。`const isMd = /\.md$/i.test(p)`；read-doc: UTF-8 校验后 `return isMd ? await mdToHtml(text, {title: basename}) : text`；save-doc: 写盘前 `content = isMd ? await htmlToMd(content) : content`（archive 在转换前读 prev 原始字节，顺序不变）。
**Test scenarios**（扩 `test/`，jsdom 不需要、fs 层走既有 files.* 测试风格）：assertDocPath 放行 .md/.html 拒别的；save-doc 对 .md 落盘的是 md 字节（开头不是 `<!doctype`）。
**Verification**：`npm test` 全绿。

### U3 — renderer 接线：md 渲染分支 + kind 分流

**Goal**：树/标签/打开按钮点 `.md` → 编辑器打开（合规块编辑 / 非合规基础编辑）→ 保存/外部重载/导出都对。
**Files**：`src/renderer/shell.js`（openDoc:539 附近 + reloadDoc:379 + pickAndOpen:621 + exportPdf 模式）；`src/renderer/sidebar.js`（:355、:747）。
**Approach**：KD-1/KD-2/KD-5。openDoc：readDoc 已经拿到（转换后）内容 → `isMdPath(p) ? loadFromHtml(content) : loadFromFile()`（loadFromHtml 需要 docInfo.dirUrl——path-info 已放行）；routeDoc 判定输入本来就是 readDoc 返回值、不用动。reloadDoc 同分支。saveAs 传 ext。
**Test scenarios**：由 U4 e2e 承担（renderer 逻辑 jsdom 测不了 iframe）。
**Verification**：`node --check` + U4。

### U4 — e2e 真门（真 Electron）

**Goal**：端到端证明「.md 在真 app 里 = 一等公民文档」+ 打包关键风险（ESM 动态 import）在真 Electron 主进程里过。
**Files**：新建 `e2e/markdown.spec.js`（骨架抄 `e2e/tabs.spec.js`：WS2_FOLDER_IN seed + launch + afterEach destroy）。
**Test scenarios**：
- seed 一份合规 `笔记.md`（标题/粗体/任务列表/表格/callout HTML 岛）→ 树里点开 → 块编辑器出现（`frameLocator('h1')` 文本对、**无降级条**）→ 面包屑名对。
- 编辑（打字）→ Cmd+S → **磁盘字节以 `# `/md 语法开头、不含 `<!doctype`**（后端真是 md）→ 哨兵内容在 → 重开内容一致（round-trip）。
- 非合规 `野生.md`（内嵌 `<script>` HTML 岛）→ 打开走**基础编辑**（降级条可见）→ 改一处保存 → 磁盘仍是 md 且 script 岛保留。
- 外部改动 .md（fs 写入）→ doc-changed → 自动重载新内容（watch 链路对 md 生效）。
- 另存为（WS2_SAVE_AS_OUT seam 指向 `.md` 路径）→ 落盘是 md。
- 回归哨兵：打开 .html 文档保存 → 磁盘仍是 html（分流没串）。
**Verification**：宿主 `npx playwright test e2e/markdown.spec.js` 全绿 + 全套 e2e 无回归 + CI 绿。

### U5 — 文档收尾

**Goal**：origin 设计文档修正 KD-1（「renderer 零改动」→「近零：md 走 srcdoc 渲染」）+ 状态改 implemented。
**Files**：`docs/design/2026-07-02-markdown-backend.md`。

## 顺序 / 依赖

U1（纯逻辑，可独立验）→ U2（依赖 U1）→ U3（依赖 U2）→ U4（依赖全部）→ U5。单分支串行，不并发。

## 风险

- **⚠ 头号：unified(ESM) 在打包 Electron 主进程里的动态 import**。dev 态 Node CJS→ESM 动态 import 是官方支持；
  打包后 asar 里 ESM 解析在 Electron 28+ 支持但有坑面。缓解：U1 先 dev 态实证；U4 e2e 真 Electron 过；
  若 asar 内碰壁 → 备选①逐包降到仍发 CJS 的旧版本线，②`asarUnpack` unified 相关包，③换 `markdown-it`(CJS)
  + `turndown`(CJS) 组合（API 面小、需要多写几条自定义规则）。执行时按此序降级，不回头改架构。
- 大 md 文件转换在主进程同步链路上的耗时——MVP 不优化（文档尺寸场景小），read-doc 本来就是 async handler。
- `pdf-export` 的临时打印文件写在源文件同目录（`.html` 临时文件挨着 `.md` 源）——已确认 exportPdfFromHtml
  吃 html 字符串 + dirname，与源格式无关，不用动。

## Scope Boundaries（非目标）

- 新建文档选 md / 模板出 md 版 / 跨格式另存为（R2，下一轮）。
- `.md` 的 Finder 文件关联 / 双击打开（htmlPathFromArgv 不动）。
- 历史版本 UI（本就未接 UI；归档字节正确即可，KD-7）。
- ui-demo 任何改动；frontmatter(YAML) 解析、Obsidian 方言（wikilink 等）不支持——标准 CommonMark+GFM。

## Deferred to Implementation

- unified 各包的具体版本锁定（执行时按 ESM 风险实测定）。
- `htmlToMd` 对编辑器序列化产物里 `data-checked` 任务列表的映射细节（remark-gfm 的 checkbox 语法对接）。
- 树上 `.md` 图标要不要与 html 区分（有 `sb-kind-md` class 钩子即可，视觉后定）。
