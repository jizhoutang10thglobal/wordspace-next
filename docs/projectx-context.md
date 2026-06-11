# projectx 上游 context 总结

> 本仓（wordspace-next）是 Wordspace Next 的**官方代码仓**；产品思考、Feature Board、F## spec 库住在上游 **projectx** 仓（私仓，本地磁盘可读）。本文档是两边的连接器：任何冷启动 session 读完本文，应当知道产品是什么、spec 从哪来、老代码去哪查。
>
> 决策依据：`docs/brainstorms/2026-06-11-wordspace-next-repo-home-requirements.md`。
> ⚠ 本文内的 projectx 路径是**本机绝对路径**（机器相关）；projectx worktree 移动时需同步更新本文。

---

## 1. 产品愿景（Wordspace Next 是什么）

- **HTML-native 多文档工作台 / 编辑器**：文档本体就是 HTML 文件（区别于老 wordspace 的 `.wsp` JSON 私有格式）。
- **Headless AI Editor / BYOM（Bring Your Own Model）**：app 不内置 AI。通过 Copy-Prompt、REST、WebSocket、MCP 把文件操作暴露给外部 Agent（Claude Code / Cursor 等），用户用自己的模型协作编辑。
- **从零重写**（Wendi 2026-06 拍板）：不在老 wordspace 代码上继续，最简起点是"可打开 HTML 页面并编辑文字的工具"——本仓 v0.0.3 即此形态（S1 骨架 → S2 主题 → S3 渲染/源码切换 → S5 徽标+更新弹窗 → S6 基础编辑）。
- 分发方式：macOS Developer ID 直分发（签名+公证），GitHub Releases + electron-updater 自动更新，不走 App Store。

## 2. 关键产品/工程决策（为什么是现在这样）

- **双产品并存史**：老 wordspace（projectx `dev/`，`.wsp` 格式，Electron+React 19+Express 5，v0.3.0，已发版有用户）冻结为参考；wordspace-next 为新主线。
- **三层命名**（2026-05-20 起）：板块 → 功能组 → 功能（旧称"大功能模块/功能/功能细节"）。
- **本仓转正**（2026-06-11）：原 demo 仓改名转正。理由：公开仓是用户自动更新的硬前提（projectx 是私仓）；签名/发版/对抗验收工厂在本仓已多版本实证。流水线**不**迁回 projectx（旧迁移计划已作废，见 `docs/plans/2026-06-08-001-*.md` 顶部标注）。
- **验收文化**：CI 绿 ≠ 能用。可见效果由人锁 VA（`specs/<slug>.va.json`，CODEOWNERS 锁、实现 AI 不许改）+ 通用 va-runner 真开 app 判定 + va-selftest 变异自检证门有牙。教训沉淀在仓根 `CLAUDE.md` / `AGENTS.md`。

## 3. Feature Board 与 spec 流向

**位置**（本机）：
- projectx 主 worktree（PM 轨，Colin 日常）：`/Users/ctlandu/Documents/GitHub/projectx`（分支 `colin_pm-track`）
- Feature Board 看板：`projectx/pm/product/feature-showcase.html`（运行时读 `feature-list.csv`，单一源；部署版在 `feature-board-deploy/`）
- **F## spec 库**：`projectx/pm/product/specs/`（F01 多文档、F15 缩放、F26 高亮、F40 编辑、F45 焦点模式等，多数带 .intent/.gate 配套）
- 模板与 ruleset：`projectx-board/pm/templates/`（spec-ruleset.md 是规则单一源）；本仓 fork 版在 `pm/templates/`
- 注意：`projectx-board`、`projectx-dev` 是同一 git repo 的另两个 worktree；`projectx-dev`（fix/tooltip-contrast）是陈旧快照，**别当权威**。

**spec 流向约定**：
1. **选题**自 board F## 库（或与 Colin 对话产生新题）。
2. **裁剪**只允许三类正当理由——依赖 feature 未建、验收手段未建、拆分多版增量——且必须在落地 spec 中**显式标注砍了什么**，不许静默丢需求。随地基补齐，收窄递减，目标是按 board spec 原定义全量实现。
3. **落本仓** `specs/<slug>.{md,intent.md,va.json}` 三件套；frontmatter 带 `narrowed_from: F##`；VA 人写人锁（Colin 拍板冻结），实现 AI 不许改。
4. **方向**：到系统性打磨 spec 的阶段（时机 Colin 判断），spec 工程化定稿工作移到本仓，board 渐变为路线图/产品意图层。

## 4. 老 wordspace 代码参考地图（什么问题去哪查）

老代码在 `projectx/dev/`，冻结为参考。已查证的高价值入口（出处：`docs/projectx-graduation-audit.md` 资产表）：

| 要查什么 | 去哪看 |
|---|---|
| 真 app 的测试地基形态 | `dev/vitest.config.ts`（注意 include 是 `tests/**/*.test.ts`、TS-only）、`dev/tests/e2e/`（Vite baseURL + `openFile()` fixture 模式）、`dev/tests/electron-smoke/` |
| computed-style 强断言先例 | `dev/tests/e2e/doc-background-white.spec.ts`、`default-text-color.spec.ts` |
| 主题实现先例（F46 参考） | `dev/src/hooks/useTheme.ts`（data-theme on `<html>` + matchMedia） |
| 缩放实现先例（F15 参考，**与 spec 有 4 处矛盾**，是门禁强度试金石） | `dev/src/hooks/useZoom.ts`、`dev/src/components/PagedView.tsx` |
| preload/contextBridge 边界 | `dev/electron/preload.js`（sandbox no-require 约束 + PR#40 回归先例） |
| 老 spec 的松散格式（反面教材） | `dev/specs/feat-view-zoom.md` |

注意：老 app **没有** contentEditable / 多文档 / 文件树 / `.html` 文件模型（`.wsp` 硬编码 10+ 文件）——这正是从零重写的原因之一，找这些能力的实现先例要看本仓，不是老仓。
