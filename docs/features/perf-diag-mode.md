# 性能诊断模式 —— 对齐 spec（占位 / 欠账）

**欠账**：真 app v0.6.5 加了隐藏性能诊断模式——菜单「Wordspace Next → 性能诊断…」（或 Cmd+Shift+D）
开面板，显示每根 readTree 耗时/文件数/watcher 触发次数/云盘徽章 + 渲染耗时 + 主线程长任务(>50ms 卡帧)
+ JS 内存，并可「录制 5 秒 CPU Profile」。PR #147 直改了 `src/` 的 UI/交互但当时没有对应 spec，此处补记欠账。

这是 **app-only 的调试工具，无 ui-demo 对应物**，不进 ui-demo↔真 app 的产品对齐范畴——
除非将来产品化，否则无需补全 spec 四段（行为契约/文件映射/有意分歧/对齐锚点）。

来源：PR #147（已合 main、发版 v0.6.5）；实现在 `src/main/perf-diag.js` + `src/renderer/sidebar.js`（面板）+ `src/main/main.js`（菜单项）。
