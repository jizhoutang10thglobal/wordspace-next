# 发版（Releasing）

Wordspace 的 macOS / Windows 安装包由 GitHub Actions 的 **Release** workflow（`.github/workflows/release.yml`）签名、公证、发布到本仓 GitHub Releases；用户端的自动更新（electron-updater）就从这些 Release 拉取。

## 什么时候会发版

**只有两种方式会触发发版。合 PR 到 main、修小补丁都不会自动发版。**

### 1. 打 tag（推荐）

```bash
git tag v0.2.0
git push origin v0.2.0
```

用这个 tag 作为版本号发版。tag 必须形如 `vMAJOR.MINOR.PATCH`（三段纯数字，如 `v0.2.0`）。

### 2. 手动触发

GitHub → **Actions** → **Release** → **Run workflow**：

- 「version」填版本号（如 `0.2.0`）；
- 留空则自动取 `max(最高 tag 的 patch + 1, package.json.version)`，并自动建 tag。

## 发版时会发生什么

1. **gate**（ubuntu）：vitest 单测 + 真 Electron e2e（xvfb）。不过就不发。
2. **release**（macOS）：electron-builder 签名 + 公证打包 → **只有打包成功后**，才建带 `vX.Y.Z` tag 的已发布 Release（dmg + zip + latest-mac.yml）。
3. **build-win**（Windows）：把 nsis 安装包（.exe + latest.yml）upsert 进同一个 Release。

mac 用 zip + latest-mac.yml、win 用 exe + latest.yml 给 electron-updater 做自动更新；dmg / exe 给直接下载。

## 护栏

- **不会覆盖已发布的版本**：对一个已经发布过的 tag 重跑 workflow 会硬失败，避免覆盖已 ship 的签名产物和自动更新校验和。要重发，先删掉那个 Release / tag。
- **版本号严格 `X.Y.Z`**：`v1.2.3.4`、`v0.2.0-beta` 这类会被挡下。
- **全程不写 main**：版本号只烤进产物，不 commit 回 `package.json`。

## 前置条件

- 5 个 Apple secret 已配在仓库（`CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`）——配置见 [`apple-developer-setup-walkthrough.md`](apple-developer-setup-walkthrough.md)。
- 推 tag 需要对本仓有写权限（owner 账号 `jizhoutang10thglobal`）。

## 发完怎么验

按 [`shipping-verification-checklist.md`](shipping-verification-checklist.md) 在宿主 mac 上验证签名 / 公证 / staple，以及自动更新能真正拉到新版本。

## Release notes（2026-07-12 起的约定）

- 每次发版后给该版本写一段**人话说明**（用户视角优先），落两处：
  1. 仓库根 [`CHANGELOG.md`](../CHANGELOG.md)（正本，倒序）；
  2. 同步到该版本 GitHub Release 页顶部（自动生成的 PR 列表保留在下方给开发者）。
- 带新功能的版本值得写细；纯修复的小版本一两行即可。
