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

## Release notes（2026-07-12 起的约定；2026-07-17 起分「完整版/简洁版」）

- 每次发版后给该版本写**两档**用户可见说明（Wendi 2026-07-17「更新通知尽量简洁,changelog 反而可以完整」）：
  1. **完整版** → 仓库根 [`CHANGELOG.md`](../CHANGELOG.md)（**正本**，倒序）+ `CHANGELOG.en.md`（双语同写，见下）；
  2. **简洁版** → 该版本 GitHub Release 页顶部：**1 句导语 + ≤5 条要点（每条 ≤20 字，不用 `###` 分组头）**；
     `---` 之下放一行「完整更新说明：https://wordspace.ai/changelog」+ 自动生成的 PR 列表。
     ⚠ **App 内更新面板显示的就是 Release 顶部这段**——写长了用户弹窗里读不完。代码另有硬保险：
     `parseReleaseNotes` 截 8 行 + 尾行提示点「更新日志」看完整版（`src/lib/update-status.js`，有单测）。
- 内容会自动流到两处，**不用手动同步**：
  - App 内更新面板（electron-updater 拉 Release body，`src/lib/update-status.js` 解析 `---` 之上的部分）；
  - 官网 [wordspace.ai/changelog](https://wordspace.ai/changelog)（构建时渲染 CHANGELOG.md；
    `website/vercel.json` 的 ignoreCommand 已放行根目录 CHANGELOG.md / CHANGELOG.en.md 的变更触发重建——改这个闸前想清楚方向）。
- **双语同写（2026-07-17 起，Colin 拍板）**：每版除中文正本外，同步在 `CHANGELOG.en.md` 写英文版
  （同结构，组名 Added / Improved / Fixed，标题行备注用半角括号）。官网 changelog 页有中英切换，
  **构建时有同步门**：en 最新版本 ≠ zh 最新版本 → next build 直接挂（部署红）。历史条目 en 缺失
  允许（页面按版本回落中文），门只咬最新版。

## Changelog 文案规范（2026-07-16 起）

**目标**：用户 5 秒能扫完一个版本改了什么。Wendi 拍的方向：精简、规范。

**结构**（每个版本）：

```markdown
## vX.Y.Z — YYYY-MM-DD

一句话导语（可选：本版最重要的一件事，≤24 字，不解释机制）

### 新增
- **区域**：一行动宾短句（≤30 字）
### 改进
- …
### 修复
- …
```

**写法规则**：

- 只列真有内容的组（纯修复版就只有「修复」组）；全版 ≤3 条可平铺不分组。
- 每条一行：先说变化结果，不说原因；可用 `**区域**：`（侧栏/浏览器/图片/更新/地址栏/收藏…）开头帮扫读。
- **禁止**：根因与内部机制、内部术语（watcher/IPC/renderer…）、PR 号、文件名、开发侧改动
  （测试/文档/CI/ui-demo 这类不进 changelog——GitHub Release 的 PR 列表足够开发者看）。
- 每版条目 ≤10 条；更多就归并（「一批 XX 修复：a；b；c」）。
- 括号补充只用于「用户会疑惑」的场景说明（如平台限定、生效时机），不用于解释实现。

### 配图（2026-08-05 起）

**什么时候才配图**：只给「一眼能看懂的交互变化」配——新出现的界面、动作前后的差别、
说不清但看一眼就懂的手感（拖拽落点、缩进层级、新面板）。**不是每条都配**：
纯修复、纯文案、后台行为一律不配。经验值 **每版 0–2 张**，多了没人维护得动，
也会破坏「用户 5 秒扫完一个版本」这个原始目标。

**怎么写**（独立成行，前后各留一个空行）：

```markdown
### 新增

- **列表**：四行可以一起改颜色了

![选中四行后一起改颜色](website/public/changelog/0122-multi-color.png)
```

- **路径写仓库根相对的 `website/public/…`**——这样在 GitHub 上直接看 CHANGELOG.md 图也能显示；
  官网构建时会把 `website/public/` 前缀映射成站点根 `/`。写别的路径 → 构建直接挂。
  路径形状也被钉死：**不许出现 `//`、`./`、`../`，必须带图片扩展名**。原因是查盘那头用
  `path.join` 会把这些归一掉、浏览器却按 URL 规则解析原串，两边不是同一个真相时就出现
  「构建全绿 + 线上裂图」（`website/public//a.png` 在页面上是 protocol-relative URL，
  会去请求一个外部主机）。
- **alt 必填、且只能是纯文本**，它同时就是页面上的图注（figcaption）：只有一份文字，
  不会出现「alt 和图注各写一套」。空 alt → 构建直接挂；alt 里写 `**粗体**` 或反引号也直接挂
  ——图注不过行内 markdown 处理，写了就是原样吐到页面上的噪声。alt 里可以有半角 `[]`。
- **图片必须独立成行**，不能塞进 `- ` 条目里或跟文字混在一行 → 否则构建直接挂
  （历史上这种写法会被剥成字面 `!alt` 噪声文本，全绿地坏掉，所以现在改成响亮报错）。
  想在条目里**谈论** markdown 图片语法，用行内代码包起来（`` `![alt](path)` ``），门认这个。
  另外，写坏了解析不出图片形状的行（比如少个括号）也会挂——不会被静默丢掉。
- 位置决定归属：写在某个 `###` 之下 → 归该分组，渲染在该组条目下方；
  写在任何 `###` 之前 → 归该版本，渲染在导语下方。
- **图片文件放 `website/public/changelog/`**，命名 `<版本号去点>-<短名>.png`（如 `0122-multi-color.png`）。
  文件必须真在盘上、而且真是个文件，缺一张 → 构建直接挂（`website/app/lib/changelog.ts` 的
  `assertImagesOnDisk`；报错会写清「哪份正本 哪个版本 → 正本里的原始路径」，可直接拿去 grep）。
  ⚠ 只有一个例外：正本读不到、退回 GitHub raw 时这道门会跳过（两边不同源，硬校会假红），
  此时构建日志里有一行 `changelog: … 走了 GitHub raw 回退` 的 warn——看到它就知道这次没门保护。
- 图会被收到跟正文同一列宽（约 690px），所以出图按 2 倍宽（1200–1600px）截就够，别传 4K 原图。
  构建时会读图片文件头把固有宽高写进 `<img width/height>`，图到货时不会把下方内容顶下去。
- **英文侧可选**：`CHANGELOG.en.md` 里同一条目要配图就复用同一个图片文件、alt 写英文；不配也行。
- `website/public/changelog/fixture-render-check.png` 和 `-2.png` 不是真配图，是 `/changelog/fixture`
  那道渲染门用的夹具图（两张刻意不同尺寸/不同文件名，见 `fixture-md.ts` 的注释），**别删**。
