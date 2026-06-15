# Specs / Feature Board

Wordspace Next 的功能规划在这里。Colin + Wendi 协同，每个功能模块一个 spec 文件，自动生成可视化看板。

## 怎么用

**看进度** → Feature Board（GitHub Pages 自动发布的网址，always-current；合 PR 后几十秒内更新）。
本地预览：`node specs/build-board.mjs`，然后开 `out/index.html`。

**加一条功能 / bug** → 在 `specs/` 新建 `F<编号>-<英文 slug>.md`，照下面的格式填，开 PR。合进 main 后看板自动更新。

**推进状态** → 改 spec 文件 frontmatter 的 `status`（想法→待开发→开发中→已完成），开 PR。git history 就是 changelog。

## spec 文件格式

```markdown
---
id: F04                       # 稳定短把手，standup/planning 里直接说 "做 F04"
title: 功能模块名
status: idea                  # idea(想法) | todo(待开发) | doing(开发中) | done(已完成)
phase: 1                      # 1(本地编辑器+文件) | 2(上云) | backlog(待排期)；缺省 = backlog
owner: colin                  # colin | wendi |（留空 = 未认领）
demo: demo 里对应的区域/组件名   # 指向 demo 里细化的那部分
screenshot: specs/assets/F04.png   # 截图（放 assets/），让 reference 更准；没有就先留着，看板显示占位
---

~100 字自然语言：这个功能模块是什么、给谁解决什么问题、关键行为。
详细长什么样以 demo 里那部分为准，这里不展开。

## 备注 / 决策（可选）
- 和 Colin / Wendi / AI 讨论后定的关键取舍记这里。
```

**spec 是灵活的**：上面是当前默认（~100 字 + demo 里细化的那块就够了），不是硬契约，后期会按需调整。

## 状态（看板四列）

| status | 列 | 含义 |
|---|---|---|
| `idea` | 想法 | 只有想法/标题 |
| `todo` | 待开发 | spec 写好，可被 pickup |
| `doing` | 开发中 | 有人在做 |
| `done` | 已完成 | 开发完、上线 |

## 阶段（看板分两个板块 + 一个待排期）

| phase | 板块 | 含义 |
|---|---|---|
| `1` | 第一阶段 · 本地编辑器 + 文件管理 | 把「文档/文件编辑器」做扎实，不上云 |
| `2` | 第二阶段 · 上云 | 协作、同步、发布——一上云就归这块 |
| `backlog` | 后续 · 待排期 | 愿景里有，还没排进一/二期 |

看板按 phase 分成三段，每段内再按 status 分四列。

## 约定

- **id 用 `F##` 顺序编号**，文件名 `F##-slug.md`，id 也写进 frontmatter。
- **截图放 `specs/assets/`**，frontmatter `screenshot` 写仓相对路径（如 `specs/assets/F02-publish.png`）。
- **frontmatter 里别写行内 `#` 注释**（解析器把冒号后整行当 value）。
- 看板由 `specs/build-board.mjs` 渲染（零依赖），真相源永远是这些 .md 文件，看板不手维护。
- 整套看板系统都在 `specs/` 内（含生成脚本），输出到 `out/`（已 gitignore）——故意避开 `scripts/`、`package.json`，那些一改会触发 app 签名发版。

> demo（`ui-demo/`）是讨论前端/UX 的参考，正式产品大概率不同、且 demo 通常领先产品。详见 `docs/product-vision.md`（产品愿景）。
