---
title: "refactor: wordspace-next-demo 转正 — 仓改名 + 去 demo 化 + projectx context 移植"
type: refactor
status: completed
date: 2026-06-11
origin: docs/brainstorms/2026-06-11-wordspace-next-repo-home-requirements.md
---

# refactor: wordspace-next-demo 转正 — 仓改名 + 去 demo 化 + projectx context 移植

## Summary

把 `wordspace-next-demo` 切换为 Wordspace Next 官方主仓：GitHub 仓改名 `wordspace-next` → 仓内身份全面 rebrand（包名/productName/appId/产物名/发布配置/编排脚本 bot 身份）→ 退役 demo 徽标及其人锁 VA → 落 projectx context 文档与入口 → 作废存量迁移计划 → 以 v0.0.4 新身份发版完成端到端验证。

---

## Problem Frame

Wendi 认可 pipeline 与 v0.0.3 成果，拍板正式重新开发 Wordspace Next；brainstorm（见 origin）已决策"现仓转正、projectx 保持 PM 之家"。当前仓与 app 仍带全套 demo 身份（仓名、productName "Wordspace Demo"、appId `com.wordspace.demo`、demo 徽标、run-spec.sh 的 demo bot），且仓内躺着一份 status 为 active 的迁移旧计划会误导未来 session。趁零真实用户的窗口一次性完成身份切换，并把 projectx 的上游 context 在仓内固化。

---

## Requirements

承接 origin 的 R1–R11（编号一致，见 origin 文档）：

**仓与 app 身份**

- R1. GitHub 仓改名 `wordspace-next`，secrets / 分支保护 / Releases / 重定向保留，账号不变。
- R2. app 身份去 demo 化：productName、appId、包名、artifactName、publish 配置、dmg 标题全部切换。
- R3. 移除状态栏 `Shipped by the pipeline` 徽标（连带退役其人锁 VA，见 KTD）。
- R4. README 等现行身份自述更新；历史文档不改写。
- R5. 版本线从 v0.0.3 延续（下一版 v0.0.4）；接受已装 demo 版断更新链。

**projectx context 移植**

- R6. 新增 `docs/projectx-context.md`（产品愿景 / 关键决策 / board 与 spec 库位置用法 / 老代码参考地图）。
- R7. `AGENTS.md` 与 `CLAUDE.md` 加上游 context 入口。
- R8. agent memory 升级为"官方主仓"叙事。

**存量文档治理与 spec 流程**

- R9. `docs/plans/2026-06-08-001-refactor-pipeline-to-projectx-migration-plan.md` 标 superseded。
- R10. `docs/projectx-graduation-audit.md` 加历史背景注。
- R11. spec 流向约定固化进 R6 文档（含三类裁剪正当理由 + 显式标注义务 + 打磨期移仓方向）。

---

## Key Technical Decisions

- **appId = `com.tenthglobal.wordspace-next`**：对齐 Apple 签名主体 Tenth Global Limited；appId 一经 v0.0.4 发布即冻结——之后再改等于又一次换 app 身份、再断更新链。
- **先改仓名、后合 rebrand**：U1 完成后 `package.json` 的 `publish.repo` 直接写新仓名，避免"新配置指旧名靠重定向兜底"的过渡态。
- **徽标退役 = release-badge spec 三件套整体移出 `specs/`，不是改 `requires_va: false`**：`specs/` 的语义保持"现役 spec 目录"（va-runner / va-coverage 自动扫描的就是它）；历史副本在 `docs/demo-input/` 与 git 历史双重留存。徽标删除与 spec 退役必须同一提交，否则 va-runner 会因徽标消失判红。
- **徽标删除后的状态栏布局**：当前唯一靠右的元素是徽标（`margin-left: auto` 挂在 `#release-badge` 上），`● Edited` 脏标记此刻在左侧按钮旁。删徽标后把 `margin-left: auto` 移到 `#edit-indicator`，是**让脏标记接管右侧空位**的主动布局选择（按钮居左、脏标记居右），不是维持现状——视觉核验按新布局预期执行。
- **run-spec.sh 的 bot 身份与分支前缀一并去 demo 化**（git user "wordspace demo bot" → 正式名、`demo/` 分支前缀与 `demo()` PR 标题前缀 → `feat`）：编排产物（分支名、commit 作者、PR 标题）是对外可见身份的一部分。
- **版本线延续不清零**：v0.0.4 起为正式身份版本；不重置 tag 历史，release.yml 的 tag 推算逻辑零改动。

---

## Implementation Units

### U1. GitHub 仓改名与本地收尾

**Goal:** 仓更名为 `wordspace-next`，服务端配置全部存活，本地仓指向新地址。

**Requirements:** R1

**Dependencies:** 无（最先做）

**Files:** 无仓内文件（服务端操作 + 本地 git remote 配置）

**Approach:** 用 owner 账号执行 `gh repo rename`；改名后更新本地 remote URL（重定向虽可用，但显式更新避免依赖它）。随后逐项核验存活：分支保护（required checks e2e/test + enforce_admins）、5 个 Apple secrets、v0.0.1–v0.0.3 Releases、旧 URL 重定向。

**Test scenarios:** Test expectation: none — 服务端配置操作。

**Verification:** `gh repo view` 显示新名；`gh secret list` 数量不变；分支保护 API 返回与改名前一致；三个历史 Release 可访问；旧 URL 跳转新仓。若 rename 被 403（预期不会，owner 权限），兜底为 Colin 在 GitHub Settings 手动改名，其余核验不变。

### U2. 仓内身份 rebrand

**Goal:** 仓内一切现行身份标识切换为 Wordspace Next。

**Requirements:** R2, R4

**Dependencies:** U1（publish.repo 直接写新仓名）

**Files:**
- `package.json`（name `wordspace-next`、author、`description`（demo 自述改为官方仓自述）、productName `Wordspace Next`、appId、`publish.repo`、`mac.artifactName` `wordspace-next-${version}-${arch}.${ext}`、`dmg.title`——共八处身份字段）
- `package-lock.json`（`npm install` 再生 name 字段）
- `.devcontainer/devcontainer.json`（name）
- `README.md`（标题 + 自述从"一次性 demo 仓"转正；历史段落保留）
- `scripts/run-spec.sh`（bot git 身份、`demo/` 分支前缀 → `feat/`、PR 标题前缀 `demo()` → `feat()`；改前缀前先 grep `.github/workflows/` 确认无分支过滤器引用 `demo/`，有则同 commit 更新）
- `pm/templates/README.md`、`pm/templates/spec-intent-template.md`、`pm/templates/spec-template.md`（头部仓名 `wordspace-next-demo` → 新名；它们是现役母模板、不属历史文档豁免——其余 pm/templates 文件以 grep 审计结果为准一并处理）

**Approach:** 按 Phase 1 盘点清单逐项替换；`docs/` 历史文档一律不动（R4 边界）。productName 变更连带 macOS 菜单栏 app 名与 updater 缓存目录名变化，均只影响新装机，无需兼容处理。

**Test scenarios:**
- 全量 vitest 绿（纯身份字段变更，无行为变化——任何红都说明改动越界）。
- `git grep -i "wordspace-demo\|com.wordspace.demo"` 在非 docs/ 路径零命中；`wordspace-next-demo` 仅存于历史文档。

**Verification:** 本地 `npm test` 绿；grep 审计通过。

### U3. 徽标退役

**Goal:** 移除 demo 徽标及其整套验收物，门体系保持自洽全绿。

**Requirements:** R3

**Dependencies:** 无（可与 U2 同分支并行；与 U2 同 PR 合并）

**Files:**
- `src/renderer/index.html`（删 `span#release-badge`）
- `src/renderer/theme.css`（删除整条 `#release-badge` 规则块；`margin-left: auto` 移至 `#edit-indicator`；注意 `#doc-container > *` 上也有 `margin-left/right: auto`——那是文档排版居中规则，不许动）
- `specs/release-badge.md`、`specs/release-badge.intent.md`、`specs/release-badge.va.json`（删除前先 diff `docs/demo-input/` 同名历史副本：一致则直接删；specs/ 侧更新则先覆盖回 demo-input 再删，防删丢增量）

**Approach:** 徽标删除与 spec 三件套退役同一提交（见 KTD）。e2e 套件由 15 缩为 13（release-badge 的 va-runner 与 va-selftest 项随 va.json 消失自动退场）。

**Test scenarios:**
- 全量 vitest 绿。注意三件套必须**整批删除**：若只删 va.json 而留 md（md 内有 `requires_va: true`），va-coverage 当场判红；整批删除后 va-coverage 对 `specs/` 恢复绿。
- 宿主真 Electron e2e 13/13 绿（f14 / f46 / f40 三套 VA + 变异自检 + 手写编辑套件不受影响）。
- 状态栏视觉核验：无徽标；`● Edited` 脏标记从按钮旁移至右侧（接管原徽标位置——新布局，非现状保持）；Reset 按钮布局不变。

**Verification:** 本地全套门绿 + 状态栏截图核验。

### U4. projectx context 文档与入口

**Goal:** 任何冷启动 session（含容器内 agent）能在仓内两跳之内找到上游 context。

**Requirements:** R6, R7, R11

**Dependencies:** 无

**Files:**
- `docs/projectx-context.md`（新建）
- `AGENTS.md`（顶部加入口指针）
- `CLAUDE.md`（顶部加入口指针）

**Approach:** context 文档四块内容——① 产品愿景（HTML-native 多文档工作台、Headless AI Editor / BYOM、Copy-Prompt + REST + WS + MCP，不内置 AI）；② 关键产品决策摘录（双产品并存史、从零重写决策、三层命名"板块/功能组/功能"）；③ Feature Board 与 F## spec 库的本地位置、用法、spec 流向约定（选题自 board → 三类裁剪正当理由 + 显式标注义务 → 本仓 `specs/` 三件套 + VA 人锁 → 打磨期 spec 定稿移本仓的方向）；④ 老 wordspace 代码参考地图（什么问题去 `dev/` 哪个路径查：测试地基、useTheme/useZoom 先例、preload 边界等，取材自 graduation audit 的资产表）。projectx 为仓外本地路径，文档中写明绝对路径并标注"机器相关，路径变更需同步更新"（origin 已记此假设）。

**Test scenarios:** Test expectation: none — 纯文档。

**Verification:** 冷读测试：只给 `AGENTS.md`，能否两跳内定位 board 路径与 spec 流向规则。

### U5. 存量文档治理

**Goal:** 作废的计划在仓内自我声明作废，未来 session 不可能误执行。

**Requirements:** R9, R10

**Dependencies:** 无

**Files:**
- `docs/plans/2026-06-08-001-refactor-pipeline-to-projectx-migration-plan.md`（frontmatter `status: superseded` + 顶部注指向 origin 文档）
- `docs/projectx-graduation-audit.md`（顶部历史背景注："复用 projectx 地基"前提已被"从零重写"决策取代，留作研究存档）

**Test scenarios:** Test expectation: none — 文档标注。

**Verification:** 两文件顶部标注可见、指向正确。

### U6. agent memory 升级

**Goal:** memory 叙事从"一次性 demo 仓"切换为"Wordspace Next 官方主仓"。

**Requirements:** R8

**Dependencies:** U1–U5 完成后（按落定事实写）

**执行时机：** 仓外步骤、不入 rebrand PR、CI 验不到——在 PR 合并且 v0.0.4 发版确认后单独执行，勿因它卡 PR、也勿遗漏。

**Files:** agent memory 目录（仓外）：`MEMORY.md` 索引、`progress`、`repo-topology-projectx-demo`、`spec-flow-board-to-demo` 等节点

**Approach:** 改写身份叙事与仓名引用；projectx 关联节点同步"主仓/PM 之家"新框架；保留排障史与教训不动。

**Test scenarios:** Test expectation: none — agent 侧记忆。

**Verification:** 下个 session 冷启动时索引叙事与现实一致。

### U7. v0.0.4 新身份发版验证

**Goal:** 端到端证明改名 + rebrand 后工厂无断点，新身份产物真签名真公证。

**Requirements:** R5（兼验 origin 的 Dependencies 假设：改名不破坏流水线）

**Dependencies:** U1, U2, U3（合并 rebrand PR 自动触发 release.yml）

**Files:** 无新文件（发版动作 + 宿主核验）

**Approach:** rebrand PR 过 CI 合并 → release.yml 按 tag 推算发 v0.0.4 → 宿主下载产物核验。本版同时实战验证上一轮 release.yml 的 latest-mac.yml dmg 校验和修正步骤（首次在真发版中生效）。

**Test scenarios:**
- 产物名为 `wordspace-next-0.0.4-arm64.*`，app 显名 Wordspace Next。
- `scripts/shipping-verify.js` 对下载布局全绿（含 dmg 公证两条）。
- `latest-mac.yml` 的 dmg sha512/size 与实际文件一致（验证上轮修复）。
- 旧 Wordspace Demo.app（v0.0.3）启动后不更新到 v0.0.4（预期断链，appId 不同）——确认后删除旧 app，安装新 app（Colin 一次手动）。

**Verification:** Release 三件套齐 + shipping-verify 全绿 + 校验和比对一致 + 新 app 安装打开正常（含 S6 编辑功能）。

---

## Scope Boundaries

承接 origin：不迁流水线回 projectx、不搬老代码、不动 board、不推动 projectx 转公开、品牌视觉资产（图标）延后、wl1390 GitHub 侧权限不配。

### Deferred to Follow-Up Work

- 应用图标与品牌视觉（当前 Electron 默认图标）——单独的设计任务。
- `.claude/settings.local.json` 内残留的 demo 检索串（本地权限白名单，无碍运行）——下次顺手清。
- 下一条 feature spec（查找/替换收窄版是 v0.0.5 候选）——按 spec 流向约定另行走流程。

---

## Risks & Dependencies

- **`gh repo rename` 权限不足（403）**：预期不会（owner 账号）；兜底 Colin 在 GitHub UI 改名，单点 10 秒，其余流程不变。
- **改名后首次发版是关键验证点**：secrets / 分支保护 / required checks 理论上随仓保留（GitHub 平台行为），U7 的真实发版是唯一权威确认；若 v0.0.4 失败，按 release.yml 的失败安全设计 main 与 tag 不受污染，可修后重跑。
- **旧装机断更新链**：appId 变更使 Squirrel 视新版为另一个 app——设计内行为（origin R5），现存装机仅 Colin 一台。
- **同名仓冲突**：执行 U1 前核验 `jizhoutang10thglobal/wordspace-next` 不存在。

---

## Sources & Research

- origin：`docs/brainstorms/2026-06-11-wordspace-next-repo-home-requirements.md`（R1–R11 与全部决策依据）。
- Phase 1 身份触点盘点（2026-06-11 agent 实扫）：`package.json` 七处身份字段、`.devcontainer/devcontainer.json`、`README.md`、`scripts/run-spec.sh` 的 bot 身份 / `demo/` 分支前缀 / PR 标题前缀、`src/renderer/index.html` 徽标、`specs/release-badge.*` 三件套；`docs/solutions/` 不存在。
- `src/lib/__tests__/va-coverage.test.js` 语义（扫 `specs/*.md` 的 requires_va → 同 slug va.json 必须存在）：决定了徽标退役的正确形态是三件套移出 `specs/`。
- `docs/projectx-graduation-audit.md` 可复用资产表：U4 老代码参考地图的取材源。
