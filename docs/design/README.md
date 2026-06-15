# docs/design — 产品 / 技术设计文档

放**长篇**的产品 / 技术设计文档，一个主题一篇（比 `specs/` 里那 ~100 字的功能 spec 更深、更长）。

## 什么进这里

- 子系统 / 架构怎么设计、怎么工作。比如 [`../product-vision.md`](../product-vision.md) 第 9 节列的几个硬挑战：本地正本 ↔ 实时协作的协调、AI 产出 HTML 的结构约束、导出 docx/pptx/pdf 的保真、浏览器层做多深。
- 某个功能模块下、需要长篇展开的技术 / 产品设计。

## 什么不进这里

- 功能级的需求 / 待办 / 看板 → [`../../specs/`](../../specs/)（开 `F##`）。
- 产品整体愿景 → [`../product-vision.md`](../product-vision.md)。
- 怎么发版 / 怎么配签名 → [`../releasing.md`](../releasing.md)、[`../apple-developer-setup-walkthrough.md`](../apple-developer-setup-walkthrough.md)。
- 实现计划 → [`../plans/`](../plans/)。

## 技术决策（ADR）

先把决策写进对应的设计文档里：**背景 → 有哪些选项 → 选了什么 → 为什么 → 后果**。
等出现**跨多个文档、值得单独追溯**的大决策时，再开 `docs/decisions/` 用编号 ADR（`0001-xxx.md`）记录——现在先不预建空文件夹。

## 命名

`<主题-slug>.md`，如 `realtime-sync.md`、`export-fidelity.md`。
