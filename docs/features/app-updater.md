# 应用内更新（updater UX） —— 对齐 spec

> app-only feature：自动更新只存在于打包后的真 app（electron-updater + GitHub Releases），
> ui-demo 没有对应面。按制度建 spec 记录行为契约与欠账；「ui-demo 侧」一栏恒空。

## 行为契约

两条路径共用一个状态机（`idle / checking / available / downloading / ready / uptodate / error / dev`），
面板和 pill 是同一状态的两种投影：

**手动路径**（菜单「检查更新…」）：全程弹面板跟进。
- 检查中：spinner +「正在检查更新…」。
- 发现新版：标题「发现新版本 vX.Y.Z」+ 该版 release notes 的人话段（GitHub release body 里
  `---` 分隔线以上的部分，见 docs/releasing.md 约定；markdown 归一成纯文本行，绝不 innerHTML）
  + 按钮「下载并安装」（主）/「以后再说」。
- 下载中：进度条（percent）+ 明细「42% · 55.0 MB / 132.0 MB · 3.2 MB/s」+「后台下载」（关面板留 pill）。
  首个进度事件到达前进度条走不定动画、明细显示「正在开始下载…」。
- **点「后台下载」（或 ×/Esc/点遮罩）关掉面板后，同状态的后续推送不再把它弹回来**（Colin 2026-07-17
  实机：手动下载每 ~200ms 一条 progress，一关就被下一条打脸重开 →「不停跳出来」）。记住关面板时所处的
  状态（`dismissedAtState`），只有**状态跃迁**（如 downloading→ready）才重新弹——「全程跟进」跟的是里程碑、
  不是每个进度 tick。后台下载期间 pill 照常跟进度，随时可点 pill 重新开面板。
- 已就绪：「立即重启安装」（主）/「稍后（退出时自动安装）」。稍后 = electron-updater
  autoInstallOnAppQuit 默认行为，真退出（Cmd+Q）时装；mac 点红叉只是隐藏窗口、不触发安装。
- 已是最新：「已是最新版本（当前 vX.Y.Z）」。
- 出错：错误信息 + 「重试」（检查阶段失败→重查；下载阶段失败→重新下载）+「关闭」。
- dev（未打包）：提示「开发模式无法检查更新」。
- 已在下载/已就绪时再点「检查更新…」：不重查，直接开面板显示进行中状态。

**自动路径**（启动时静默检查）：不打扰。
- 有新版 → 静默开始下载（延续既有策略），**不弹面板**；侧栏页脚上方出现更新 pill
  （「正在下载更新 vX.Y.Z · 42%」+ 3px 细进度条），点 pill 开面板。
- 下载完成 → toast「新版本已就绪」带「重启安装」action（只提示一次）；pill 变「更新已就绪 · 重启安装」常驻。
  web 标签激活时 toast 前调 `window.__webToastInset()` 临时收缩原生 view 底部，toast 不被盖。
- 静默检查失败 → 不打扰用户（回 idle），只落日志。
- 侧栏收起/无工作区（无侧栏）时 pill 不可见——ready toast 与菜单入口兜底。

**面板通用**：复用 `.sb-modal-overlay`/`.sb-modal` 壳（web 标签态自动摘 view、与其他弹层单例互斥）；
Esc / 点遮罩 / × 关闭；主按钮自动聚焦。

**更新日志入口（2026-07-16，Wendi「要有地方 track 各版本 notes」）**：正本=仓库根 CHANGELOG.md，
官网 wordspace.ai/changelog 构建时渲染（见 docs/releasing.md「Changelog 文案规范」）。App 内两处入口，
都**开成 app 内网页标签**（`update-open-changelog` IPC → `openExternalUrlFromOS`，含 scheme 白名单与
就绪排队）：① 菜单「Wordspace Next → 更新日志…」；② 更新面板按钮——available「更新日志」/
ready「更新日志」/ uptodate「最近更新了什么」（downloading/error 不给，别打扰当前事）。
点击先收面板再开标签（弹层在时 view 被摘除守卫压着）。
**渲染契约（防闪烁，2026-07-16 Wendi 反馈）**：结构签名（state+按钮+行类型+有无进度）不变的推送
（下载进度每 ~200ms 一次）只原地改文本/进度宽度——**不许拆卡重建、不许抢焦点**；只有状态跃迁才重建 + 聚焦一次。
e2e 以 DOM 节点身份标记断言（重建过的新节点标记必丢）。

**重启安装的退出链（2026-07-16 首修 → 2026-07-17 二修才真修好）**：Electron `autoUpdater.quitAndInstall()`
**不发 `before-quit`**——native Squirrel 逐窗 close、全部关完才 quit；若「真退出」标志没打上，mac
「关窗=隐藏驻留」守卫会把关窗 preventDefault 吞掉：窗口只是藏起来、app 不退、安装永远等不到
window-all-closed →「点了重启,app 赖在 Dock 里、点开又是重启安装界面」。
⚠ **07-16 首修是哑修**：补的 `app.on('before-quit-for-update')` 挂错发射器——该事件属
`require('electron').autoUpdater`（**AutoUpdater 接口**，electron.d.ts:1995），不是 app 事件，从未触发
（Colin 07-17 实机复现）。**现行修法（零事件依赖）**：`update-install` handler 在调 quitAndInstall
**之前**由 `beginQuitForUpdate` 直置 `quitting=true`（用户点了「重启安装」= 意图明确，动作点直接放行；
同步抛错则复位防「下次红叉误真退」），另在**正确的发射器**（native autoUpdater）上挂一份事件兜底。
门：`e2e/update-quit.spec.js`——`WS2_UPDATE_QUIT_SIM`（复用同一 beginQuitForUpdate + 逐窗 close 模拟
native 关窗序列）+ `WS2_DARWIN_PERSIST_SIM`（任何平台强制驻留分支,让 Linux CI 也有牙）断言**进程真退出**，
另有驻留语义对照门。若有未保存修改，脏守卫照常拦（弹确认，取消则本次不装、退出时自动安装兜底）。

**更新免密（一次性归属修复，2026-07-16）**：bundle 一旦被提权安装写成 root 所有（Squirrel ShipIt 的
授权兜底会造成这个，且此后自我延续），每次更新都会弹系统密码/指纹。修复：`update-install` 时检测
bundle 根 + `Contents` 的 W_OK，不可写 → 弹一次性说明（「修复并继续安装」/「跳过」）→ 授权后
`chown -R <uid>`（osascript with administrator privileges，命令构造在 `src/lib/mac-bundle-repair.js`，
uid 数字校验 + shell/AppleScript 双层转义，有单测）→ 此后 ShipIt 恢复无提权替换、更新免密。
跳过/失败不拦安装（落回 ShipIt 提权弹窗，不比现状差）；全程记 updater.log。

**日志**：electron-updater 全部事件 + 状态迁移落 `userData/logs/updater.log`
（`src/lib/file-log.js`，512KB 轮转、保两代）。用户报「更新没更上」先要这个文件。

**差分更新（省流量）**：release 上传 mac `*.zip.blockmap`（electron-builder 26 默认生成）。
electron-updater 差分三条件：新老两版 release 都有 blockmap + 本地缓存有上次更新的 update.zip；
缺任一自动回退全量。Windows（NSIS `.exe.blockmap`）一直就有。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 状态机/展示模型（纯逻辑） | —— | `src/lib/update-status.js` |
| 免密修复命令构造（纯逻辑） | —— | `src/lib/mac-bundle-repair.js` |
| 文件日志 | —— | `src/lib/file-log.js` |
| updater 接线 + IPC + sim seam | —— | `src/main/main.js`（setupAutoUpdater 段） |
| 面板 + pill 渲染 | —— | `src/renderer/update-ui.js` / `.css` |
| pill 宿主 | —— | `src/renderer/index.html`（`#sb-update`，`.sb-foot` 上方） |
| e2e | —— | `e2e/update-ui.spec.js`（`__ws2UpdateSim` seam 驱动） |

## 有意分歧

- ui-demo 无此 feature（Web 原型没有安装/更新概念）——Colin 方向默认，2026-07-13。

## 对齐锚点

- ui-demo 侧：不适用
- app 侧：commit `d8f703f`（2026-07-13）

## 欠账

- 打包态真更新链路未实测（弹面板/进度/重启安装要等下一次真发版验证；sim e2e 只兜非打包链路）。
- **重启退出链二修（2026-07-17）的真机端到端同样要两个发版周期**：装上带本修复的版本后、更新到再下一版
  时才走新代码（07-16 首修是哑修，所以 Colin 07-17 更新时仍复现——他运行的版本里 quitting 从未被置位）。
  免密修复/防闪烁（07-16）不受影响；密码问题可先手动
  `sudo chown -R "$(id -un)" "/Applications/Wordspace Next.app"` 解决。
- ~~before-quit-for-update 的行为门只在 darwin 有牙~~（已解决：`e2e/update-quit.spec.js` 用
  `WS2_DARWIN_PERSIST_SIM` 在任何平台强制驻留分支，Linux CI 也有牙）。
- mac 差分实效未实测（要连发两版带 blockmap 的 release 才能观察真实节省比例）。
- 「后台下载」抑制弹回的已知小 gap：下载中点了后台下载、又在**同一个下载期间**点菜单「检查更新…」，
  `manualCheckForUpdates` 会重推**同一个 downloading 状态**，被同状态抑制吞掉 → 菜单点了面板不弹（pill
  仍在，点 pill 可重开）。要让显式「检查更新」永远弹面板，需 main 侧给这次重推打个 forcePanel 信号让
  renderer 无视 dismissedAtState——本次没做（避免动 main.js，与 #248 免密安装那摊解耦）。
- 每标签缩放同款限制：Electron zoom 按 host 传播——与本 feature 无关，见 browser.md。
- 更新失败的 updater.log 尚无「一键导出/上报」入口，用户要手动去 userData 找。
