# 交接：macOS shipping pipeline 现状 + 下一步（2026-06-09）

> 给下一个 session/AI 冷读用，也给 Colin 隔一天回来快速接手。
> **一句话：pipeline 真跑通了——v0.0.1 已签名+公证+发布并实证过；剩「自动更新实证」+ 两个小瑕疵。**
> 配套：`docs/macos-shipping-pipeline-brief.md`（本周任务背景）、`docs/shipping-verification-checklist.md`（真验清单）。

---

## ✅ 已证实跑通（不是「CI 绿」，是手动验真产物）

**release.yml（tag 版本制版）首次真跑成功**，产出 **v0.0.1**：
https://github.com/jizhoutang10thglobal/wordspace-next-demo/releases/tag/v0.0.1

宿主手动验证（codesign/spctl/stapler 对**下载下来**的产物，权威）：
- `.app` 签名 = **Developer ID Application: Tenth Global Limited (Q59NV4356M)** ✓
- Gatekeeper `spctl --assess`：**accepted, source=Notarized Developer ID** ✓
- 公证票 `stapler validate`：**The validate action worked!** ✓
- Release 三件套齐：`wordspace-demo-0.0.1-arm64.dmg` + `.zip` + `latest-mac.yml` ✓
- release run 全 success：gate(vitest+e2e)→签名→公证→建 Release。

**实战证实的关键假设**：「tag 创建绕过 main 分支保护」成立（Create Release 步没 403）。这是 tag 版本制重构的命门，过了。

---

## 🔑 自动更新：现状（Colin 专门问的）

目标 = feature ship 后自动上线，**用户在 app 内自动更新/下载，不用去官网重下**。

- **硬前提已具备**：macOS 自动更新（Squirrel.Mac）强制要 app 签名——这是以前一直坏的根因（老 wordspace 没签名，mac 自动更新根本不生效）。**现在 .app 真签名+公证，这道门槛清了。**
- **管道已接好**：`electron-updater` 在 `src/main.js`（仅 `app.isPackaged` 时跑）；Release 有 `latest-mac.yml`（更新清单）+ zip（更新包）。app 会轮询清单→后台下载新版→重启换上。
- **但还没实证**：从没真看到一次 v1→v2 自动更新发生。**这是下一步最核心、最有 demo 价值的事**（见下「下一步 A」）。
- **注意**：dmg 没公证**不影响**自动更新——自动更新走 zip，zip 里的 .app 是公证好的。

> 诚实结论：自动更新「前提全齐、应该能成」，但「未实证」。证它 = 两版本 demo。

---

## ⚠️ 两个已知瑕疵（代码/配置改动，下一个 AI 可做，非 Colin 手动）

1. **dmg 本体没签名没公证**（zip 里的 .app 有，dmg 容器没）。
   - 影响：**不弹「无法验证开发者」那个吓人警告**（那个钉在 app 上、app 干净）；顶多下载打开 dmg 时弹个无害的「从网上下载」通用提示。**不挡自动更新。**
   - 要做到 checklist 声称4「下载 dmg 打开零提示」金标准，需让 electron-builder 也公证 dmg（package.json 的 build.mac/dmg 配置）→ **再发一版**（再等一轮公证）。属锦上添花。
2. **`scripts/shipping-verify.js` 有路径 bug**：`findApp()` 只在 `release/mac*/` 子目录找 .app（本地 build 布局），对「下载 zip 解压」的布局（`release/*.app` 顶层）找不到、报「找不到 .app」退出 1。手动验证已证明产物没问题，但脚本该修：findApp 也认 `release/*.app`。**一行级修复。**（dmg 那条它还用了 `spctl --type install`，对 notarized dmg 是误判，正确该 `-t open`——但本仓 dmg 本就没公证，先放着。）

---

## ▶️ 下一步（Colin 选，都不是必须）

- **A（推荐，demo 高潮）：实证自动更新。** 走 lfg 把暂存的 `docs/demo-input/release-badge.*` spec 实现成 **v0.0.2**（状态栏加「Shipped by the pipeline」徽标，一眼可见的 diff）→ 装 v0.0.1 → 看它自己更新成 v0.0.2 → 录屏。这是给 Wendi 最炸的一幕，也是唯一能证「自动更新真生效」的方式。
- **B：修两个瑕疵**（dmg 公证 + shipping-verify findApp）。让产物链 pristine。建议等 A 录完再顺手做。
- **C：录全片。** 把「spec→PR→合并→签名发布→下载无吓人警告→自动更新」整条串起来录屏给 Wendi（checklist §取景建议）。

我的建议顺序：**A → C →（顺手）B**。

---

## 🧭 下一个 AI 必读的事实/坑（省得重踩）

- **目标仓**：`wordspace-next-demo`（owner repo = `jizhoutang10thglobal`，public）。app 是裸 Electron（`src/main.js`），不是 projectx。projectx 迁移是 **Phase B**、本周不碰。
- **账号**：宿主默认 gh 账号 `CTlandu`**对本仓无写权限**（push/合 PR/触发 workflow 都要切）。写操作前 `gh auth switch --user jizhoutang10thglobal`，完事切回 `CTlandu`。**只读（看 CI/Release）CTlandu 就行。**
- **main 有分支保护**：required PR + 必过 e2e/test + **enforce_admins=true（连 bot 都不放行直推 main）**。所以 release.yml **完全不写 main**：版本号从 git tag 推算、由 softprops 在当前 SHA 建 tag+Release（tag 不受分支保护）。**别再往 release.yml 里加任何 push main 的步骤。**
- **触发发版**：`.github/**` 已在 paths-ignore（改流水线自身不自触发）。手动发版：切 owner 账号 → `gh workflow run release.yml --ref main` → 后台盯（公证 2–15min，偶发卡到 60min timeout，DEBUG=electron-notarize* 能看到 submission id 区分「排队慢」vs「卡死」）。**真功能改动（src/**）合 main 会自动触发发版。**
- **5 个 Apple secrets 已配齐且验过**（CSC_LINK/CSC_KEY_PASSWORD/APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID）。排障史：401 是 APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD 不一致（已修）；签名证书 = Tenth Global Limited (Q59NV4356M)。
- **真门文化**：CI 绿 ≠ 产物能用。验签名公证必须宿主跑 codesign/spctl/stapler 对**真下载**的产物（容器没这些工具）。
- **失败安全**：build/公证失败 → 不建 tag/Release、main 不动。实战验过多次（401/超时都没污染 main）。

---

## 当前未提交的本地状态
- 下载的 v0.0.1 产物（release/ 200MB）已清理（gitignored）。
- 工作分支 chore/notarize-debug-timeout 已合并（PR #13），可删。
- 本文件 docs/2026-06-09-shipping-status-handoff.md 是新增、未 commit（按需提交）。
