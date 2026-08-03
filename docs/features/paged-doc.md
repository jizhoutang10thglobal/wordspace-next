# 分页文档（paged doc）—— 对齐 spec

**产品口径（Colin 2026-07-23 拍板，覆盖 2026-07-08 旧口径）：分页文档 = 独立 Schema 2「分页文档」**
（Word 向，后续承载页眉/页脚/纸张等强分页功能）；Schema 1 =「流式文档」（类 Notion，不分页）。
这**反转**了 2026-07-08 的「分页 = Schema 1 可选版式」定案（回到最初的 Schema 2 构想）。拆分计划见
`docs/plans/2026-07-23-001-refactor-schema-2-paged-split-plan.md`，分 PR-A..E 落地；**V4 分页引擎与页面
设置实现全部保留，只动身份/路由层**。

真 app 入盘不变 = head 的 `<style data-ws-schema-css="page">` 装标准 `@page{size;margin}`（在 Schema head
白名单内）。**归类只认内容**（不看 `<meta wordspace-schema>` 自称，校验器三铁律①）：

| 磁盘文档 | 归类 | 行为 |
|---|---|---|
| 结构合规 + head 首个 page 块可解析 | **schema-2** | 完整块编辑 + V4 分页引擎 |
| 结构合规 + 无 page 块 | schema-1 | 完整块编辑，流式 |
| 结构合规 + page 块写坏/多余块 | schema-1（宽容回退） | 流式打开，分页不生效，**不降级不惩罚** |
| 结构不合规 | null | 基础编辑降级 |

身份收口在 `src/lib/schema-registry.js`（descriptor 注册表，schema-2 注册在 schema-1 兜底之前 = 归类
优先级）+ 被动 descriptor `src/lib/schema-2-paged.js`（detect: head 有 page 块；validate: 结构合规 +
首个 page 块 parsePageCss 非 null）。`shell.js` 的 `routeDoc` 走 `classify()` 得 `docSchemaId`。
**转换 = 内容变更**：页面设置开关写入/移除 page 块即在 schema-1 ↔ schema-2 间转换（PR-A 已让开关
同步 `docSchemaId`；页面设置入口对流式/分页两种 schema 都开放 = 双向转换）。**新建入口**：新建弹窗
范式轨的「分页文档」范式（= 原范式 2 解灰，PR-B 已做）→ 选它给「空白分页文档」模板（head 带 `@page`
块 + `meta wordspace-schema=2`，新建即分页视图、磁盘 schema-2），见 `docs/features/new-document-modal.md`。
页眉/页脚 + 分页专属 meta 的关分页保留语义 PR-C 已做（见下）；ui-demo 同步在 PR-D。

> PR-A/B/C 已落。分页的**用户可感知的既有行为完全不变**（每页一张纸/页界留白/导出分页/可导 md 全保留）；
> 新增：新建入口范式轨「分页文档」、页面设置页眉/页脚。ui-demo 同步待 PR-D。

## 行为契约

**页面设置**（文档 ⋯ 菜单 → 页面设置…）：分页开关 / 纸张 A4·A3·Letter·Legal / 纵横向 /
边距三预设（普通 25.4 · 窄 12.7 · 宽=左右 50.8mm）+ 自定义 mm 四值 / 「导出 PDF 页脚页码」开关 /
**页眉文字 / 页脚文字**（各一行文本框，maxlength 200，空=不显示）。弹窗开着改动即时生效。仅合规文档
可用（真 app：非合规/md 禁用入口）。开关本质 = 流式 ↔ 分页文档转换（写入/移除 page 块 + 同步 docSchemaId）。

**分页专属 meta 的关分页保留**：`ws-page-numbers` / `ws-page-header` / `ws-page-footer` 三个 meta，**转回
流式（关分页）时一律保留**（Word 直觉：再开分页设置全回来）；分页开着时按输入写/删（空=删该 meta）。
三兄弟保留行为一致（这是对旧「关分页删 ws-page-numbers」的有意小改）。

**页眉/页脚**（PR-C，首个 Word 强分页功能）：纯文本，入盘 = head `meta[name="ws-page-header"]` /
`ws-page-footer`（head 白名单放行 meta[name]，两 schema conform 不受影响）。
- **屏显**：分页覆盖层在**每页**纸顶/纸底边距区画一行（居左小字灰，单行 ellipsis，不侵内容、不入盘
  ——在 `data-ws2-ui` 覆盖层内随 strip 整删）。源=meta，`textContent` 天然转义。
- **导出**：printToPDF `displayHeaderFooter` + headerTemplate（页眉居左）/ footerTemplate（页脚文字居左
  + 页码居中共存）。屏显与导出同口径（同 `clampHF` 截断）。
- **安全（P0）**：页眉/页脚是用户输入，进 headerTemplate/footerTemplate 前必 `escapeHtml`（`buildHfTemplates`
  纯逻辑里做，node 单测证转义真发生）；覆盖层走 `textContent`；输入框 maxlength 200 + 读取侧 `clampHF`
  防御性截断。
- **视觉参数待 Wendi 真机验收**：字号 / 垂直位置系数（现 marginTop×0.42 / marginBottom×0.58）/ 居左 vs
  居中 / 与页码共存排布，都可调。

**分页视图**：页外灰底、每页一张独立白纸（方角+1px 细边+一层淡阴影，纸方墨圆、禁叠纸）；
页与页之间 24px 灰缝含「第 N 页」mono chip。**每页物理高严格 = 一张纸**（A4 竖 = 1122.5px @96dpi）。
- **块级分页**（主力）：块放不下整块推下页，块间插流内间隔（= 上页剩余留白 + 页底边距 + 灰缝 +
  下页顶边距），永不劈块。恰好填满不切。空/短文档也显示完整一张纸（末页补白，扣除文末 chrome）。
- **超高块（单块 > 一页内容高）带留白分页（V4）**：沿块内安全边界切——列表=li、代码=行、表格=tr
  ——在切点「真推内容」（li/代码行加 runtime paddingTop；表格插不进数据的 spacer 行），页界处
  完整呈现「页底留白+灰缝+页顶留白」，代码块灰底/表格边框在页界断开（留白遮罩盖住）。
  不可切的叶子（单张超页高图）整块跨页拉长，不劈图、无缝穿图。
- **编辑与分页共存（硬要求）**：任何块（含表格单元格/代码行/列表项）开分页下可直接编辑，
  编辑后分页即时重排且每页仍=一张纸；点进超高块不改变页数（不合并）；页间空白/页底留白可点、
  光标路由到最近块。分页产物（paddingTop/spacer）**绝不进持久化数据**（strip-on-persist）。
- 无空格长串（URL/长单词）在编辑列内折行（分页/非分页全局），不横向顶破纸面；pre 用 pre-wrap。
- **没有手动分页符**（Colin 2026-07-09 拍板删除；将来要加是新决策）。

**导出**：分页开启时导出走标准 `@page{size;margin}` 分页（demo=window.print 打印预览；
真 app=printToPDF preferCSSPageSize），块 `break-inside:avoid` 与屏显同口径；页码
`@bottom-center counter(page)`（demo）/ footerTemplate（真 app）。

**标准化排版层**（ui-demo v1，2026-07-24，U1–U7；真 app 移植 = 欠账）：分页文档在文档区上方有一条
**排版工具栏**（预设下拉 / 中西文字体 / 字号 / 行距 / 对齐 / ⚙），配合 ⚙「页面设置」三分区弹窗
（页面 / 排版 / 标题）。需求见 `docs/brainstorms/2026-07-24-schema-2-paged-standards-requirements.md`、
计划见 `docs/plans/2026-07-24-002-feat-schema-2-paged-typography-plan.md`（已过 ce-doc-review）。
- **五个具名标准预设**：国标公文 GB/T 9704-2012（硬值：A4 / 上37下35左28右26mm / 仿宋三号16pt /
  固定行距29pt(版心225mm÷22行) / 首行缩进2字符 / 两端对齐 / H1小标宋二号居中·H2黑体·H3楷体·H4仿宋加粗）/
  学术论文 / 商务 / APA / MLA。选预设一键设全套；改任意旋钮脱离预设（显示「自定义·基于X」，靠 `deriveActivePreset`
  值反推 + tie-break）；可另存为自定义预设（重名拒绝防覆盖）。
- **分层数据模型（KTD1）**：`PageConfig`（纯 @page 几何）不动，新建 `TypographyConfig`（正文 body +
  标题 h1–h4）与之并列存储。中西文分设 = 一个 font-family 串「西文名… 中文名… 末尾唯一泛型」——泛型
  混在中间会把 CJK 字符截胡到系统衬线（评审实证的假字体 bug），**务必只在末尾出现一次**。字号号↔pt
  双显；mm/inch **恒存 mm 只换显示**（无往返累积误差）。
- **应用机制（KTD6）**：排版经 scoped `<style>` 注入 article（`.ws-doc-paged .ws-p` / `.ws-h1..4` **类级
  特异性**盖过 base 硬编字号/行距——article inline 继承压不过低层显式声明，这是评审抓的 correctness 硬伤）；
  typography 变 → recalc 联动即时重排、每页仍严格=一张纸（最高风险联动点，Playwright computed-style 门验）。
- **H4**：ui-demo 块模型本期加了第 4 级标题（heading level `1|2|3`→`1|2|3|4`，Colin 拍板），渲染 `<h4 class=ws-h4>`。

**实现铁则**（V4 血泪，移植必守）：① 分页清理走「选择器全量扫荡」——contenteditable 回车会
分裂元素并继承 style/data-ws-pushed，按引用清理永远漏掉克隆、padding 越积越大（「空行贼大」根因）；
② 灰缝锚定「实测推挤位置」（推完量锚点画缝），不用纯几何网格反推内容；③ 扫荡→测量→重推同帧
（rAF/RO 回调在绘制前）完成，无闪烁、RO 天然收敛；④ 覆盖层坐标原点=纸 padding 盒，别抄块级
流内缝的负边距偏移（会左凸一个页边距）。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 页面模型纯逻辑 | `ui-demo/src/lib/page.ts`（paginateBlocks/computeInnerSplits/pageBoxPx） | `src/lib/schema-page.js`（含 paginateBlocks/computeInnerSplits 逐行移植 + canonical @page build/parse） |
| 分页视图/推挤 | `ui-demo/src/components/Canvas.tsx` recalc effect + PageGap/.ws-inner-void | `src/editor/pagination.js`（V4 重写版；旧画线 V3 已删） |
| 页面设置 UI | `ui-demo/src/components/PageSetupModal.tsx` | `src/renderer/shell.js` openPageSetupModal（改动即时生效）+ `src/renderer/index.html` ⋯ 菜单入口 |
| 配置存储 | `ui-demo/src/mock/paged.ts`（localStorage per doc） | 入盘 `@page` CSS 块（文件自携带）+ 页码开关 `meta[name="ws-page-numbers"]` |
| strip-on-persist | `Canvas.tsx` serializeClean | `src/editor/serialize.js` cleanRoot（[data-ws-pushed] 剥样式；spacer 带 OVERLAY sentinel 整删）+ `shell.js` buildWordspacePrintHtml 同款剥除 |
| 导出 | `ui-demo/src/lib/printExport.ts` | `src/main/pdf-export.js` paged 路径（preferCSSPageSize + footerTemplate）+ `schema-page.js` PAGED_PRINT_CSS 烤进打印 HTML |
| 验证门 | `ui-demo/scripts/verify-paged-v4.mjs` + `test-page.mjs` + `smoke-paged.mjs` | `e2e/paged.spec.js`（同断言口径：页高统一/真空带/编辑稳定/磁盘零污染/关分页还原）+ `test/schema-page.test.js` + `test/serialize.test.js` strip 断言 |
| **标准化排版模型/预设** | `ui-demo/src/lib/typography.ts`（TypographyConfig / 五预设 / composeFontFamily / deriveActivePreset / buildTypographyCss） | 欠账（移植 = 排版入盘 `data-ws-schema-css="type"` + 校验白名单扩展） |
| **排版存储** | `ui-demo/src/mock/typography.ts`（useTypography / useCustomPresets / applyPreset，localStorage 分层）+ `mock/paged.ts` prune | 欠账 |
| **排版工具栏** | `ui-demo/src/components/TypographyToolbar.tsx`（原生 select/input+datalist，含 ARIA） | 欠账 |
| **排版门** | `ui-demo/scripts/verify-typography.mjs`（Playwright computed-style）+ `test-typography.mjs` + `test-typography-store.mjs`（node） | 欠账 |

## 有意分歧

- 配置存储：demo 存 localStorage；真 app 入盘 `@page`（HTML-native，文件自携带）——产品设计如此
  （Colin 2026-07-08）。
- 可编辑表格/代码块：demo 为测分页新建的简化块类型（2026-07-10）；真 app 的表格/代码编辑走
  Schema 1 既有块模型，能力差异不算漂移。**且 Schema 1 目前没有代码块类型**（`body>pre` 不在
  TOP_BLOCKS → 非合规 → 根本进不了分页）：真 app 引擎已按「pre 沿逻辑行（\n/`<br>`）切 +
  display:block spacer span 推挤」预留实现，待 Schema 收编代码块后激活验证（2026-07-12）。
- 块级页界的实现机制：demo 在块间插流内 PageGap spacer；真 app 给开新页的块加运行时 marginTop
  推挤 + 覆盖层画缝（真 app 的块是裸元素，流内兄弟节点会搅乱 blockedit 的兄弟遍历与 margin
  折叠账）。用户可感知行为一致（每页一张纸、页界留白结构、页码 chip、可点），不算漂移（2026-07-12）。
- 空/短文档末页补白：demo 扣除文末 chrome（ws-canvas-tail 等）；真 app 无文末 chrome，
  body min-height = 页数×(纸高+缝)−缝 直接给足（2026-07-12）。

## 对齐锚点

- ui-demo 侧：commit `876a701`（2026-07-10，PR #151）
- app 侧：commit `e97ea60`（2026-07-12，PR #164 合 main）

## 欠账

- ~~**真 app 全量移植**：schema2 worktree 里的实现是「独立 Schema 2 + 画线」旧口径，需按本 spec
  改造（删 schema-2 descriptor、V4 推挤引擎、页面设置入口门控）后合入。~~
  ✅ 已完成（`feat/paged-doc-app`，2026-07-12）：分页收编为 Schema 1 可选版式（无 schema-2
  descriptor）、V4 推挤引擎按 iframe 架构重写、页面设置门控（非合规/md 禁用）、strip-on-persist
  进 cleanRoot（变异自检验证过门有牙）、e2e 真门 5 条全绿。
- **宿主验证（printToPDF 页码实测）未做**——代码路径已通（preferCSSPageSize + footerTemplate），
  真开 app 导出 PDF 看页码/分页位置由 Colin 宿主实测。
- 页间空白点击的光标路由：app 侧统一路由到「上方最近块」末尾（合成块内点击，复用 blockedit
  enterEdit 全套判定）；demo routeCaretFromGap 的按点击位置就近选上/下块语义未逐一对齐。
- **标准化排版层真 app 移植**（2026-07-24 起，ui-demo U1–U7 已合）：工具栏 + 五预设 + 分层排版模型 +
  H4 块 + mm/inch + 另存预设都在 ui-demo；真 app align 时排版入盘 = 第二个 `data-ws-schema-css="type"` 块 +
  Schema 校验白名单扩展（origin RISK-2），真 app Schema 本就封顶 h4、H4 天然对得上。字体是系统替身
  （无仿宋_GB2312 等，视觉≈非逐字节国标；真合规可能得内嵌字体，RISK-B）。
- **ui-demo 页眉/页脚未做**：真 app PR-C 已有页眉页脚，但 ui-demo `PageConfig` 无 header/footer 字段——加它
  要动 `page.ts` + Canvas 每页覆盖层渲染 + 转义（类似真 app PR-C 独立一块），本期 defer。
- **ui-demo paged Playwright 门 harness stale**：`verify-paged-v4.mjs` / `smoke-paged.mjs` 的 `openDocPaged`
  用 ⋯-菜单导航，当前 main 上失效（`verify-typography.mjs` 已改用 seed localStorage 绕过、稳）；这两门
  跑前需修 harness（本期已 npm-script 化，未修导航）。
