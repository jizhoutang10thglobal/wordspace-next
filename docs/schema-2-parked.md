# Schema 2「分页文档」parked 分支说明

**本分支 = Schema 2 拆分批次撤出 main 前的完整代码存档**（钉在 main `526549d`，2026-08-03）。

## 为什么撤

Colin 2026-08-03 拍板（源头是 Wendi 的原则：半成品不进 main/生产端）：Schema 2 还差很多
（标准化排版层没进真 app、PR-D 未收口、Wendi 未验收页眉页脚视觉），已合 main 的部分只是半成品。
与其每次发版都从 release 分支剥离（v0.11.7 那次已经出过 changelog 漏同步 main 的事故），
不如整体撤出 main，让 main 恒常可发版。打磨好之后再整体合回。

## 撤了什么（main 上被 revert 的四个 PR）

| PR | 内容 |
|---|---|
| PR-A #340 | 拆分核心：schema-registry 启用、流式 Schema 1 / 分页 Schema 2 双身份 |
| PR-B #345 | 新建弹窗「范式 2」解灰为分页文档 + 空白分页模板 |
| PR-C #348 | 页眉+页脚文字 + 分页 meta 关分页保留 |
| PR-E #352 | AI 创作资产 + CLI schemaId |

## 没撤什么（这些仍在 main / 已发版，别误会）

- v0.11.x 已发版的老分页能力：页面设置开分页（Schema 1 可选版式）、V4 分页引擎、@page PDF 导出。
- ui-demo 排版层 U1–U7 + 分页范式入口（demo 是原型场、不随 app 发版，留作移植真相源）。
- 列表 Tab/Shift+Tab 多选缩进（#367）。
- main 新建弹窗的「分页文档」范式改回灰态、文案「开发中」（这是 revert PR 里的正向小改动，不在本分支）。

## 怎么捡回来（复活路径）

1. **首选：revert the revert。** main 上找到撤出 PR 的 merge commit，`git revert -m 1 <该 merge>`，
   即整体恢复四个 PR 的代码，再把本分支与 main 的漂移补齐。
2. 或从本分支 cherry-pick / 对照重放。四个原始 merge：
   #340 `77d6ce7` / #345 `98f2b02` / #348 `3f6743f` / #352 `76e1ee8`。
3. 复活前先把 main 合进本分支解一次冲突（本分支会随 main 前进而过时；隔段时间做一次 merge main 保鲜）。

复活的验收基线：`e2e/paged.spec.js`（Schema 2 版）+ `e2e/sidebar.spec.js` 范式轨三测 全绿。

## 复活前还欠的活（当时的账）

- 标准化排版层（ui-demo U1–U7：五预设/中西字体/页面设置三分区）移植进真 app——尚无实施计划。
- PR-D #350（ui-demo 页眉页脚镜像）已转 draft，随本线复活一起收口。
- 页眉页脚视觉参数（字号/位置/居左）待 Wendi 真机验收，两侧一起调。
