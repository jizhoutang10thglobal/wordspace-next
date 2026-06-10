# 本周任务交接简报：跑通 macOS shipping 尾巴（给 Wendi 演示）

> 给其他 AI 冷读用的对齐简报。2026-06-08 Colin × Claude 讨论后定稿。
> 一句话：**这周最重要的任务，是把 lfg pipeline 从「确认 spec」一路真跑通到「功能上线发布 + 用户可下载 + 自动更新」，在 `wordspace-next-demo` 这个仓里，spec 极简（Hello World 都行），产出截图/录屏给 Wendi 汇报。**

---

## 1. 本周「成功」长什么样

一条能录屏的连贯线，一镜到底、无人值守：

> 一个极简 spec（甚至 Hello World 级别的功能）→ 和 AI 确认需求 → AI 写 spec → 进 lfg pipeline → 自动出测试过的 PR → 合并 → **自动打包成签名+公证好的 macOS app → 发到 GitHub Releases 供下载 → 老版本 app 自动更新到新版本**。

交付物 = 截图 / 录屏。重点是**证明这条 pipeline 最远能推到哪一步**，不是 app 本身有多牛。

---

## 2. 三个已拍板的关键决策（别再推翻，除非 Colin 改主意）

### 决策 A：走 Developer ID 直分发 + 自动更新，**不走 Mac App Store**
- App Store 有 Apple **人工审核**（2026 年 Mac App Store 审核中位数已 ~5 天，且在变慢），任何自动化都删不掉 → 直接破坏「无人值守端到端」这个 demo 的灵魂。自动化最远只能到「自动提交 + 设成审核通过即自动上架」，然后干等 Apple。
- Electron 上 App Store 还有 sandbox 坑：会**禁掉 autoUpdater、child_process、crashReporter**，要另一套证书 + provisioning profile。VS Code / Slack / Figma / Notion 全都绕开 App Store。
- **Developer ID 直分发 + 公证 + electron-updater** 能做到 100% 无人值守的「想法 → 可下载（无 Gatekeeper 警告）+ 自动更新的签名 app」。这才是「最远能到哪」的正解，也正是上面那几个大厂走的路。

### 决策 B：跑在 `wordspace-next-demo`（public 仓），**不去 projectx 老仓**
- lfg 的前半段（idea → spec → 多轮澄清 → PR）就建在这个仓，shipping 尾巴接这儿才能一镜到底；放 projectx 录屏要中途跳仓，故事就断了。
- demo 仓是 **public**，免掉老 wordspace 那套「私库放源码 + 公库放二进制」的镜像复杂度——electron-updater 直接发本仓自己的 Releases 就行。
- 验证文化（`scripts/host-verify.js` / VA 答案卡 / 变异自检）全在这个仓。

### 决策 C：spec 极简，Hello World 都行
- 本周重点是 **pipeline 闭环**，不是功能。app 越简单，签名 / sandbox 的坑越少，越快跑通给 Wendi 看。

---

## 3. 跟「projectx 迁移计划」的关系（重要，别看混）

仓里有 `docs/plans/2026-06-08-001-refactor-pipeline-to-projectx-migration-plan.md`，目标是把流水线搬去 projectx 给**真产品** wordspace ship 真功能（前提论点：「玩具仓 ship 不出真功能」）。

**那是后一个阶段，本周不执行。** 两者是先后两步，不冲突：
- **本周（Phase A）**：在 demo 仓证明 pipeline 能一路通到 macOS shipping（任意 app）。这是**能力演示**。
- **将来（Phase B）**：要发真产品时，再把整套搬去 projectx。这是**产品化**。

本周目标是「证明能 ship」，不是「ship 真产品」，所以那条「玩具仓限制」本周不咬人。

---

## 4. 当前 demo 现状 + 本周要新建的东西

**现状**：`wordspace-next-demo` 是个**裸 Electron app**——`src/main.js`（极简，加载本地 HTML）+ `src/lib/*`（纯逻辑模块）+ `src/renderer/*`（preload + renderer）。**没有** electron-builder、没有 electron-updater、没有 `release.yml`、没签名。pipeline 右边缘现在停在「合 PR + CI 绿（vitest + e2e）」。

**本周新建**（把右边缘从「合 PR」推到「签名公证好、可下载、可自动更新的 release」）：
1. electron-builder 打包配置（mac，dmg + **zip**）。
2. electron-updater 接进主进程（打包后才生效）。
3. 签名 + 公证配置（hardened runtime + entitlements + `notarize`）。
4. `.github/workflows/release.yml`：合 main → 跑测试门 → bump 版本打 tag → macos runner 上打包+签名+公证 → 发 Releases。
5. shipping 的「真门」（接 host-verify）+ 截图/录屏。

---

## 5. 前例：老 wordspace（搬形状 + 升级）

老 wordspace 在 `projectx/.github/workflows/release.yml` + `projectx/dev/package.json` 已经跑通过一套形状：
> push main → 自动 bump 版本打 tag → macos runner `electron-builder --mac` 打 dmg → 传私库 Release + **镜像到公开仓 `wordspace-releases`** 供匿名下载 → electron-updater 从公开仓拉 `latest-mac.yml` 自动更新。

**但它抄了致命近路：完全没签名没公证**（`mac.identity: null`、`dmg.sign: false`、`CSC_IDENTITY_AUTO_DISCOVERY: false`）。两个后果：
1. 用户下载打开会撞 Gatekeeper「无法验证开发者」的吓人警告；
2. **macOS 自动更新（Squirrel.Mac）强制要求 app 签名**（Electron 官方文档明文），没签名 electron-updater 在 mac 上根本更新不了 → 老 wordspace 的「自动更新」在 mac 上大概率一直是坏的。

**做法**：把它的 release.yml 形状搬到 demo 仓，并**升级**：① 补上签名 + 公证（现在有 Apple 账户了）；② 去掉镜像 job（demo 仓 public，直接发本仓 Releases）；③ mac target 从 `dmg` 改成 `["dmg","zip"]`（electron-updater 在 mac 靠 zip 更新，只打 dmg 更新会坏——老 wordspace 大概率连这点都没对）。

---

## 6. 一次性人工设置（Colin 做，agent 替不了）

这条「全自动」链路，**第一次需要 Colin 在自己 mac 上做一次 ~30 分钟手工设置**，之后每次发布 100% 自动：

1. Apple Developer Program（$99/年，已有账户）。
2. 创建 **Developer ID Application** 证书（Keychain → CSR → developer.apple.com → 下载安装）。
3. 导出 `.p12`（带密码），`base64 -i cert.p12 | pbcopy`。
4. 生成 **app-specific password**（appleid.apple.com），或建 **App Store Connect API key**（更适合团队、免 2FA）。
5. 记下 10 位 **Team ID**。
6. 把以下塞进 GitHub repo secrets：
   - `CSC_LINK`（base64 的 .p12）
   - `CSC_KEY_PASSWORD`
   - `APPLE_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD`
   - `APPLE_TEAM_ID`

证书有效期 ~5 年；app-specific password / API key 不过期（除非吊销）。唯一周期性人工动作 = 证书到期续签。

---

## 7. 技术要点 / 已知坑（给实现 AI）

- **mac target 要 `["dmg","zip"]`**——dmg 给下载，zip 给 electron-updater 更新。只打 dmg，mac 自动更新会坏。
- **`.gitignore` 第 4 行 `build/` 会忽略掉 electron-builder 的资源目录**（entitlements.plist、图标）。要处理：把资源放到不被忽略的目录（如 `build-resources/`），或精确 un-ignore；同时把 electron-builder 的输出目录 `release/` 加进 `.gitignore`。
- **公证用 `notarytool`**（`altool` 已于 2023-11-01 移除）。electron-builder v24+ 内置 `mac.notarize: { teamId }`，底层调 `@electron/notarize` → `notarytool submit --wait`，**全程可脚本化、无人工、2–15 分钟**。别用废弃的非 scoped `electron-notarize`。
- **Electron 在 hardened runtime 下要 entitlements**：`com.apple.security.cs.allow-jit`、`allow-unsigned-executable-memory`、`allow-dyld-environment-variables`。配 `mac.hardenedRuntime: true` + `gatekeeperAssess: false`。
- **release job 放 `macos-latest` runner，绝不设 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`**（打包要真 electron 二进制）——跟现有 CI 的 e2e job 同一个道理（见 CLAUDE.md S3 教训）。
- **autoUpdater 只在打包后的 app 生效，dev 模式不触发**。要真证明「自动更新生效」，需要两个真签名版本（vN、vN+1）：装 vN → 指向 vN+1 的 feed → 断言版本翻转。
- **签名 + 公证只能在 macOS 上做**，dev container 跑不了（跟 e2e 真门「只能放 CI / 宿主」同构）。

---

## 8. shipping 的「真门」（接 host-verify 文化，别假绿）

延续仓里「门存在 ≠ 门够强、要变异自检」的文化。shipping 的真门不是「release.yml 跑绿了」，而是在宿主 mac 上**真验产物**：
- `spctl --assess -t install <app>`：Gatekeeper 会不会放行（签名/公证真生效才过）。
- `xcrun stapler validate <dmg>`：公证票是否真 staple 上去。
- 这俩是 VA 变异探针的对应物——**签名/公证一旦悄悄坏掉，这两个检查必翻红**。
- 再加一个**两版本自动更新 smoke**：装 vN、指向 vN+1 feed、断言版本真翻转。
- 截图 / 录屏存证 = 给 Wendi 的交付物。

---

## 9. 本周明确不做

- Mac App Store（人工审核门，反而更不自动化；见决策 A）。
- Windows / Linux 打包（先聚焦 macOS）。
- spec 澄清前端的打磨（idea → 多轮澄清 → 定 spec 这段已够用，本周聚焦 shipping 尾巴）。
- 搬去 projectx 真发产品（那是 Phase B，见第 3 节）。

---

## 10. 外部事实依据（带出处，避免凭记忆）

- Squirrel.Mac 强制签名才能自动更新：Electron 官方 `auto-updater.md`（原文「Your application must be signed for automatic updates on macOS. This is a requirement of Squirrel.Mac.」）；electron-builder issue #2326。
- `altool` 2023-11-01 移除，`notarytool` 为唯一路径；electron-builder 内置 `mac.notarize: { teamId }`：electron-builder issue #7893、`@electron/notarize` README。
- App Store 人工审核中位数 ~5 天（2026，且变慢）、自动化天花板 = 「submitted for review + auto-release on approval」：Apple App Store Connect 文档、fastlane `deliver` 文档、Michael Tsai 2026-03 审核时长汇总。
- Electron-on-MAS sandbox 禁用模块清单：Electron 官方 Mac App Store Submission Guide、electron-builder MAS 文档。
