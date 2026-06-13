---
title: "feat: 移植 Wendi 的 wordspace2 块编辑器为 Wordspace Next 新版本"
type: feat
status: active
date: 2026-06-13
---

# feat: 移植 Wendi 的 wordspace2 块编辑器为 Wordspace Next 新版本

## Summary

把 Wendi 自做的 `wordspace2`（一个 Notion-like 本地 HTML 块编辑器，技术栈与本仓几乎一致）的源码搬进 `wordspace-next` 仓，替换 S1–S6 的查看器/编辑器 UI 成为新主体，接上本仓的签名+公证+自动更新发布工厂，升 Electron 到 42，作为下一个签名发布版本（v0.0.4 装机可自动更新过去）。

---

## Problem Frame

公司正式文档（价值观、人才模型、招聘材料）是 HTML、外观由统一模板控、内容只能靠 Claude 改，Wendi 没法自己上手。她 vibe code 了 `wordspace2` 解决这件事：本地 Mac app，像 Notion 一样原地编辑任意 HTML、未编辑部分逐字不破坏。代码 TDD 做的、质量扎实、运行时零外部依赖，且已验证了本仓 v0.0.5 计划赌的命门假设（`iframe sandbox="allow-same-origin"` 无 allow-scripts + 父页操作 contentDocument + 保存剥离编辑器注入物再序列化）。

Colin 拍板：复现她的 app 作为下一个版本，走路线 A——搬她的代码进本仓改造、接发版工厂、能下载和自动更新。本计划取代 `docs/plans/2026-06-12-001-feat-open-edit-save-iframe-foundation-plan.md`（v0.0.5 iframe 自研计划，范围是本方向的子集，搁置）。

她的范围（搬入内容）：iframe 文档模型 + contenteditable 原地编辑、纯文本粘贴、浮动格式工具栏（粗/斜/下划线/删除线/颜色/高亮，走 `execCommand`）、斜杠菜单（标题/正文/列表/分隔线）、拖动手柄排序、锁定块（表格/图片/未知结构原样保留、可移动可删、不可编辑、悬停提示）、快照式统一撤销栈、Cmd+S 写回原文件、每文件 20 版自动历史、最近文档、未保存关窗拦截、保真序列化（剥离 `data-ws2*` 标记）。

---

## Key Technical Decisions

- KTD1. **她的 `src/` 成为新主体，替换 S1–S6 的 renderer/lib/specs/e2e；保留本仓发布基建。** 删/换：`src/`（整套换她的）、`specs/`（她无 VA）、`e2e/`（换她的）、`vitest.config.js`（她用 node:test）。保留不动：`.github/workflows/`、`build-resources/`、`scripts/{shipping-verify,notarize-dmg,host-verify}.js`、`.devcontainer/`、`docs/`、`pm/`。后果：主题切换/渲染源码切换/内置文档查看等 S1–S6 UI 退场（她的产品里没有；它们是 demo 阶段踏脚石）。VA 体系（va-eval/va-runner/va-selftest）暂留仓内、不接新 app，后续清理另议。
- KTD2. **身份沿用本仓、自动更新链不断。** appId 仍 `com.tenthglobal.wordspace-next`、productName 仍 Wordspace Next、仓不变；**版本号 v0.1.0**（Colin 拍板——配完整块编辑器的范围跃迁；release.yml 需加手动版本口子支持 minor bump，见 U5）。**不**用她的 `local.wordspace2`/不签名配置。
- KTD3. **升 Electron 到 42**（她代码原样跑、execCommand/iframe 行为在 42 验过）；electron-builder 保留本仓签名公证配置。风险=签名公证构建要在 42 上重验（U1/U3）。
- KTD4. **验收 = 她的 node:test + playwright + 本仓宿主真验。** 她的单测/e2e 在 CI 跑绿 + 宿主真开 app 肉眼验 + `shipping-verify` 签名公证真验 + v0.0.4→新版自动更新实证。**不套 VA 人锁**（VA 防"实现 AI 从 spec 写弱断言"，这次代码 Wendi 写好、不存在该风险）。
- KTD5. **CSP 优先收紧。** 她为 srcdoc 文档样式生效把宿主 CSP 放成 `default-src * 'unsafe-inline'`（撞 S4 红线）。优先改为真实 `file://`/自定义协议加载文档（让文档有自己 CSP 上下文、宿主 CSP 不放开）；实测不成则退回她的 srcdoc+放开法并在 CLAUDE.md 记录取舍（她已证可行，是安全网）。
- KTD6. **只搬代码、不搬内部资料。** 不搬：她的设计文档/实施计划、`dist/` 构建产物、e2e 里公司真实文件名引用（价值观/候选人报告/PKU 等）。e2e 用通用 fixture HTML 替真实文件。

---

## Implementation Units

### U1. 开分支 + 搬码 + 升 Electron 42 + 跑通她的单测

**Goal:** 她的 `src/`+`test/`+`e2e/` 进本仓新分支，Electron 升 42，她的 node:test 全绿——验证搬码基础可行。

**Requirements:** KTD1, KTD3, KTD6

**Dependencies:** 无

**Files:**
- `src/`（删本仓现有、置入她的 `src/main/*`、`src/renderer/*`、`src/editor/*`）
- `test/`（置入她的 `test/*.test.js`：files/recents/history/blocks/serialize/undo）
- `e2e/`（置入她的 `e2e/*.spec.js`，剔除公司真实文件名→通用 fixture）
- `e2e/fixtures/`（新建通用样例 HTML：含 inline `<style>`/相对资源/`<script>`/表格/未知色块）
- `package.json`（Electron `^42`、`test`=`node --test`、`test:e2e`=playwright；删 vitest）
- `playwright.config.js`（用她的或与本仓合并）
- 删除：`src/lib/*`、`src/assets/builtin-doc.html`、`specs/`、`vitest.config.js`、旧 `e2e/*`、S1–S6 的 `src/renderer/*`

**Approach:** 她运行时零外部依赖，搬码无依赖冲突。`npm install` 拉 Electron 42。她的 node:test 用 jsdom 测纯逻辑（files/history/blocks/serialize/undo），与 Electron 解耦，应直接绿。e2e fixture 去掉公司真实文件名。

**Test scenarios:**
- 她的 6 份 node:test 全绿（files 安全写盘、recents 去重上限、history 归档剪枝防遍历、blocks 分类、serialize 保真剥离、undo 快照栈）。
- `npm start` 在 Electron 42 下窗口正常起、首页显示。

**Verification:** `npm test` 绿；`npm start` 起得来。

### U2. main.js 集成发布基建

**Goal:** 把本仓的 electron-updater + 显式更新弹窗 + e2e userData 隔离合进她的 main.js，不破坏她的菜单/IPC/open-file。

**Requirements:** KTD2, KTD4

**Dependencies:** U1

**Files:**
- `src/main/main.js`（合并：她的 Menu/registerIpc/open-file 协议 + 本仓 `app.isPackaged` 惰性接 electron-updater + `update-downloaded` 显式弹窗 + `WSND_USER_DATA` 覆盖 userData）
- `src/lib/update-prompt.js`（从 S6 保留的纯模块搬回——dialog 选项/shouldInstall；唯一从旧 src/lib 保留的文件）
- `src/lib/__tests__/update-prompt.test.js`（其单测，转 node:test 或保留）
- `package.json`（加 `electron-updater` 依赖）

**Approach:** electron-updater 惰性 require、仅 `app.isPackaged`（沿用 v0.0.2 接线）；`update-downloaded`→`dialog.showMessageBox`→`quitAndInstall`（沿用 v0.0.2 显式弹窗）；`WSND_USER_DATA` 隔离供 e2e。她 main.js 的 `window-all-closed→app.quit` 与未保存拦截（在 renderer beforeunload）保留。

**Test scenarios:**
- update-prompt 单测绿（版本号入文案、shouldInstall 判定）。
- 集成：packaged 守卫下 dev 模式不接 updater、不报错；e2e 启动用临时 userData。

**Verification:** `npm test` 绿；dev `npm start` 无 updater 报错。

### U3. 身份与签名公证打包配置

**Goal:** electron-builder 用本仓签名公证配置 + 她的 fileAssociations + 本仓身份，能在 Electron 42 上打出签名公证产物。

**Requirements:** KTD2, KTD3

**Dependencies:** U1

**Files:**
- `package.json` 或 `electron-builder.yml`（appId `com.tenthglobal.wordspace-next`、productName Wordspace Next、本仓 mac 签名公证块 hardenedRuntime/entitlements/notarize/dmg.sign、`afterAllArtifactBuild` notarize-dmg 钩子、她的 `.html/.htm` fileAssociations、publish 指 wordspace-next、artifactName）
- 统一打包配置位置（本仓用 package.json.build，她用 electron-builder.yml——合并到 package.json.build）

**Approach:** 以本仓 package.json.build 为底（签名公证已验证），并入她的 fileAssociations（注册 .html/.htm 编辑器）。去掉她的 `identity:null`/`target:dir`。

**Test scenarios:** Test expectation: none — 打包配置，正确性由 U6 真发版验证；本地可 `--dir` dry-run 出 .app 冒烟。

**Verification:** 本地 unsigned `--dir` 打出 .app 能起；配置静态审查无 demo 残留身份。

### U4. CSP 收紧尝试

**Goal:** 优先用真实 file:// 加载文档替 srcdoc，让宿主 CSP 不放开；不成则退回并记录。

**Requirements:** KTD5

**Dependencies:** U1

**Files:**
- `src/renderer/index.html`（CSP）、`src/renderer/shell.js`（`frame.srcdoc=html` → 真实 file:// 或自定义协议加载；`injectBase` 随之调整）

**Approach:** 试方案：iframe `src` 指文件真实 `file://` URL（文档有自己 CSP 上下文、相对资源天然解析、无需放开宿主 CSP、无需注 base）；编辑仍走父页操作 contentDocument。验：① 文件样式生效 ② 文档脚本不执行（sandbox 无 allow-scripts）③ 父页可脚本化 contentDocument（跨目录 file://，本仓 v0.0.5 plan 标注的同源风险点——她 srcdoc 路线规避了它，真实 file:// 要实测）。③ 失败则退回她的 srcdoc+放开 CSP，在 CLAUDE.md 记录"为 srcdoc 文档样式必须放开宿主 CSP"的取舍与边界。

**Test scenarios:**
- e2e：打开带 inline `<style>`+相对 CSS 的 fixture → 样式生效；带 `<script>`/`onerror` → 不执行；编辑→保存→脚本原样保留。
- 收紧成功则宿主 CSP 不含 `default-src *`；退回则 CLAUDE.md 有记录。

**Verification:** 文档保真渲染 + JS 不执行的 e2e 绿；CSP 取舍落定且有据。

### U5. CI / release 流水线适配

**Goal:** ci.yml 跑她的 node:test + xvfb playwright；release.yml 支持本版版本号。

**Requirements:** KTD2, KTD4

**Dependencies:** U1, U3

**Files:**
- `.github/workflows/ci.yml`（test job 跑 `node --test`；e2e job xvfb + playwright，Electron 42 二进制）
- `.github/workflows/release.yml`（版本号：若发 v0.1.0 需放开 minor bump 或手动指定——加 `workflow_dispatch` 版本入参或调推算；沿用签名公证+tag+softprops）

**Approach:** ci.yml 把 vitest 换 node:test；e2e job 保留 xvfb+`--no-sandbox`（Electron 42 同理）。release.yml 版本推算当前只 patch+1；若定 v0.1.0，加手动版本入口（dispatch input 优先于 tag 推算）。

**Test scenarios:** Test expectation: none — CI 配置，正确性由 PR CI 跑绿 + U6 真发版验证。

**Verification:** PR 上 ci.yml test+e2e 绿。

### U6. 发版 + 宿主验证 + 自动更新实证

**Goal:** 合并触发 release.yml 出新版本，宿主验真产物，实证 v0.0.4→新版自动更新。

**Requirements:** KTD2, KTD3, KTD4

**Dependencies:** U2, U3, U4, U5

**Files:** 无（发版动作 + 宿主核验）

**Approach:** PR 过 CI 合并 → release.yml 签名公证发版 → 宿主 `shipping-verify` 验签名公证（含 dmg）→ 打开已装 v0.0.4 看自动更新到新版（显式弹窗第二次实战）→ 装新版真编辑一份 HTML 验功能。

**Test scenarios:**
- `shipping-verify` 对下载产物全绿（codesign/spctl/stapler + dmg 公证）。
- 宿主真开新 app：打开一份 HTML、编辑文字、斜杠菜单转标题、拖块、Cmd+S 写回、历史版本恢复、未保存关窗拦截——逐项肉眼过。
- v0.0.4 装机 → 检测新版 → 弹窗 → 立即重启 → 变新版。

**Verification:** Release 三件套齐 + shipping-verify 全绿 + 自动更新实证 + 功能肉眼过。

---

## Scope Boundaries

- 不搬她的内部资料（设计/实施文档、公司真实文件名、dist 产物）。
- S1–S6 的 UI 功能（主题切换/渲染源码切换/内置文档查看）随替换退场；VA 体系暂留仓内不接新 app。
- 她标注的 v1 不做项照搬（全局版式改、表格/图片内容编辑、协作云同步、Windows/浏览器、文档脚本运行）。

### Deferred to Follow-Up Work

- 她的"第二版候选"（表格编辑、插图、callout、TG 预设色板）——后续 spec。
- `execCommand` 是 deprecated API（长期技术债，本轮原样接受她的实现，未来重写编辑命令层另议）。
- 退役 VA 体系/run-spec.sh/docs/demo-input 等 demo 阶段基建的清理——单独 chore。
- 版本号若定 v0.1.0，release.yml 的 minor-bump 支持长期化。

---

## Risks & Dependencies

| 风险 | 缓解 |
|---|---|
| Electron 33→42 跨 9 版，签名公证/electron-builder 在 42 上踩坑 | U1 先升级跑通她的测试 + 本地 `--dir` 冒烟；U3 配置就位后 U6 真发版是权威验证；失败按 release.yml 失败安全（无 tag/Release、main 不动）修后重跑。 |
| CSP 收紧（真实 file://）跨目录父页脚本化失败 | KTD5 退回她已验证的 srcdoc+放开法（安全网），记录取舍；不阻塞发版。 |
| 版本号 minor bump 要改 release.yml 推算 | U5 加手动版本入口；或先按 v0.0.5 patch 走、v0.1.0 留 follow-up。 |
| 搬码删掉 S1–S6 是大改动 | 旧代码在 git 历史可寻回；新分支操作，main 不受影响直到合并。 |
| `execCommand` deprecated | 本轮接受（她已验可用）；列入 follow-up。 |
| 把 Wendi 代码发上公开仓 | 只搬 src 代码、剔内部资料（KTD6）；Colin 为 owner 已授权复现。 |

依赖：发版走现有签名/公证/自动更新工厂；v0.0.4 装机经显式更新弹窗升到新版。

---

## Sources & Research

- Wendi 的 `wordspace2`（本地 `~/Desktop/wordspace2.zip`，已解压审阅）：`设计文档.md`（产品意图+v1 范围+验收）、`实施计划.md`（15 Task TDD 全代码）、`src/`（main/renderer/editor 三层 vanilla JS，运行时零依赖）、`electron-builder.yml`、`package.json`（Electron 42）。
- 本仓发布基建（已多版本实证）：`.github/workflows/{ci,release}.yml`、`build-resources/entitlements.mac.plist`、`scripts/{shipping-verify,notarize-dmg}.js`、`src/lib/update-prompt.js`（S6 显式更新弹窗）、`src/main.js`（autoUpdater + WSND_USER_DATA 接线）。
- 取代 `docs/plans/2026-06-12-001-feat-open-edit-save-iframe-foundation-plan.md` 及其 brainstorm（v0.0.5 自研 iframe，被本方向超集取代）。
