# 协同开发规则 / CONTRIBUTING

这份文档说明 Wordspace Next 怎么协同开发——功能怎么规划、代码怎么进仓、版本怎么发、变更怎么记。Colin、Wendi、AI（Claude）都按这套来。原则：**流程轻、进度看得见、不互相挡路。**

## 一、功能规划与进度：Feature Board

要做的功能和想法，都以一个 spec 文件的形式放在 `specs/`，自动汇总成一个可视化看板。

- **看板**：https://jizhoutang10thglobal.github.io/wordspace-next/ —— 收藏它，随时看每个功能在哪个阶段、谁在做。
- 每个功能 = 一个 spec 文件，带：状态、负责人、对应 demo 的哪一块、一段约 100 字的需求说明。
- 四个状态：**想法 → 待开发 → 开发中 → 已完成**。改 spec 文件里的 `status` 就能挪动卡片。
- 谁在做什么看 `owner` 字段（colin / wendi / 留空 = 没人认领）。看板一眼看清谁在忙哪个、什么还没人接。
- 怎么写 spec、字段是什么含义 → 见 [`specs/README.md`](specs/README.md)。

> `ui-demo/` 是用来讨论前端和交互的 demo，是正式产品的**参考**，不等于产品本身（通常 demo 还领先产品一步）。产品的整体设想见 [`docs/product-vision.md`](docs/product-vision.md)。

## 二、协同方式

不搞复杂流程，进度靠 Feature Board 看就够了。

- **改动都走分支 + Pull Request**：从 `main` 开一个分支（`feat/…`、`fix/…`、`chore/…`），改完开 PR 合回 `main`。`main` 受保护，**不能直接推**。
- **CI 要绿**：PR 上的测试（单元测试 + e2e）过了才能合。
- **互相 review 不强制**：改动大或有风险的 PR，请对方看一眼；小改动可以自己合。Feature Board 和 git 历史兜底。
- **AI（Claude）走同一套**：开分支、提 PR、合并，跟人一样。

## 三、版本管理与发版

- 版本号用 semver（如 `v0.1.3`）。
- **合 PR 到 `main` ≠ 发版**：代码进了主干，用户还拿不到。
- **发版是一个有意识的动作**：由**人决定**"现在发一版"，触发可以人做、也可以**让 AI 做**——推一个 `vX.Y.Z` 的 git tag，或在 GitHub Actions 手动跑 Release workflow。触发之后，签名 / 公证 / 打包 mac+Windows / 发布 / 给已装用户推自动更新，**全自动**。
- **节奏：按需发**——攒够一个有意义的功能就发；自然的节奏是周五 sprint review demo 完、觉得 OK 就发一版。
- 一句话：**发什么、什么时候发 = 人拍板；执行 = 人或 AI 都行；之后全自动。**
- 详细步骤、护栏、前置条件 → 见 [`docs/releasing.md`](docs/releasing.md)。

## 四、变更记录（Change log）

不单独维护 `CHANGELOG.md`。每次发版，GitHub Releases 会**自动生成 release notes**，列出这一版合并了哪些 PR、什么时间——那就是变更记录，带时间轴，够用。要看历史变更，去仓库的 **Releases** 页面。

## AI（Claude）的角色

AI 能执行上面几乎所有动作：写 spec、开 PR、合并、发版、改代码。但**产品决策和发版决策由人拍板**——AI 做准备和执行，人按下决定键。
