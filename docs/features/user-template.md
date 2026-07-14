# 用户自定义模板（版式模板） —— 对齐 spec

> 来源：`docs/brainstorms/2026-07-14-user-defined-template-requirements.md`（Q1–Q5 已拍）+
> `docs/plans/2026-07-14-001-feat-user-template-ui-demo-plan.md`。Colin 拍板 **ui-demo-first**：
> 本 spec 现状 = ui-demo 已定稿、真 app **未移植**（欠账段列全部移植硬活）。

## 行为契约

**模板 = 版式包**：一段受管制的 CSS（决定文档长什么样）+ 可选起始内容骨架 + 元数据（名/来源/装饰色）。
应用模板 = 把 CSS **快照盖章**到文档（文档携带 CSS 拷贝，不是引用——模板事后被改不影响已盖章文档）。
渲染时把模板 CSS **作用域化**后只作用文档区、不漏 app 界面。模板分两类来源：**官方**（内置）/ **我的**（用户存为/导入）。

**CSS 安全门（fail-closed，一切进入文档或模板库的 CSS 都先过它）**：
- 禁外链 `url()`——只放行内嵌 `url(data:font/*)`（品牌字体）、`url(data:image/*)`（logo，拒 svg）。
- 禁 `@import` / `expression()` / `-moz-binding` / `behavior:`（`scroll-behavior` 等放行）。
- 禁 `position: fixed/sticky/absolute`（共享 DOM 下能盖住界面 / 点击劫持）。
- 禁 `!important`（会覆盖用户行内手调，破坏「换装保留手调」不变式）。
- 禁隐藏正文 `display:none` / `visibility:hidden`（视觉完整性最简版；`content` 注入 / 同色欺骗需真解析，见欠账）。
- at-rule 白名单：`@font-face` / `@keyframes` / `@media` / `@supports`，别的拒。
- 体积预算：软阈值给提示、硬上限整份拒。**违规整份拒绝并给人话原因，不做部分应用。**

**新建**（CreateModal）：从模板起时骨架 + 样式一起落；带 css 的模板卡片有「版式」标记。

**换装**（文档 ⋯ 菜单 → 套用/更换版式模板）：贴边侧挂画廊面板（右侧滑入，**无全屏暗幕**——文档主列在
预览时完整可见）。卡片 **hover 与键盘聚焦等价触发实时预览**（真实内容实时套，未落章）；离开/Esc 清预览；
点击落章 + **toast 撤销**（不进编辑器 Cmd+Z 栈）。「素颜（移除模板）」项仅当已有模板时出现。分组 = **官方 / 我的**
（v1 无「团队」组，随公司库挪后）。非合规文档（走基础编辑）与 `.md` 文档（头部样式不入盘）**换装入口禁用并
分别给因由**（原因常驻小字、键盘/读屏可达，不只 title）。

**手调保留不变式**：用户手动改的颜色（行内样式）换装后仍在——层叠序 baseline < 语义 CSS < 模板 < 行内手调；
demo 里靠禁 `!important` 即成立（真 app 还需语义 CSS 降权，见欠账）。

**存为模板**（⋯ 菜单 → 将当前文档存为模板…）：命名 + 「含内容骨架」勾选 + 重名提示（不静默覆盖、创建新条目）。
**v1 是派生通道**——css 取文档已应用模板的快照，素颜文档存出纯骨架模板；全新版式的自产只有 AI 生成一条路。

**模板管理页**（`/templates`）：官方 / 我的分组列表 + 详情面板（用户模板可改名 / 编辑 CSS 过门 / 导出 JSON /
删除带 toast 撤销；官方模板只读）+ 导入 JSON（过门）+ 「新建文档试用」+ 我的空态引导。**AI 生成区**：复制创作
Prompt（外部 AI 通道）→ 粘贴 AI 产出的模板 JSON 导入（过门）。

**导出/分页**：分页打印导出（`printPagedDoc`）携带模板 CSS 且容器类命中（屏显 = 导出）；分页文档换模板后
分页点正确重排（V4 回归不破）。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 数据模型（Template.css/origin、Doc.templateId/templateCss） | `ui-demo/src/types.ts` | —（欠账：入盘 `<style data-ws-template>` + Doc 关联） |
| CSS 安全门（纯函数） | `ui-demo/src/lib/templateCheck.ts` | —（欠账：生产级真 CSS 解析） |
| CSS 作用域化 | `ui-demo/src/lib/templateScope.ts` | —（欠账：生产方案另定） |
| 内置模板（含黄金标书） | `ui-demo/src/mock/seed.ts` + `lib/builtinTemplateCss.ts` | — |
| 换装/存为/CRUD 状态逻辑 | `ui-demo/src/mock/store.ts`（applyTemplate 等） | — |
| Canvas 注入 + 导出 | `ui-demo/src/components/Canvas.tsx` / `lib/printExport.ts` | — |
| 画廊 / 存为 / 管理页 / 菜单入口 | `ui-demo/src/components/TemplateGalleryModal.tsx` / `SaveTemplateModal.tsx` / `TemplatesPage.tsx` / `canvas/DocMenu.tsx` | — |
| AI 创作 Prompt | `ui-demo/src/lib/template-prompt.md` | —（将来入 skills 分发要加防漂移锁） |
| 验证门 | `ui-demo/scripts/test-template-gate.mjs`（纯逻辑+变异自检）/ `test-template-ui.mjs`（真浏览器烟测） | —（欠账：e2e + CI required check） |

## 有意分歧

- v1 分发只做本地库 + 文件导入导出；公司库（共享文件夹）/ 公共池（静态索引）/ `.md` 模板通道整体挪后
  ——Colin 2026-07-14（Q3）。
- 品牌字体允许 `data:` 内嵌、不做子集化，体积用预算管理（demo 值软 256KB / 硬 1MB，按 localStorage 配额缩放）
  ——Colin 2026-07-14（Q5）。真 app 磁盘语义原值软 5MB / 硬 20MB。
- 模板呈现心智模型 = 编辑器托管资产（对齐 schemaCheck 的 `author-style` 禁令与分页 `data-ws-schema-css` 先例）
  ——移植时对上真 app 的 `data-ws-template` 白名单。

## 对齐锚点

- ui-demo 侧：commit `4370364`（2026-07-15，U1–U5；U6 spec 本次补）
- app 侧：未移植（ui-demo-first，待 Wendi 目验定稿后按 `/align-feature` port）

## 欠账（真 app 移植硬活 + demo 阶段限制）

- **校验器**：`validateHead` 放行 `<style data-ws-template>` + **生产级 CSS 安全门**（真 CSS 解析，防
  `\75 rl(` / `url(/**/…)` 等转义/注释绕过；demo 是正则+剥注释）+ 变异自检 + e2e/CI required check。
- **视觉完整性**：`content` 文本注入 / 前景背景同色欺骗的检测需真解析（demo 只做 `display:none`/`visibility:hidden`）。
- **撤销栈**：真 app 撤销栈只快照 body；换装的「可撤销」要扩到 head，或独立「恢复上一模板」机制。
- **手调保留**：真 app 语义 CSS（todo/callout/颜色）带真实权重、块颜色手调走 class——要降权 + 迁移块颜色为受保护通道，
  否则层叠不变式不成立（demo 靠行内样式免费成立）。
- **导出/PDF**：真 app printToPDF 对应；非分页导出 demo 是 toast mock（`store.exportDoc` 无真实产物）。
- **大文档/分页预览降级**：demo 预览是全文实时套（文档小无性能问题），真 app 需降级策略。
- **体积预算**：demo 值 256KB/1MB（localStorage 配额）vs 真 app 原值 5MB/20MB；字体子集化管线是后续优化。
- **分发**：公司库（共享文件夹）/ 公共池（静态索引）/ Agent 可编程取用（模板包=磁盘可读文件，AE7）/ `.md` 模板通道
  ——origin R11/R12/R14 随 Q3 挪后。
- **AI Prompt 分发**：将来入 skills 仓分发要加三份拷贝防漂移锁（现单拷贝在 ui-demo）。
