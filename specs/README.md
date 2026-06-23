# Specs / 功能详细文档

Wordspace Next 的功能规划。Colin + Wendi 协同。

> **看板在 Notion**：[Wordspace · Feature Board](https://www.notion.so/76c6444b609944a4a9619eed6472fcdf)。
> 状态 / 阶段 / 负责人在那儿管，拖卡片即改——那是看板的**真相源**。
> 原 GitHub Pages 看板（github.io）已退役。

这个目录 `specs/` 留作每个功能的**详细 spec 正文**：devs 要看一个功能到底是什么、关键取舍是什么，就读这里的 `F##-slug.md`。Notion 每张卡片的「规格链接」指向对应的 `.md`。

## 怎么用

**看进度 / 推进状态** → 去 [Notion 看板](https://www.notion.so/76c6444b609944a4a9619eed6472fcdf)。新功能 = 新建一张卡片，拖到对应的状态列（想法→待开发→开发中→已完成），填阶段、负责人。

**写 / 改一个功能的详细 spec** → 在 `specs/` 建或改 `F<编号>-<英文 slug>.md`，开 PR 合 main。然后把 Notion 那张卡片的「规格链接」指到这个文件。git history 就是这些详细文档的 changelog。

## spec 文件格式

```markdown
---
id: F04                       # 稳定短把手，standup/planning 里直接说 "做 F04"，要跟 Notion 卡片「编号」对上
title: 功能模块名
demo: demo 里对应的区域/组件名   # 指向 demo 里细化的那部分（可选）
screenshot: specs/assets/F04.png   # 截图（放 assets/），让 reference 更准（可选）
---

~100 字自然语言：这个功能模块是什么、给谁解决什么问题、关键行为。
详细长什么样以 demo 里那部分为准，这里不展开。

## 备注 / 决策（可选）
- 和 Colin / Wendi / AI 讨论后定的关键取舍记这里。
```

**spec 是灵活的**：上面是当前默认（~100 字 + demo 里细化的那块就够了），不是硬契约，后期会按需调整。

> **状态 / 阶段 / 负责人不再写在 frontmatter 里**——这些是看板状态，归 Notion 管。现存老 spec 文件里可能还留着 `status / phase / owner` 字段，那是迁移前的遗留，**以 Notion 为准**，别再依赖它们（后续会清掉）。

## 约定

- **id 用 `F##` 顺序编号**，文件名 `F##-slug.md`，id 也写进 frontmatter，跟 Notion 卡片「编号」对应。
- **截图放 `specs/assets/`**，frontmatter `screenshot` 写仓相对路径（如 `specs/assets/F02-publish.png`）。
- 这个目录刻意避开 `scripts/`、`package.json`——那些一改会触发 app 签名发版，改 spec 文档不该牵动发版。

> demo（`ui-demo/`）是讨论前端/UX 的参考，正式产品大概率不同、且 demo 通常领先产品。详见 `docs/product-vision.md`（产品愿景）。
