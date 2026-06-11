---
date: 2026-06-11
topic: wordspace-next-repo-home
---

# Wordspace Next 主仓落点与身份切换 — 需求文档

## Summary

`wordspace-next-demo` 转正为 Wordspace Next 的官方主仓：仓改名 + app 全面去 demo 化一次完成；projectx 保持 PM 之家（Feature Board + spec 库），两仓靠本地磁盘读取、仓内 context 总结文档和 agent memory 连接，不搬代码、不搬流水线。

---

## Problem Frame

Wendi 已认可 demo 跑通的 AI pipeline 与 v0.0.3 成果，拍板正式重新开发 Wordspace（从零搭建，最简起点是"可打开 HTML 页面并编辑文字的工具"——demo 仓 v0.0.3 已是这个形态）。正式开发需要先回答"代码住哪"：搬回 projectx 老仓（context、Feature Board、老代码都在那），还是在现仓继续。

三个事实改变了 6/8 时的判断：① `wl1390/projectx` 是私仓，而本流水线的用户侧自动更新走 GitHub Releases，公开仓是硬前提；私仓的 macOS Actions runner 还要付费计费。② Wendi 拍板从零重写后，"把 spec 落到老 React app 上"这一迁移前提不再成立——老代码降级为参考资料。③ projectx 的 context（board、spec 库、决策文档）在本地磁盘上可直接读取，本周选题 F40 就是这么做的；"访问老内容困难"这个担忧不成立，真正受限的只是 wl1390 的 GitHub 侧操作（push/PR/CI），而正式开发不需要它们。

仓里现存一份 status 为 active 的迁移计划（`docs/plans/2026-06-08-001-refactor-pipeline-to-projectx-migration-plan.md`），其前提已失效；不在仓内作废它，未来的 session 可能照着执行。

---

## Key Decisions

- **现仓转正，不迁回 projectx。** 公开仓是自动更新的硬前提（projectx 私仓且不宜转公开）；签名/公证/发版/对抗验收门这套工厂在现仓已三个版本端到端实证；迁移按 6/8 计划自身的估算是约 800 行重写改配 + Colin 整套服务端重配，且其核心前提（落到老 app）已被"从零重写"否定。迁移是拿确定性换零收益。
- **立即全面去 demo 化。** 当前零真实用户，是断更新链代价最小的窗口；越晚改，"demo 字样混在正式产品里"积累越多、用户装机后再改 app 身份越疼。
- **projectx 保持 PM 之家，连接方式 = 读取而非搬迁。** Feature Board 与 F## spec 库继续住 projectx（Colin 与 Wendi 的工作面在那边）；老 wordspace 代码留在原地做参考，需要时从磁盘查阅。本仓内落一份 curated context 总结 + agent memory 强关联，保证任何 session 冷启动都知道去哪找上游。
- **spec 流向：近期取材 board，打磨期移到本仓。** 近期沿用现状——从 board 的 F## 库选题、按当前地基现实裁剪、拷入本仓 `specs/`。到系统性打磨 spec 的阶段（时机 Colin 判断），spec 的工程化定稿工作移到本仓，board 渐变为路线图/产品意图层。
- **spec 实现保真度递增（收窄递减）。** demo 期收窄是地基缺失的产物，不是原则。正式开发以按 board spec 原定义全量实现为目标；允许的裁剪只来自三类——依赖 feature 未建、验收手段未建、拆分为多版增量——且必须在落地 spec 中显式标注砍了什么，不许静默丢需求。
- **6/8 的 Phase B 迁移计划作废留档。** 在文档本体标注 superseded 并指向本文档，防止未来 agent 误执行。

---

## Requirements

**仓与 app 身份**

- R1. GitHub 仓改名为 `wordspace-next`（改名保留 secrets、分支保护、Releases、重定向；jizhoutang10thglobal 账号不变）。
- R2. app 身份去 demo 化：productName 改为 Wordspace Next，appId 换为正式标识，包名同步，electron-builder 的 publish 配置指向改名后的仓。
- R3. 移除状态栏 `Shipped by the pipeline` 徽标（demo 时代的视觉锚点，正式产品不带）。
- R4. README 与仓内文档的自我描述从"一次性 demo 仓"更新为"Wordspace Next 官方仓"；历史文档不改写，只更新现行身份描述。
- R5. 版本线从 v0.0.3 延续，不清零；接受已装 demo 版因 app 身份变更断自动更新链（按需手动重装一次）。

**projectx context 移植**

- R6. 新增仓内文档 `docs/projectx-context.md`：产品愿景（HTML-native、Headless AI/BYOM、Copy-Prompt/REST/WS/MCP）、关键产品决策、Feature Board 与 spec 库的位置及用法、spec 流向规则、老 wordspace 代码的参考地图（什么问题去哪个路径查）。
- R7. `AGENTS.md` 与 `CLAUDE.md` 加指向 R6 文档与 projectx 本地路径的入口，保证冷启动 session 能发现上游 context。
- R8. agent memory 升级：把"一次性 demo 仓"叙事更新为"官方主仓"，projectx 关联节点（拓扑、spec 流向、模板体系）同步改写。

**存量文档治理**

- R9. `docs/plans/2026-06-08-001-refactor-pipeline-to-projectx-migration-plan.md` 标注 superseded（status 字段 + 顶部说明指向本文档）。
- R10. `docs/projectx-graduation-audit.md` 顶部加历史背景说明：其"复用 projectx 地基"结论的前提已被"从零重写"决策取代，保留作研究存档。

**spec 流程约定**

- R11. 在 R6 文档中固化 spec 流向约定：选题自 board F## 库 → 按地基现实裁剪（裁剪三类正当理由 + 显式标注义务）→ 落本仓 `specs/`（md + intent + va.json 三件套，VA 人锁不变）；并记录"打磨期 spec 定稿工作移到本仓"的方向。

---

## Scope Boundaries

- 不把流水线迁回 projectx（6/8 计划作废）；不把老 wordspace 代码搬进本仓；不把 Feature Board 挪出 projectx；不推动 projectx 转公开。
- 身份切换 PR 不夹带功能改动——rename/rebrand 与 feature 开发分开发版。
- 应用图标等品牌视觉资产不在本次范围（当前用 Electron 默认图标，正式品牌设计延后单独做）。
- wl1390 账号的 GitHub 侧权限配置不需要也不去做（正式开发流程不依赖它）。

---

## Dependencies / Assumptions

- GitHub 仓改名保留 secrets、branch protection、Releases 并自动重定向旧 URL——GitHub 平台行为，改名后以一次真实发版验证流水线无断点。
- appId/productName 变更等同于换 app 身份：已装 demo 版不会自动更新到新身份版本；当前装机仅 Colin 一台，接受手动重装。
- projectx 三个 worktree 长期保留在本地磁盘现路径；若未来移动，R6/R7 中的路径需同步更新。

---

## Outstanding Questions

**Deferred to Planning**

- appId 的具体字符串、包名、publish 配置等改名清单的逐项落点。
- R6 文档的具体目录结构与篇幅取舍（哪些决策算"关键"值得入册）。

---

## Sources & Research

- `docs/plans/2026-06-08-001-refactor-pipeline-to-projectx-migration-plan.md` — 6/8 迁移计划（本文档将其作废）：迁移量化估算与跨账号约束的主要证据来源。
- `docs/projectx-graduation-audit.md` — 6/7 的 11-agent 毕业审计：projectx 可复用资产明细与老 app 能力缺口（无 contentEditable、.wsp 硬编码、无多文档）的实证。
- `docs/2026-06-09-shipping-status-handoff.md` — shipping 工厂端到端实证记录（v0.0.1–v0.0.3 三个版本的签名/公证/自动更新链路）。
- 实测（2026-06-11）：`gh api repos/wl1390/projectx` 返回 404（私仓证据）；projectx 本地 worktree 磁盘可读（本周 F40 选题即直接读取 `pm/product/` 的 board 与 spec 库）。
