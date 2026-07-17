# 应用内更新（updater UX） —— 对齐 spec

> app-only feature：自动更新只存在于打包后的真 app（electron-updater + GitHub Releases），
> ui-demo 没有对应面。按制度建 spec 记录行为契约与欠账；「ui-demo 侧」一栏恒空。

## 行为契约

两条路径共用一个状态机（`idle / checking / available / downloading / ready / uptodate / error / dev`），
面板和 pill 是同一状态的两种投影：

**手动路径**（菜单「检查更新…」）：全程弹面板跟进。**「跟进」只跟状态跃迁**：用户关掉面板
（如点「后台下载」）后，同状态的推送不再自动弹回（否则 0.2s 一条的进度推送会把刚关的面板立刻
打脸重开——Colin 2026-07-17 实踩）；状态跃迁（如 downloading→ready）才重新弹。
- 检查中：spinner +「正在检查更新…」。
- 发现新版：标题「发现新版本 vX.Y.Z」+ 该版 release notes 的人话段（GitHub release body 里
  `---` 分隔线以上的部分，见 docs/releasing.md 约定；markdown 归一成纯文本行，绝不 innerHTML）
  + 按钮「下载并安装」（主）/「以后再说」。
- 下载中：进度条（percent）+ 明细「42% · 55.0 MB / 132.0 MB · 3.2 MB/s」+「后台下载」（关面板留 pill）。
  首个进度事件到达前进度条走不定动画、明细显示「正在开始下载…」。
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
**渲染契约（防闪烁，2026-07-16 Wendi 反馈）**：结构签名（state+按钮+行类型+有无进度）不变的推送
（下载进度每 ~200ms 一次）只原地改文本/进度宽度——**不许拆卡重建、不许抢焦点**；只有状态跃迁才重建 + 聚焦一次。
e2e 以 DOM 节点身份标记断言（重建过的新节点标记必丢）。

**重启安装的退出链（2026-07-16 修复）**：Electron `autoUpdater.quitAndInstall()` **不发 `before-quit`**——
它先发专用的 `before-quit-for-update`、再逐窗 close、全部关完才 `app.quit()`。main 必须同时监听两个事件
打「真退出」标志，否则 mac「关窗=隐藏驻留」守卫会把 quitAndInstall 的关窗 preventDefault 吞掉：
窗口只是藏起来、app 不退、安装永远等不到 window-all-closed →「点了重启没反应」（2026-07-15 updater.log
四连击实锤；此前所谓能重启全靠用户手动 Cmd+Q 触发退出时安装）。若有未保存修改，脏守卫照常拦（弹确认，
取消则本次不装、退出时自动安装兜底）。

**更新要密码的账（root-owned bundle，2026-07-16 定位 / 2026-07-17 修正方案）**：bundle 一旦被提权
安装写成 root 所有（Squirrel ShipIt 的授权兜底会造成这个，且此后自我延续），每次更新 ShipIt 都要装
提权 helper → 弹系统密码/指纹；**用户取消该授权 = Squirrel 中止安装、app 留在原地**（不是 bug，是
授权链的必然）。⚠ **第一版「应用内 osascript+chown 修复」已证死**：macOS App Management(TCC) 连
root 的 chown 都拦（2026-07-17 Colin 机器实锤：授权后每文件 Operation not permitted）——**任何
「应用内改自身 bundle 归属/内容」的方案都会撞这道闸，别再试**。现行为（`maybeExplainInstallAuth`）：
`update-install` 时检测 bundle 根 + `Contents` 的 W_OK，不可写 → 弹说明「本次安装需系统授权 /
想永久免密去官网重装一次（Finder 拖入替换，输一次密码，新 bundle 归属即当前用户，此后恢复无提权
静默更新）」，按钮 = 继续安装（需授权）/ 去官网重装（系统浏览器开 wordspace.ai）/ 取消；后两者本次
不装（更新保持就绪可再点）。归属健康时零打扰。全程记 updater.log。
受影响机器的终端替代方案：`sudo chown -R "$(id -un)" "/Applications/Wordspace Next.app"`——但同受
TCC 约束，终端需先在「隐私与安全性 → App 管理」授权，故对普通用户首选官网重装路线。

**日志**：electron-updater 全部事件 + 状态迁移落 `userData/logs/updater.log`
（`src/lib/file-log.js`，512KB 轮转、保两代）。用户报「更新没更上」先要这个文件。

**差分更新（省流量）**：release 上传 mac `*.zip.blockmap`（electron-builder 26 默认生成）。
electron-updater 差分三条件：新老两版 release 都有 blockmap + 本地缓存有上次更新的 update.zip；
缺任一自动回退全量。Windows（NSIS `.exe.blockmap`）一直就有。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 状态机/展示模型（纯逻辑） | —— | `src/lib/update-status.js` |
| bundle 路径推导（纯逻辑，授权说明用） | —— | `src/lib/mac-bundle-repair.js` |
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
- 2026-07-16 三修复（重启退出链/免密修复/防闪烁）的真机端到端要**两个发版周期**才闭环：装上带修复的
  版本后、更新到再下一版时才走新代码（重启一键直达、免密修复弹一次）。Colin/Wendi 机器可先手动
  `sudo chown -R "$(id -un)" "/Applications/Wordspace Next.app"` 提前解决密码问题。
- before-quit-for-update 的行为门只在 darwin 有牙（Linux CI 无隐藏驻留守卫，close 本就直达退出）；
  CI 兜监听器存在性，行为验证靠 darwin 宿主跑 e2e。
- mac 差分实效未实测（要连发两版带 blockmap 的 release 才能观察真实节省比例）。
- 每标签缩放同款限制：Electron zoom 按 host 传播——与本 feature 无关，见 browser.md。
- 更新失败的 updater.log 尚无「一键导出/上报」入口，用户要手动去 userData 找。
