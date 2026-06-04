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

**preload 在默认 `sandbox: true` 下不能 `require` 项目自定义模块。**
Electron 20+ 的 preload 默认在 sandbox 里跑，它的 `require` 是阉割版、只能加载 electron 和
Node 内置模块。在 preload 里 `require('../lib/xxx')` 自定义模块会直接抛错、整个 preload 挂掉、
`contextBridge` 不执行、`window.api` 全空、renderer 崩。正确做法：纯逻辑模块（无状态、无 Node
依赖，如 `theme-manager`）直接在 `renderer.js` 里 `require('../lib/xxx')`（renderer 在
`contextIsolation: true` 下仍有完整 `require`），preload 只保留真正跨进程的 ipc 桥
（如 `ipcRenderer.invoke`）。这样 `webPreferences.sandbox` 保持默认 true（纵深防御不丢）、
不引构建步骤、纯逻辑仍是单一可测来源。**别用 `sandbox: false` 绕**——那白丢 Chromium 进程沙箱。

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
