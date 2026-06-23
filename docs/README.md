# docs — 什么放哪

Wordspace Next 的文档地图。新文档不知道往哪放时，先看这张表。

| 位置 | 放什么 |
|---|---|
| [`../specs/`](../specs/) | **功能详细文档**：每个功能模块一个 `F##-slug.md`（~100 字 + 指向 demo + 决策「备注」段）。看板本身在 [Notion](https://www.notion.so/76c6444b609944a4a9619eed6472fcdf)（想法 / 待开发 / 开发中 / 已完成，拖卡片管状态），卡片用「规格链接」指向这些 `.md`。新功能在 Notion 建卡片；要写详细 spec 就在这开 `F##`。 |
| [`product-vision.md`](product-vision.md) | **canonical 产品愿景**（Wendi 写）。北极星，讲清楚 Wordspace 是什么。 |
| [`design/`](design/) | **长篇产品 / 技术设计文档**，一个主题一篇（如本地正本 ↔ 实时协作、AI 产出的结构约束、导出保真、浏览器实现深度）。技术决策先写进对应设计文档；真出现跨文档的大决策再拆 ADR。详见 [`design/README.md`](design/README.md)。 |
| [`releasing.md`](releasing.md) | 怎么发版（打 tag / 手动触发）。 |
| [`apple-developer-setup-walkthrough.md`](apple-developer-setup-walkthrough.md) | 签名 / 公证的 5 个 GitHub secret 怎么配。 |
| [`shipping-verification-checklist.md`](shipping-verification-checklist.md) | 发版后在宿主验签名 / 公证 / staple + 自动更新的清单。 |
| [`plans/`](plans/) | 实现计划（`ce-plan` 产出，回答「怎么建」）。 |
| [`../ui-demo/`](../ui-demo/) | Wendi 的可运行前端 / UX **demo**。讨论参考，**领先于正式产品，≠ 正式实现**。 |

## demo 的讨论 / UI-UX 设计 / 待改清单 放哪

- **功能级**的（某个功能要做 / 要改 / bug）→ 进 `specs/`：开或改一条 `F##`，状态走 想法 → 待开发，关键取舍写进该 spec 的「备注」段。
- **demo 本身**的样子（前端 / UI / UX）→ 以 `ui-demo/` 为准（它就是用来讨论这个的）。
- 真有**独立成篇**的设计讨论（跨功能、需要长篇展开）→ 进 `docs/design/`。
