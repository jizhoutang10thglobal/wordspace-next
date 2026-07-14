# 修复方案 004:「添加文件夹」卡 4-5 秒零反馈 → 两段式返回 + 加载态

- 日期:2026-07-14 · 报告人:Wendi(v0.8.0:「点了添加桌面文件夹,有四五秒钟的卡,才跳出来,应该有个过渡反应」)· 根因调查:Claude(已闭合)
- 优先级:P2(第一印象型 UX;大文件夹/云盘必现)
- 状态:待实现。**本文档只是方案,修复由执行 AI 完成。**

## 公共约束(动手前必读)

- **从 origin/main 开新 worktree**:`git worktree add <目录> origin/main -b fix/add-folder-loading`。本文 file:line 锚点已在 origin/main(b19e382,v0.8.3)核实。
- 一 bug 一 PR,base=main;**同一 PR 更新 `docs/features/workspace-file-tree.md`**(铁律)。
- push/PR 用 `jizhoutang10thglobal` 账号(参照 `.claude/skills/remember-global/SKILL.md`);CI required = `test`+`e2e`,BEHIND 先 `gh pr update-branch`;不自合 PR。
- **本 PR 动 `src/renderer/sidebar.js` + `src/main/ipc.js`(共享核心)**:开发迭代跑 `npx playwright test e2e/multi-root.spec.js e2e/workspace.spec.js e2e/live-tree.spec.js`,推前本地全量 `npm run test:e2e:dot` 兜底。
- 变异自检:先 commit 再变异。手测:唯一 `WS2_USERDATA`,按 PID 树杀,禁 `pkill electron`。

## 症状

点「添加文件夹」选桌面这类大目录后,原生选择框关闭到新根出现在侧栏之间有 4-5 秒**完全无反馈**(无 spinner、无骨架、无任何过渡)。

## 根因链(已确认)

1. `ws-add-folder`(`src/main/ipc.js:457`)的 `'added'` 分支在 return 前 `await workspace.readTree(root.path)`(`ipc.js:497`)——**IPC 回复被整棵树扫完挡住**,renderer 的 `await wsAddFolder()` 期间拿不到任何东西。`'revived'`(失联根复活,`:475`)和 `ws-absorb-confirm`(`:532`)同款。
2. `readTree`(`src/main/workspace.js:104-129`)两笔重活:
   - `walk()`:递归 readdir,**串行深度优先**(for 循环里逐个 await,兄弟目录不并行),无深度/数量上限;
   - **每个文件额外一次 `fs.stat` 取 inode**(`:118-127`,外部改名跟随用)——云盘/慢盘上这步主导耗时(perf-diag 注释自证:「唯一测得的成本是 readTree 随文件数线性涨」)。
3. renderer 侧 `pickFolder`(`src/renderer/sidebar.js:149`)`await window.ws2.wsAddFolder()` 前后**没有任何 loading 状态**。渲染本身不是瓶颈(新根默认全收起,首帧只画顶层行)。
4. 现成可复用:每根单独重读的通道已存在——`wsReadTree(rootId)`(`preload.js:53` → ipc `'ws-read-tree'`),watcher 触发的 `onTreeChanged`(`sidebar.js:2202`)就在用它;perf-diag 已在量每根 readTree 耗时(`ws-diag`,`ipc.js:423`),验证现成。

## 目标行为(新契约)

选完文件夹 → **新根立刻出现在侧栏**(根名 + 「正在读取文件夹…」加载行)→ 扫描完成后加载行原地替换为文件树。任何入口一致(头部按钮/空态按钮/树底「添加文件夹…」行/⋯菜单——它们全部收口在 `pickFolder`,单点改动)。

## 实现单元

### U1(必做)· 两段式添加 + 加载态

**main(`src/main/ipc.js`)**:
- `'added'` 分支(`:497`)改为立即 `return { status: 'added', root: rootInfo(root) }`——**不带 tree**(persistRoots/startRootWatch 照旧,都很快)。
- `'revived'` 分支(`:475`)同款改法。
- `ws-absorb-confirm`(`:532`)同构顺手改;若 rebase 语义牵扯太多就保持原样并在 spec 欠账记一行(执行 AI 自行判断,别为它冒险)。

**renderer(`src/renderer/sidebar.js`)**:
- `pickFolder`(`:149` 一带):`status==='added'` 时先以 `tree:null + loading:true` 建根状态(改 `adoptRoot` 或旁路),立即 `render()` 画出根区 + 加载行;然后 `const t = await window.ws2.wsReadTree(root.id)`:
  - 成功 → 装树(`annotateTree` 同 `onTreeChanged` 的现成写法)、清 loading、`render()`;
  - `null`(根不可达)→ 走现有失联灰态(missing)——**别把 null 当空树**(会触发 reconcile 清标签的老坑,`workspace.js:107-114` 注释就是这个教训)。
- 竞态:扫描期间 watcher 可能对新根发 `ws-tree-changed` → `onTreeChanged` 也去 `wsReadTree`。两者幂等,但要保证:①loading 标志被**任一**先回来的结果清掉;②`onTreeChanged` 对 `loading` 中的根直接 early-return(pending 的那次会带回最新树),避免双份并发读。参考现有 `movingRoots` 引用计数守卫的写法(`sidebar.js:838-839`)。
- 加载行视觉(`shell.css`):一行 `.sb-loading`,淡墨文字「正在读取文件夹…」+ 克制的动效(呼吸式 opacity 即可,别弹跳)。遵守「纸方墨圆」(canonical:`docs/style.md`,动效是一等公民但要安静),`prefers-reduced-motion` 下静止。

**审计点(必须逐一过)**:`wsAddFolder` 返回值的**所有**消费方——`status` 为 `same`/`child`/`parent`/`limit` 的分支不受影响;e2e 里凡「add folder 后立即断言树行存在」的用例(`multi-root.spec.js`/`workspace.spec.js`/`live-tree.spec.js`,配合 `WS2_FOLDER_IN` seam)现在多了一拍异步——逐个跑,必要时把断言改成 `await expect(...).toBeVisible()`(Playwright 自动重试,多数用例天然兼容)。

### U2(可选,单独 PR,别和 U1 混)· 扫描本体提速

Wendi 的诉求 U1 已满足;U2 是锦上添花,先量化再动手:
- 首选:**ino stat 移出关键路径**——`readTree` 先返回不带 ino 的树(首帧),后台 `Promise.all` 回填后经 `ws-tree-changed` 推一次。代价:回填完成前外部改名的标签跟随降级为「删+开」;窗口几秒,可接受。动手前 grep ino 的全部消费方(renderer reconcile/置顶匹配)确认降级面。
- 备选:walk 有界并发(手写并发池,别引依赖)。
- 验证:宿主对同一大文件夹,改前后各跑 `ws-diag` 快照对比 readTree 耗时,数字写进 PR。

## 测试要求

1. **e2e 新用例**(放 `e2e/multi-root.spec.js` 或 `workspace.spec.js`,用现成 `WS2_FOLDER_IN` seam 跳过原生对话框,`ipc.js:455-459`):
   - 需要一个**确定性慢扫描 seam**(竞态 e2e 不赌时序,repo 既有教训):仅非打包态,如 `WS2_SLOW_READTREE_MS` 环境变量让 `readTree` 人为延迟(照 `WS2_FOLDER_IN`/`ipc.js:690` 已有 seam 的先例写,e2e 可经 `electronApp.evaluate` 改 `process.env`);
   - 断言序列:触发添加 → `.sb-loading` 行**可见**且根名已出现 → 等待 → 加载行消失、树行出现;
   - **变异自检**(先 commit):去掉 renderer 的加载行渲染 → 用例翻红;还原翻绿。
2. 存量定向:`npx playwright test e2e/multi-root.spec.js e2e/workspace.spec.js e2e/live-tree.spec.js e2e/cold-start.spec.js` 全绿(add-folder 契约变了,这几个最可能受影响)。
3. 全量兜底:`npm run test:e2e:dot`。
4. 手测(宿主):真实桌面/大文件夹添加——选完立刻见根 + 加载行,数秒后填充;失联场景(选个 U 盘目录后拔盘)不崩、走灰态。

## 验收标准

- [ ] U1 落地:added/revived 两段式;加载行样式合「纸方墨圆」;null 树走失联灰态;onTreeChanged 竞态守卫。
- [ ] 新 e2e 绿 + 变异红/绿闭环;存量定向 + 全量 e2e:dot 绿。
- [ ] `docs/features/workspace-file-tree.md` 新增「添加文件夹的加载反馈」契约(两段式 + 加载行);「欠账」视情况记:absorb 未两段式(若没改)、**冷启动多根恢复仍是全量 await**(`ws-get-workspace`,`ipc.js:564`——同类卡顿的另一个面,本 PR 不动,单独立项)。
- [ ] PR 描述:根因一句话 + ws-diag 耗时数字(改前)佐证 + U2 是否另立 PR 的说明。
