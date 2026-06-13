---
date: 2026-06-12
topic: v005-open-edit-save
---

# v0.0.5 打开 / 编辑 / 保存 + iframe 文档地基 — 需求文档

## Summary

v0.0.5 把文档地基从"app 页面内的 div"换成 **iframe 真网页模型**（所见即所得：文件自身 CSS/头部/相对资源按浏览器语义生效，JS 编辑态不执行但内容保留），并打通单文档文件闭环：菜单 / ⌘O / 拖拽打开 `.html` → 既有编辑能力作用于文件 → 防抖自动保存写回磁盘（退出/换文档前强制 flush），打开时原始字节快照兜底。

---

## Problem Frame

Colin 与 Wendi 定下本周目标：打开 HTML、编辑、保存三件套成为可演示功能。编辑已有（S6），但只能编辑内置文档：没有打开真实文件的入口，持久化是 localStorage 权宜。

保存选型上游已有定论——board F40 既定约束"即时落盘"，auto-save 在产品架构主线内；本轮在既定 autosave 方向上补"真实文件被手抖覆盖"的安全网。保真上 Colin 拍板"打开就是浏览器里的样子"：div 模型给不了（文件 CSS 与 app 界面互相污染），换 iframe 文档模型，同时把产品向"文档=真网页"推进一步；代价是 S1–S6 的编辑接线与验收体系整体迁移。

---

## Key Decisions

- **保存 = 自动保存 + 原始字节快照安全网。** 编辑后防抖写回；**退出 app / 打开新文件 / 窗口关闭前强制 flush 防抖窗口内的待写编辑**（"始终已落盘"由 flush 保证，崩溃路径的窗口内丢失为接受边界）。⌘S = 立即 flush（不引入手动保存模型）。
- **"编辑过"的定义**：实际变更文档内容的输入事件（点击/选区/聚焦不算）。编辑后撤销回原状**仍算编辑过**（文件已经历规范化写回，接受此代价）。未编辑过的文件绝不写回；未编辑状态下 Reset 为 no-op、不产生磁盘写。
- **快照 = 打开时的原始字节、仅本次会话有效。** Reset 写回原始字节（字节级恢复打开时状态）。崩溃或重开后快照失效、Reset 不可用——跨会话版本史归后续（macOS Versions 路数另案）。快照驻内存或 app 数据目录，文件关闭/app 退出即清。
- **内置文档 carve-out**：内置文档的持久化目标恒为 localStorage（S6 行为），任何路径**不得写 app bundle 内资源**（签名 app 写 bundle = 破坏签名 + 砸自动更新）。
- **iframe 文档模型一步到位**，不走 body-only 过渡；JS 编辑态不执行（全执行向量，见 R2），`<script>` 内容原样保留写回；"真跑起来"的预览模式另案。
- **未编辑绝不写回 / 字节保真不承诺**：parse→serialize 必有规范化；首次编辑即整文件规范化（git 用户会看到全文 diff——演示时主动说明）。
- **主题只管 app 外壳**，文档观感归文件；**单写者假设**：文件打开期间本 app 是唯一写者（外部同时修改会被 autosave 覆盖，接受为本轮边界，REST/MCP 里程碑将打破此假设需重审）。
- **三份现役人锁 VA 语义等价重冻结**（AI 起草、Colin 拍板）；f40/f46 为发版必要，**f14 重冻结尽力但不堵发版**。

---

## Requirements

**文档地基**

- R1. 文档（含内置）在内嵌 iframe 按浏览器语义渲染：文件自身 `<head>`/`<style>`/相对路径子资源生效。保真承诺范围收窄为**不依赖 JS 渲染的文档**（依赖 JS 的页面观感残缺属预期，见 R2）。
- R2. 文档 JS 编辑态经**任何向量**均不执行：`<script>`、内联事件属性（onerror/onclick 等）、`javascript:` URL 等；内容一律原样保留、随保存原样写回。**iframe 内容不得触达父窗口的 `window.api` / 任何 IPC 面**（信任边界为需求，机制归 planning）。
- R3. S6 既有编辑能力在新地基继续成立（点击定位/敲删/选择/纯文本粘贴/原生撤销）。

**打开**

- R4. 入口：File > Open… 菜单、⌘O（选择器限 `.html`/`.htm`）、拖文件进窗口；打开替换当前文档。替换前先 flush 旧文档待写编辑（R15）。
- R5. 拖拽边界：拖文件 = 打开，拖文本 = 编辑动作；拖拽悬停时给可见的"释放以打开"指示。**非 `.html`/`.htm` 文件（含目录）拖入：显式拒绝 + 状态栏提示，当前文档不变、绝不写该文件**；打开失败（文件不存在/无权限）同样保现场 + 状态栏提示。

**保存**

- R6. 编辑后防抖自动保存：序列化整文档写回**原文件**（doctype/head/script 结构保留）。内置文档除外（→ localStorage，见 Key Decisions carve-out）。
- R7. 未编辑过的文件绝不写回（"编辑过"定义见 Key Decisions；含只浏览即关、未编辑点 Reset 等路径零字节变动）。
- R8. 打开时留**原始字节**快照（会话内有效）；已编辑后 Reset = 恢复显示并把原始字节写回磁盘；未编辑时 Reset 为 no-op。
- R9. 保存失败（磁盘只读/文件被移走等）：状态栏显式持续报错（至下次成功保存清除），编辑内容不丢、可继续编辑重试。
- R15. **flush 时机**：app 退出、打开新文件、窗口关闭前，若存在防抖窗口内未落盘编辑，先同步 flush；⌘S 触发立即 flush。

**状态反馈与衔接**

- R10. 状态栏显示当前文件 **basename**（完整路径悬停提示；内置文档显固定标识）；保存反馈 Saving… → **Saved 持续显示至下次编辑**（持续态保证 VA 可强断言，不做转瞬瞬态）。
- R11. 内置文档保留 localStorage 草稿（S6 不变）；打开真文件后持久化目标切为磁盘文件、互不污染；重开 app 回内置文档——**预期行为非数据丢失**（真文件已 flush 落盘，Finder 可寻回；会话恢复归 F05）。
- R12. 主题切换只作用于 app 外壳；文档观感由文件自身决定。
- R16. Reset 按钮文案随语义更新（如 Revert）；对真实文件无确认弹窗（有快照兜底），此为有意决定。

**验收体系迁移**

- R13. VA 采集基建 frame-aware（采集器穿透 iframe 取 computed style/textContent，含 `e2e/helpers.js` snapshot 改造——此为 R14 的技术前置）；变异自检在新模型下照常证门有牙。
- R14. f40/f46 两份 VA 语义等价重冻结为发版必要；f14 尽力同轮、不堵发版。v0.0.5 新功能（打开/保存可见效果）配新 VA，人锁。f46 重冻结需专门验证：新模型下仍存在 app 侧可构造的破坏使门翻红（防退化为恒真断言）。

---

## Acceptance Examples

- AE1. 打开文件只浏览（含点击/选区）→ 关闭/重开 → 零字节变化。
- AE2. 文件自带 `<style>` 与相对 CSS → 渲染等同浏览器；切暗色主题 → 外壳变暗、文档观感不变。
- AE3. 敲字停顿超防抖窗口 → 磁盘含该编辑；状态栏 Saving… → Saved（持续至下次编辑）。
- AE4. 文件含 `<script>alert(1)</script>` **及内联 `onerror` 处理器** → 均不执行；保存后两者原样保留。
- AE5. 拖 `.html` 进窗口 → 打开；拖 `.md`/目录进窗口 → 拒绝提示、现场不变；文档内拖文本 → 移动文本不触发打开。
- AE6. 编辑过的文件点 Reset → 文档与磁盘均回到打开时**原始字节**。
- AE7. 磁盘只读时自动保存 → 持续报错显示、编辑内容保留。
- AE8. 敲字后立即 ⌘Q（或立即打开另一文件）→ 该编辑已 flush 落盘，不丢。
- AE9. 编辑真文件 → 关 app → 重启 → 显示内置文档及其旧草稿（互不污染）→ 重开该文件 → 已存编辑可见。

---

## Scope Boundaries

- 最近文件 / 重启恢复 → F05；多文档 → F01；JS 执行 / 预览模式 → 另案；另存为 / 导出 → 不做；字节级保真 → 不承诺。
- **文件 watch / 外部修改冲突处理 → 不做，并显式接受**：打开期间外部修改会被 autosave 静默覆盖、快照不保护外部修改（单写者假设，见 Key Decisions）。
- 跨会话快照/版本史 → 不做（会话内快照的边界已在 Key Decisions 接受）。
- 文档内允许外部 `http(s)` 子资源加载（浏览器同等行为；打开文件即可能产生外联请求的隐私面已知悉接受，REST/MCP 里程碑重审）。

---

## Dependencies / Assumptions

- 所选 iframe 加载机制必须让 app 代码可脚本化文档 frame（preload/window.api 不进子 frame；Chromium 默认下 file:// 文档间互为跨源）——planning 的硬约束。
- **srcdoc 路线已知不可行**：srcdoc 继承宿主 CSP（`default-src 'self'` 会拦文件 inline `<style>`，即 S4 假绿根因）且 base URL 不指向文件目录，与 R1 冲突；候选收窄为真实 URL / 自定义协议族。
- 假设打开文件为 UTF-8；非 UTF-8（meta charset 非 UTF-8）的读写一致性本轮不承诺。
- 符号链接按解析后真实路径读写（macOS 编辑器惯例）。
- 单文档模型；体量估算 **2–3 倍于 S6**（含地基迁移 + VA 基建改造 + 三入口 + 写回原子性）。
- 发版走现有工厂；v0.0.4 装机经显式弹窗更新到 v0.0.5（弹窗第二次实战出场）。

---

## Outstanding Questions

**Deferred to Planning**

- iframe 禁执行与文件加载机制（sandbox 组合 / 自定义协议；在上述同源与 CSP 约束内选型）；建议先做最小 spike 实证 contenteditable 在禁脚本 frame 内可用（"教训要实证"纪律）。
- 防抖窗口取值（建议 1–3s 区间内定）与写回原子性（临时文件+rename；失败并入 R9 报错路径）。
- frame-aware 采集实现形态；快照存放点；localStorage 草稿在 iframe 模型下的存取点。

---

## Sources & Research

- board F40 既定约束"即时落盘" + graduation audit 架构主线含 auto-save —— 保存选型上游依据；老 wordspace `dev/electron/main.cjs` 的 before-quit flush 先例 —— R15 的实证出处。
- `specs/f40-basic-editing.md`（S6）—— 既有编辑与 localStorage 权宜现状。
- 业界先例：TinyMCE/CKEditor iframe 编辑模式；macOS TextEdit/Pages autosave + Versions（跨会话版本史为另案参照）。
- 本文档经 7-persona 对抗审查（coherence/feasibility/product/design/security/scope/adversarial），修订已并入。
