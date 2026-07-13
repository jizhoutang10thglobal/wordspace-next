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

**日志**：electron-updater 全部事件 + 状态迁移落 `userData/logs/updater.log`
（`src/lib/file-log.js`，512KB 轮转、保两代）。用户报「更新没更上」先要这个文件。

**差分更新（省流量）**：release 上传 mac `*.zip.blockmap`（electron-builder 26 默认生成）。
electron-updater 差分三条件：新老两版 release 都有 blockmap + 本地缓存有上次更新的 update.zip；
缺任一自动回退全量。Windows（NSIS `.exe.blockmap`）一直就有。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 状态机/展示模型（纯逻辑） | —— | `src/lib/update-status.js` |
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
- mac 差分实效未实测（要连发两版带 blockmap 的 release 才能观察真实节省比例）。
- 每标签缩放同款限制：Electron zoom 按 host 传播——与本 feature 无关，见 browser.md。
- 更新失败的 updater.log 尚无「一键导出/上报」入口，用户要手动去 userData 找。
