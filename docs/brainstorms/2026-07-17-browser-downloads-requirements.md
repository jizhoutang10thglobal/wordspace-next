---
date: 2026-07-17
topic: browser-downloads
---

# 浏览器下载功能 — 需求文档

## Summary

给浏览器标签加「标准档」下载：点下载自动存进系统「下载」文件夹，工具栏出进度入口与下载列表，完成后可在访达中显示，右键菜单恢复「存储图片 / 链接另存为」。同时以调研结论定案两条相邻问题：cookies 持久化**已存在**（无需开发）；密码管理**不做**（安全边界 + 体量，见 Key Decisions）。

## Problem Frame

Wendi 反馈（2026-07-17）：「wordspace 需要浏览器下载文件功能」。

现状是**主动拒绝**：下载在 2026-07-09 被 Colin 拍板砍掉（「不做，避免臃肿」，`docs/browser-feature-spec.md` §12 砍除记录），实现为 `will-download` → 立即 `item.cancel()` + toast「不支持下载」（`src/main/web-tabs.js:50`）。用户点任何下载链接都被拒，唯一出路是把 URL 拷去外部浏览器。本需求 = 有边界地推翻该旧拍板：恢复下载的基础体验，但不引入当初担心的臃肿部分（见 Scope Boundaries）。

技术上不重：Electron 的 `DownloadItem` 是一等 API（进度 / 暂停 / 取消 / 完成事件内建），工作量集中在 UI 与细节，整体约 1–2 天量级（含门）。

## Key Decisions

- **做「标准档」，不做极简档也不做完整管理器**（Colin 拍板 2026-07-17）。三档对比后选中间档：自动落盘 + 进度 UI + 下载列表 + 完成通知 + 右键存图。极简档（只弹系统保存框）体验残缺；完整管理器（跨重启续传 / 独立下载页 / 危险文件扫描）就是当初砍下载的「臃肿」本体，维持不做。
- **推翻 2026-07-09「不做下载」拍板，spec 同步改写**。`docs/browser-feature-spec.md` 的 §12 砍除记录、§11 安全不变式第 5 条（「无下载（will-download cancel）」）、右键菜单「无下载项」备注，以及 `docs/features/browser.md` 对应欠账，都要随实现 PR 一并更新——安全不变式从「无下载」改为「下载受控」（见 Requirements 安全组）。
- **cookies / 登录态：不需要开发**。浏览器标签一直用 `persist:webtabs` 持久 session（`src/main/web-tabs.js:23`），cookies / localStorage / 登录态本就跨重启保留。「清除浏览数据」管理入口是相邻小活（半天级），本次不做（Wendi 未要求）。
- **密码保存：不做，挂起整条线**。Electron 不带 Chromium 密码管理器，自建 = 向网页注入表单探测脚本（违反现有安全铁律「web 内容零 preload」，spec §11）+ Keychain 加密存储 + 保存/填充/管理 UI，是完整产品面 + 灾难级安全责任；密码管理器浏览器扩展也装不进（Electron 扩展支持不完整）。cookies 持久化已消解「反复登录」痛点的大部分。等真实痛点再评。
- **走 ui-demo-first**（沿用 Colin 既有拍板：浏览器 feature 先在 ui-demo 定稿、Wendi 过目后移植真 app）。
- **下载记录持久保存**（对齐浏览历史的既有模式）：重启后仍能看到下过什么、跳转访达；只存元数据（文件名 / 路径 / 来源 URL / 状态 / 时间），不存文件内容。

## Requirements

**下载行为**

- R1. 网页触发下载（含 `Content-Disposition: attachment`、`<a download>`、不可渲染的资源类型）→ 自动保存到系统「下载」文件夹，不弹保存对话框。
- R2. 目标文件名重名时自动改名（uniquify，如 `报告 2.pdf`），绝不覆盖已有文件。
- R3. 下载可取消；失败（网络断 / 磁盘满）有明确的失败态，不静默消失。
- R4. 下载中退出 app：进行中的条目标记为「已中断」，不承诺续传（v1 无断点续传）。

**UI 与反馈**

- R5. 浏览器工具栏有下载入口：有活动下载时显示进度（Chrome 式），点开是下载列表。
- R6. 下载列表每条含：文件名、状态（进行中 % / 完成 / 失败 / 已取消 / 已中断）、完成条目可「在访达中显示」；文件已被用户删除的条目要能识别（置灰或标注）。
- R7. 下载完成有非阻塞通知（toast 级），不抢焦点。
- R8. 右键菜单恢复「存储图片」（图片元素上）与「链接另存为」（链接上），走同一条下载管线。

**记录持久化**

- R9. 下载记录（元数据）持久保存，跨重启可见；提供清空记录入口（只清记录不删文件）。

**安全（替代原「无下载」不变式）**

- R10. 落盘文件名做清洗（剥路径分隔符 / 控制字符，防路径穿越），保存路径锁定在下载文件夹内。
- R11. 绝不自动打开 / 执行下载完成的文件；「在访达中显示」只定位不打开。
- R12. 不引入 Safe Browsing（Electron 无此设施）；接受无危险文件云端校验的现状，不做假安全提示。

**对齐与门**

- R13. ui-demo 先行实现供 Wendi 确认形态；移植真 app 时按 `/align-feature` 流程更新 `docs/features/browser.md`（含 spec 不变式改写，见 Key Decisions）。
- R14. 新增用户可见文案全部走 i18n 双语字典（中 / 英）。
- R15. e2e 门覆盖：真实下载完成路径、取消路径、重名改名；含变异自检（按仓规范）。

## Key Flows

- F1. 正常下载
  - **Trigger:** 用户在网页标签点击下载链接。
  - **Steps:** 下载自动开始落盘「下载」文件夹 → 工具栏入口出现进度 → 完成 toast → 用户从下载列表「在访达中显示」。
  - **Covered by:** R1, R2, R5, R6, R7
- F2. 右键存图
  - **Trigger:** 图片上右键 →「存储图片」。
  - **Steps:** 走同一下载管线（进度 / 列表 / 通知同 F1）。
  - **Covered by:** R8
- F3. 失败与取消
  - **Trigger:** 用户在列表点取消，或网络中断。
  - **Steps:** 条目转「已取消 / 失败」态留在列表 → 不留半截文件（清理临时文件）。
  - **Covered by:** R3, R6

## Acceptance Examples

- AE1. **Covers:** R2 — **Given** 下载文件夹已有 `报告.pdf`，**When** 再下载同名文件，**Then** 落盘为 `报告 2.pdf`，两个文件都完好。
- AE2. **Covers:** R4 — **Given** 一个下载进行到 40%，**When** 退出 app 再启动，**Then** 列表该条目显示「已中断」，磁盘无半截可误用文件。
- AE3. **Covers:** R11 — **Given** 下载完成一个 `.dmg`，**Then** app 不自动打开它；点「在访达中显示」只高亮定位。

## Scope Boundaries

- 跨重启断点续传、独立下载页、下载搜索——完整管理器部件，维持 2026-07-09 拍板不做。
- Safe Browsing / 危险文件云端扫描——Electron 无设施，不做也不伪装。
- 密码保存整条线——挂起（见 Key Decisions）。
- 「清除浏览数据」管理入口——相邻小活，未被要求，本次不做。
- 下载位置设置项（自定义目录）——v1 锁定系统「下载」文件夹，有需求再加。

## Dependencies / Assumptions

- 浏览器标签 session 为 `persist:webtabs`（`src/main/web-tabs.js`），下载钩子挂它的 `will-download`，不碰默认 session。
- macOS 下经 Chromium 网络栈落盘的文件是否自动带 quarantine 属性——**待 plan 阶段实证**（影响「用户双击下载物时系统是否弹安全确认」的预期描述）。
- i18n 双语字典与三道防漂移门已就位（v0.10.3 起），新文案照既有流程登记。

## Outstanding Questions

**Deferred to Planning**

- 下载入口在工具栏的具体位置与样式（ui-demo 阶段和 Wendi 定稿）。
- 下载记录条数上限与裁剪策略（对齐 web-history 的既有做法即可）。
- 「已中断」条目是否提供「重新下载」快捷动作（廉价则做）。

## Sources / Research

- 现状代码：`src/main/web-tabs.js:50`（will-download cancel + toast）、`:23`（persist:webtabs）。
- 砍除记录与不变式：`docs/browser-feature-spec.md` §12（2026-07-09 砍下载）、§11 安全不变式、右键菜单「无下载项」备注；`docs/features/browser.md` 欠账表。
- Electron `session.on('will-download')` + `DownloadItem`（进度 / 取消 / 完成事件内建）——标准设施，无需第三方依赖。
- 密码管理调研结论：Electron 无内建密码管理器；注入式自建违反 spec §11「零 preload」铁律；扩展路线不可行（Electron 扩展 API 支持不完整）。
