---
title: "Wendi 修改清单 UX 修复（真 app sidebar/tabs/pdf/快捷键）+ schema U1b"
type: fix
status: active
date: 2026-06-30
source: ~/Desktop/wordpace_修改清单(1).md
---

# Wendi UX 修复 plan

**来源**：Wendi 的 `wordpace_修改清单(1).md`（12 项，F3 Markdown 已由 Colin 移入 feature board 留后做、不在本 plan）。
**分支策略**：UX 项（真 app sidebar/tabs/pdf/快捷键，跟 schema 无关）在 worktree `wordspace-next-ux`（分支 `feat/ux-fixes`，基于 main）；U1b（schema 覆盖层 token）在 `wordspace-next-schema`（分支 `feat/schema-1`）。两者独立合 main。

## 现状核对结论（agent 核对 main，2026-06-30）

**已经做了、Wendi 清单信息有误或无需动的**（不做，向 Colin 说明）：
- **F5-① 保存 Cmd+S**：已绑（`main.js:74`）。
- **F9 右键菜单 + 拖拽**：右键**已有**新建文档/新建子文件夹/重命名/删除（`sidebar.js:265-270`），拖拽移动也已做（`:272-320`）。Wendi 说"只有重命名+删除"与实际不符——**无需动**。
- **F6-② 文件树展开/折叠**：已有 collapsed set 机制（`sidebar.js:24-56`）。

**留 Colin review（受限/产品判断，先不做）**：
- **B7 PDF 两行工具栏合并 / B8 PDF 默认不显示预览栏**：PDF 用 Chromium **内置** viewer（iframe src=url，`shell.js:223-226`），那"第二行"和"左侧预览栏"是浏览器 viewer 自带、app 无法直接控制。**先试 URL fragment（`#toolbar=0&navpanes=0`）能否隐藏**——能就顺手做（归 UX5），不能则需换 PDF.js（架构活）留 Colin。
- **B9 两个加号**：侧栏顶部加号与标签页区加号**功能相同**（都 `openCreateModal('')`，只是位置不同），不是冲突 bug。要不要去掉一个 = 产品判断，**留 Colin 定**。

## Implementation Units（按先后顺序执行）

### UX1. B2 — 删除侧边栏收起后的竖排图标轨（rail）
**Goal**：去掉收起态的竖排图标列表（Wendi：不需要）。收起后侧栏就是窄条/纯收起，不再渲染每个文件的图标。
**Files**：`src/renderer/index.html`（删 `#sb-rail`）、`src/renderer/shell.css`（删 `.sb-rail*`）、`src/renderer/sidebar.js`（删 `renderRail()` 定义 + 5 处调用 `:101/437/506/579/927`）、可能 `shell.js` 收起按钮逻辑。
**Verify**：收起侧栏后无竖排图标；展开恢复正常；现有 sidebar e2e 不回归。
**难易**：低（纯删除）。

### UX2. F4 — 标签页快捷键 Cmd+T / Cmd+W / Cmd+Q
**Goal**：Cmd+T 新建标签（=`openCreateModal('')`）、Cmd+W 关当前标签、Cmd+Q 退出（补 accelerator）。
**Files**：`src/main/main.js`（菜单 template 加 accelerator + sendMenu 路由）、`src/renderer/shell.js` 或 `sidebar.js`（接 menu 消息 → 调对应函数）。
**Verify**：三个快捷键各自生效（e2e 或手动）；不跟现有 Cmd+O/S/E/Z 冲突。
**难易**：低。

### UX3. F5-② — 查找文件快捷键（Cmd+F focus 筛选框）
**Goal**：Cmd+F（或 Cmd+P）唤起/聚焦 `#sb-filter-input`，可按文件名筛选定位。
**Files**：`src/renderer/sidebar.js`（keydown 监听 → focus filter input；若侧栏收起先展开）。
**Verify**：Cmd+F 后焦点落在筛选框、能输入筛选。
**难易**：低。

### UX4. F6-① — 点标签页时文件树自动展开并定位到该文件
**Goal**：`openTabRow` 时，把目标文件的所有父文件夹从 collapsed set 删掉 + render + 滚动到该文件行。
**Files**：`src/renderer/sidebar.js`（`openTabRow :591` 加 expand-to-file：拆 rel 路径逐级 `collapsed.delete` + render + scrollIntoView）。
**Verify**：点一个深层文件夹里文件的标签 → 文件树展开到它、高亮、滚到可见。
**难易**：低。

### UX5. F1 — 侧边栏宽度可拖拽（+ B7/B8 PDF URL-fragment 顺手试）
**Goal**：侧栏右边界加 resize handle，鼠标拖拽调宽（夹在 min/max），宽度存 localStorage 重启恢复。**附带**：PDF iframe src 试加 `#toolbar=0&navpanes=0` 看能否隐藏 Chromium 第二行/预览栏（能则连带做 B7/B8、不能则记录留 Colin）。
**Files**：`src/renderer/shell.css`（resize handle 样式 + 宽度用 CSS 变量）、`src/renderer/shell.js`（拖拽逻辑 + 持久化；PDF src fragment）。
**Verify**：拖拽改宽顺滑、有 min/max、重启保留；PDF fragment 真机看效果。
**难易**：中（拖拽 JS + 持久化）。

### U1b. schema 覆盖层 token（在 wordspace-next-schema / feat/schema-1）
**Goal**：修 F1（serialize 在 clone 上按属性名剥覆盖层、会误删用户自带 `data-ws2-ui` 内容）。正解 = 会话随机 token 作 `data-ws2-ui` 值（survive clone、用户静态文件伪造不了）+ 路由 ~15 个覆盖层创建点过 markUi 助手 + serialize 按 token 剥。
**Files**：`src/editor/blockedit.js`（mk + 覆盖层创建点）、`src/editor/serialize.js`（cleanRoot 按 token 剥）、`test/serialize.test.js`、`test/fidelity-roundtrip.test.js`。
**Verify**：用户带 `data-ws2-ui` 属性的内容存盘不丢；编辑器覆盖层仍被剥；275+ 单测不回归 + e2e。
**难易**：中（保真红线，仔细做）。**执行姿态**：test-first（先写"用户内容不丢"的红测试）。

## 顺序
UX1（删 rail）→ UX2（快捷键）→ UX3（查找）→ UX4（展开定位）→ UX5（拖拽 + PDF 试）→ U1b（切 schema worktree）。每个绿了就 commit。

## 不做 / 留 review（汇总给 Colin）
- F9：已完成，Wendi 信息有误，无需动。
- B7 / B8：受限 Chromium 内置 viewer，UX5 试 URL fragment；不行则需 PDF.js（留 Colin 拍）。
- B9：两加号功能相同，去不去重 = 产品判断（留 Colin）。
- F3 Markdown：Colin 已移 feature board，后做。
