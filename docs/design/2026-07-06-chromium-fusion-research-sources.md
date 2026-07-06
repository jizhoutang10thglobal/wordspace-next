# Chromium 融合调研 · 技术附录（工程用）

正文见 `2026-07-06-chromium-fusion-research.md`。这里是 API/出处清单，非技术可跳过。

## Chrome 能力 → Electron API 对照

**白拿（引擎自带 / 薄封装）**
- 导航：`webContents.navigationHistory`（`.goBack/.goForward/.canGoBack/.getEntryAtIndex/.restore`）；`loadURL`/`reload`/`stop`。⚠ 老 `goBack/goForward` 在 Electron v32 已 deprecated。
- 缩放：`webContents.setZoomLevel/setZoomFactor`。Chromium **按 origin 在同一 session 内共享缩放**=自带行为，不用自己做（但跨重启持久化要自己存）。
- 打印/PDF：`webContents.printToPDF(opts)` → Buffer；`webContents.print(opts)`。
- 内置 PDF 阅读器：PDFium 自 Electron 9 起打包，`webPreferences.plugins: true` 即可。
- DevTools：`webContents.openDevTools()`。
- 拼写检查：`session.setSpellCheckerLanguages([...])` + `context-menu` 事件（`params.misspelledWord`/`dictionarySuggestions`）+ `webContents.replaceMisspelling`。
- 截图：`webContents.capturePage([rect])`。
- UA/设备模拟：`webContents.setUserAgent`；`webContents.enableDeviceEmulation(params)`。
- 清数据：`session.clearStorageData()`/`clearData()`/`cookies`。
- 沙箱/隔离：renderer sandbox 自 Electron 20 默认开；contextIsolation 自 12 默认；site isolation 自动继承。
- 无障碍：`app.setAccessibilitySupportEnabled`；CDP `Accessibility.getFullAXTree`。
- PiP / Media Session：Web 平台 API，页面触发，无需实现。

**要做（引擎干活 + 我们做 UI）**
- 查找：`webContents.findInPage/stopFindInPage` + `found-in-page`。
- 下载：`session` `'will-download'` → `DownloadItem`（`pause/resume/cancel/setSavePath`、`getReceivedBytes/getTotalBytes`）；跨重启续传 `session.createInterruptedDownload`。
- 全页截图：CDP `Page.captureScreenshot({captureBeyondViewport:true})`（`webContents.debugger`）。
- 阅读模式：Electron 未暴露 Chromium DOM Distiller → 注入 `@mozilla/readability`（Min 同款）。
- 扩展：`session.extensions.loadExtension(path)`（仅解包、无商店）；完整 tab/popup 用 `electron-chrome-extensions`（Samuel Maddock）；MV3 部分支持。

**做不到（谷歌云服务层）**
- ⚠ Safe Browsing：**缺席**。Electron 未启用（issue [#4440](https://github.com/electron/electron/issues/4440) 常年 open）。**安全缺口，必须告知产品。**
- 翻译：Chrome 翻译 + 端侧模型在 Electron 不可用（[#48567](https://github.com/electron/electron/issues/48567)）→ 接第三方 API。
- 自动填充/密码管理：未接通（[#41614](https://github.com/electron/electron/issues/41614)、[#15753](https://github.com/electron/electron/issues/15753)）。
- 同步/谷歌账号/Web Store/Omaha 更新/Widevine：谷歌专有，不在引擎。

## 融合方向出处

- Beaker Browser（编辑即浏览的前身，2017-2022 停）：[github.com/beakerbrowser/beaker](https://github.com/beakerbrowser/beaker) + [停服说明](https://github.com/beakerbrowser/beaker/blob/master/archive-notice.md)（范围教训非 UX 教训）。
- Arc Capture（框选网页内容进笔记，保持可交互）：[Easels: Capture & Create](https://resources.arc.net/hc/en-us/articles/19231142050071-Easels-Capture-Create)。
- Arc Library（笔记/标签相邻但轻分隔、共享 chrome）：[Library help](https://resources.arc.net/hc/en-us/articles/19230634389911-Library)。
- Arc Command Bar（一个输入框多用）：[coverage](https://www.superchargebrowser.com/library/arc-command-bar-chrome/)。
- Notion / Craft / Obsidian Web Clipper（网页→文档树）：[Notion clipper](https://www.notion.com/web-clipper)、[Craft clipper](https://support.craft.do/hc/en-us/articles/21463603834780)、[Obsidian Surfing](https://github.com/PKM-er/Obsidian-Surfing)。
- Notion embed 的天花板（实时网页永远是带框只读盒）：[Notion embed help](https://www.notion.com/help/embed-and-connect-other-apps)。
- VS Code webview 信任分层（同问题成熟先例）：[Webview API](https://code.visualstudio.com/api/extension-guides/webview) + [沙箱逃逸 issue](https://github.com/microsoft/vscode/issues/192853)。
- Electron 官方按信任等级选装法：[Security](https://www.electronjs.org/docs/latest/tutorial/security)、[Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds)。

## 版本勘误

调研 agent 指出：Chromium ~136 对应 Electron 36，Electron 42 应对应 Chromium ~142。本仓 `package.json` pin 的是 `electron ^42`。上面 API 在该区间稳定，不影响结论；实现时以本仓实装版本为准（`node_modules/electron` d.ts 已逐条核对过 U3 用到的 API）。
