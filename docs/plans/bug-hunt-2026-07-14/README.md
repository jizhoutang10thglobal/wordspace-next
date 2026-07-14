# 探索测试 2026-07-14 · 修复计划总索引

来源:4 路 AI 探索测试(真 app Playwright 驱动,每 bug 复现 ≥2 次,P1/P2 已源码核实)。
汇总报告(Artifact,给 Colin):https://claude.ai/code/artifact/ed8659c8-2f3a-43cd-8eec-5889a887f0a9

**状态:待 Colin 拍板后逐条认领执行。认领方式见文末「执行纪律」。**

## 清单

| 计划 | 严重度 | 一句话 | 主要动的文件 |
|---|---|---|---|
| [p1-error-page-dead-end](p1-error-page-dead-end.md) | P1 | 错误页后再导航,UI 永远停在错误占位 | browser.js |
| [p2-1-folder-move](p2-1-folder-move.md) | P2 | 文件夹在 app 内完全无法移动 | sidebar.js |
| [p2-2-multi-delete-undo](p2-2-multi-delete-undo.md) | P2 | 连删多个只能撤销最后一个 | sidebar.js |
| [p2-3-omnibox-stale-switch](p2-3-omnibox-stale-switch.md) | P2 | 地址栏打字中切标签,残留文字误导航 | browser.js |
| [p2-4-colon-search-blocked](p2-4-colon-search-blocked.md) | P2 | `note:hello` 被误当危险协议拦截 | url-input.js |
| [p2-5-sticky-row-drop](p2-5-sticky-row-drop.md) | P2 | 吸顶祖先行是拖放死区 | sidebar.js |
| [p2-6-dirty-doc-deleted-rescue](p2-6-dirty-doc-deleted-rescue.md) | P2 | 外部删除未保存文档,改动静默丢弃(**已拍板做**) | sidebar.js |
| [p3-01-dead-star-on-doc-tab](p3-01-dead-star-on-doc-tab.md) | P3 | 文档标签/起始页出现死的收藏星标 | browser.css |
| [p3-02-pinned-tab-close-button](p3-02-pinned-tab-close-button.md) | P3 | 置顶标签关闭钮:**已拍板保留 ×**,纯 docs 改 spec | browser-feature-spec.md |
| [p3-03-rename-extension](p3-03-rename-extension.md) | P3 | 改名强制保留原后缀出「火箭.md.html」 | sidebar.js(+ipc) |
| [p3-04-external-dir-auto-expand](p3-04-external-dir-auto-expand.md) | P3 | 外部新建文件夹默认展开,不一致 | sidebar.js |
| [p3-05-pin-lost-after-undo](p3-05-pin-lost-after-undo.md) | P3 | 置顶→删除→撤销,置顶状态丢 | sidebar.js |
| [p3-06-same-name-cross-root](p3-06-same-name-cross-root.md) | P3 | 跨根同名文件在标签/置顶区分不清 | sidebar.js |
| [p3-07-tree-expand-persist](p3-07-tree-expand-persist.md) | P3 | 树展开/折叠状态重启不记忆 | sidebar.js+workspace-store |
| [p3-08-missing-root-self-heal](p3-08-missing-root-self-heal.md) | P3 | 失联根改回原路径不自愈 | ipc.js |
| [p3-09-manual-folder-dup](p3-09-manual-folder-dup.md) | P3 | 收藏手动建/改文件夹允许同名 | browser.js(+bookmarks) |
| [p3-10-import-folder-double](p3-10-import-folder-double.md) | P3 | 导出→导入文件夹翻倍(拍板行为,建议复议) | bookmarks.js |
| [p3-11-bookmark-cap](p3-11-bookmark-cap.md) | P3 | 收藏无条数上限 | browser-store.js |

## 执行纪律(每条计划的执行 session 都要遵守)

1. 开工前 `/sync-main` + 读对应计划全文 + 读计划里列的 feature spec 章节;行号是写计划时(main@3924018 前后)的,**以 grep 函数名为准**。
2. 一条计划 = 一个短命分支 = 一个 PR;修复必须带:单测/e2e 门(计划里写了最低要求)+ **变异自检**(先 commit 再变异,翻红+还原翻绿)+ **同 PR 更新对应 feature spec**(CLAUDE.md 铁律)。
3. 动 `sidebar.js`/`ipc.js` 共享核心的,推 PR 前本地 `npm run test:e2e:dot` 全量兜底;孤立文件只跑受影响 spec。
4. 探索员的复现脚本在主 session scratchpad `bug-hunt/work/`(session 隔离,拿不到就按计划里的复现步骤自己写,几行的事)。
5. 修完在 team-memory 广播一行(哪条修了、PR 号),README 本表不用回填。
