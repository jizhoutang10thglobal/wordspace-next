# 分页文档（paged doc）—— 对齐 spec

产品口径（Colin 2026-07-08 拍板，Wendi 确认）：分页**不是**独立 Schema，是 Schema 1 文档的可选
版式设置。真 app 入盘 = head 的 `<style data-ws-schema-css="page">` 装标准 `@page{size;margin}`
（本就在 Schema 1 head 白名单内），带且可解析 → 分页视图/分页导出；写坏了只是分页不生效，不降级。

## 行为契约

**页面设置**（文档 ⋯ 菜单 → 页面设置…）：分页开关 / 纸张 A4·A3·Letter·Legal / 纵横向 /
边距三预设（普通 25.4 · 窄 12.7 · 宽=左右 50.8mm）+ 自定义 mm 四值 / 「导出 PDF 页脚页码」开关。
弹窗开着改动即时生效。仅合规文档可用（真 app：非合规/md 禁用入口）。

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

**实现铁则**（V4 血泪，移植必守）：① 分页清理走「选择器全量扫荡」——contenteditable 回车会
分裂元素并继承 style/data-ws-pushed，按引用清理永远漏掉克隆、padding 越积越大（「空行贼大」根因）；
② 灰缝锚定「实测推挤位置」（推完量锚点画缝），不用纯几何网格反推内容；③ 扫荡→测量→重推同帧
（rAF/RO 回调在绘制前）完成，无闪烁、RO 天然收敛；④ 覆盖层坐标原点=纸 padding 盒，别抄块级
流内缝的负边距偏移（会左凸一个页边距）。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 页面模型纯逻辑 | `ui-demo/src/lib/page.ts`（paginateBlocks/computeInnerSplits/pageBoxPx） | `src/lib/schema-page.js`（worktree wordspace-next-schema2，未合） |
| 分页视图/推挤 | `ui-demo/src/components/Canvas.tsx` recalc effect + PageGap/.ws-inner-void | `src/editor/pagination.js`（旧版画线实现，需按 V4 重写） |
| 页面设置 UI | `ui-demo/src/components/PageSetupModal.tsx` | `src/renderer/shell.js` 页面设置弹窗（schema2 worktree） |
| 配置存储 | `ui-demo/src/mock/paged.ts`（localStorage per doc） | 入盘 `@page` CSS 块（文件自携带） |
| 导出 | `ui-demo/src/lib/printExport.ts` | `src/main/pdf-export.js` paged 路径 |
| 验证门 | `ui-demo/scripts/verify-paged-v4.mjs` + `test-page.mjs` + `smoke-paged.mjs` | 待建（移植时按同断言口径） |

## 有意分歧

- 配置存储：demo 存 localStorage；真 app 入盘 `@page`（HTML-native，文件自携带）——产品设计如此
  （Colin 2026-07-08）。
- 可编辑表格/代码块：demo 为测分页新建的简化块类型（2026-07-10）；真 app 的表格/代码编辑走
  Schema 1 既有块模型，能力差异不算漂移。

## 对齐锚点

- ui-demo 侧：commit `876a701`（2026-07-10，PR #151）
- app 侧：未对齐（旧实现停在 worktree `wordspace-next-schema2`，为 V4 之前的画线方案）

## 欠账

- **真 app 全量移植**：schema2 worktree 里的实现是「独立 Schema 2 + 画线」旧口径，需按本 spec
  改造（删 schema-2 descriptor、V4 推挤引擎、页面设置入口门控）后合入。宿主验证（printToPDF
  页码实测）也未做。
