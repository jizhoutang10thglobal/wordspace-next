<!--
compound 教训积累处：spec 的 autonomous run 学到的真实坑 / 好做法写进这里，
后续 run 因 Claude Code 自动加载本文件而吃到它（"系统变聪明了"）。
初始为空——不预写、不编造，靠真实运行积累。
-->

## Spec S1 Lessons — 2026-06-03

**Electron + Vitest：把纯逻辑从 Electron import 里解耦出来。**
把文档加载逻辑（`src/lib/doc-loader.js`）和窗口配置（`src/lib/window-config.js`）
放进不带 `require('electron')` 的普通 Node.js 模块。
Vitest 可以在 `node` 环境下直接 `require()` 它们，不需要任何 mock 或 Electron shim。

**Vitest 2.x 不能被 `require()`——用 `globals: true` 保持测试文件为 CJS。**
Vitest 2.x 的主 export 是 ESM-only，直接 `require('vitest')` 会报错。
在 `vitest.config.js` 里加 `globals: true`，测试文件就能用全局的
`describe` / `it` / `expect`，不用 import，测试文件继续写 CommonJS。

**~~Playwright Electron E2E：没有 `DISPLAY` 时用 `test.skip` 自动跳过。~~（⚠ 已废弃，见 S3）**
⚠ **这条是假绿，别再用。** 当初做法是在每个 Electron 测试顶部加
`test.skip(!process.env.DISPLAY, ...)`，让容器里 `npm run test:e2e` 全 skip = 退出码 0。
但 skip 不等于通过——「app 其实打不开」的坏成品会照样过门（spec2 就栽在这）。
正确做法见 S3：e2e 真门放 CI + xvfb，别加 `test.skip`。

**`npm install` 在本容器里需要设 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`。**
容器防火墙没放行 GitHub release 资源域名，Electron 预编译二进制下不来。
`scripts/run-spec.sh` 在容器内已自动 `export ELECTRON_SKIP_BINARY_DOWNLOAD=1`。
手动装依赖（新 dep、重建容器）也要带这个环境变量，否则 `npm install` 会卡住报错。

## Spec S3 Lessons — 2026-06-05

**让 renderer 用纯逻辑模块（如 `theme-manager`）：preload `require` + `contextBridge` 暴露 + `sandbox: false`。**
两个事实先记牢（都实测过，别凭直觉）：
① renderer 网页在 `nodeIntegration: false` 下**没有 `require`**——在 `renderer.js` 顶层
`require('../lib/xxx')` 会 `ReferenceError` 崩、文档加载不出来。这是 `nodeIntegration` 管的，
**不是 `contextIsolation`**（别混；CDP 实测：网页里 `typeof require === 'undefined'`）。
② preload 在默认 `sandbox: true` 下的 `require` 是阉割版、加载不了项目自定义模块，
`require('../lib/xxx')` 会让整个 preload 挂掉、`window.api` 全空、renderer 崩。
所以正确做法：**preload 里** `require('../lib/theme-manager')` + `contextBridge.exposeInMainWorld`
暴露成 `window.api.theme.*`，renderer 用 `window.api.theme.*`（不自己 require）；并在
`window-config` 的 `webPreferences` 加 **`sandbox: false`**（否则 preload 那句 require 会挂）。
对只加载本地可信内容的 demo app，丢 Chromium 进程沙箱可接受（`contextIsolation: true` +
`nodeIntegration: false` 仍在）。**实测对照**：renderer 直接 require → e2e 2 failed（网页没 require）；
preload require + `sandbox: false` + renderer 用 `window.api.theme` → e2e 2 passed。
`theme-manager.js` 不动，仍是 vitest 单测的单一来源。

**e2e 真跑只能放 CI（GitHub Actions + xvfb），dev container 里跑不了。**
容器防火墙白名单没有 Debian apt 源，装不了 xvfb，没 `DISPLAY` Electron 窗口起不来。
真门放 `.github/workflows/ci.yml` 的独立 e2e job：`apt-get install -y xvfb` +
`npx playwright install-deps chromium` + `xvfb-run -a --server-args="-screen 0 1280x720x24"
npm run test:e2e`，且这个 job 不设 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`（e2e 要真 Electron 二进制）。
`electron.launch` 的 args 要加 `--no-sandbox`——这是让 Chromium 进程在无特权 runner 能启动的
环境约束，跟上一条的 `webPreferences.sandbox`（app 安全设计）是两回事，别写混。

**`vitest` 全绿不代表 app 能打开——renderer/preload 集成必须有 e2e 真门兜着。**
vitest 只测脱离 Electron 的纯逻辑，永远碰不到 preload 注入、ipc、主题 apply 到 DOM 这些集成层。
spec2 就栽在这：14 个单测全绿、app 却打不开。权威门除了 vitest，必须有一道真启动 app 的 e2e
（放 CI），否则「绿但坏」会一路畅通到 PR。
