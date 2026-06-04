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

**Playwright Electron E2E：没有 `DISPLAY` 时用 `test.skip` 自动跳过。**
dev container 里没有 X server。在每个 Electron 测试函数体顶部加：
`test.skip(!process.env.DISPLAY, 'No DISPLAY — skipping in headless container')`
这样容器里 `npm run test:e2e` 全 skip = 退出码 0；macOS 有 display 时真跑。

**`npm install` 在本容器里需要设 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`。**
容器防火墙没放行 GitHub release 资源域名，Electron 预编译二进制下不来。
`scripts/run-spec.sh` 在容器内已自动 `export ELECTRON_SKIP_BINARY_DOWNLOAD=1`。
手动装依赖（新 dep、重建容器）也要带这个环境变量，否则 `npm install` 会卡住报错。

## Spec S2 Lessons — 2026-06-04

**`npm test` 报 `Cannot find module @rollup/rollup-linux-arm64-gnu`：重跑 `npm install` 即可。**
这是 npm 可选依赖解析的已知 bug（npm/cli#4828）：首次安装时可选的 rollup 原生二进制
没装进去，留下残缺状态。不需要删 `node_modules`——直接再跑一次
`ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install` 就能修复。

**contextBridge 可以安全暴露纯函数和字符串字面量（primitive）。**
在 `preload.js` 里 `require('../lib/theme-manager')` 后，把
`toggleTheme` / `getShellClass` 等纯函数和 `DEFAULT_THEME` 字符串
直接挂进 `contextBridge.exposeInMainWorld('api', { theme: {...} })` 完全正常。
Electron 33 的 contextBridge 支持函数和原始值的序列化，不需要额外包装。

**CSS 主题隔离：给 `#doc-container` 写死颜色值（非 CSS 变量）是最简洁的保真方案。**
把主题变量（`--shell-bg` 等）只作用于 `body` / `#status-bar`；
`#doc-container` 显式写 `background: #ffffff; color: #000000`（字面量，不用 `var(...)`），
级联在容器边界断掉，文档纸面颜色完全不受外壳主题影响。
既简单又可测：`getDocContainerStyles(theme)` 返回相同对象即是单元测试层的证明。
