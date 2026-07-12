# 工作区文件树 —— 对齐 spec

## 行为契约

把文件夹当工作区打开时，文件树递归扫描该文件夹，但按三类忽略——治「打开大文件夹 / 桌面特别卡」
（Wendi 2026-07-11 实测根因：桌面里的 `Minecraft.app` 被当普通文件夹递归钻进去，内部上万文件把 readTree 卡死）：

- **macOS 包（package/bundle）**：`.app` / `.framework` / `.bundle` / `.photoslibrary` / `.fcpbundle` /
  `.dSYM` / `.pkg` / `.mpkg` / `.plugin` / `.kext` / `.xpc` / `.component` / `.qlgenerator` / `.prefPane` /
  `.imovielibrary` / `.tvlibrary` / `.aplibrary` / `.musiclibrary` 等——树上**显示成单个节点，不递归进内部**
  （Finder 同款：包在 Finder 里就是单个文件；一个 `.app` 内部可几千到十几万文件）。

- **依赖 / 构建 / 缓存目录**：`node_modules`、`.git`、`bower_components`、`__pycache__`、`Pods`、
  `DerivedData`、`venv`——**完全隐藏**（对文档编辑器是纯噪音，且是文件数炸弹，`node_modules` 常 10 万+）。
  **不含** `build`/`dist`/`out`/`target` 这种普通词，怕误伤用户真文件夹。

- **隐藏文件**（点开头 `.xxx`，含 `.DS_Store`/`.Spotlight-V100`/`.fseventsd` 等）+ 原子写临时文件
  （`.ws2tmp*`）——**完全隐藏**。

判定按名字/后缀（不引 macOS UTI，够用且简单）。实现：`src/main/workspace.js` 的
`skip()`（隐藏类）+ `isBundle()`（包不递归）+ `walk()`。

## 文件映射

| 维度 | ui-demo | 真 app |
|---|---|---|
| 忽略规则 | （无——mock 数据） | `src/main/workspace.js`（`IGNORE` / `BUNDLE_EXTS` / `walk`） |

## 有意分歧

ui-demo 用 mock / 内存数据、不扫真实文件系统，这套忽略只在真 app 生效——**无 ui-demo 对应实现**，不算漂移。

## 对齐锚点

- app 侧：commit `<待填>`（2026-07-11，本 PR）

## 欠账

若将来 ui-demo 接真实文件系统，需对齐这套忽略规则（bundles / 依赖目录 / 隐藏文件）。
