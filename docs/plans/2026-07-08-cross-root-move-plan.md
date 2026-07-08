# 跨文件夹(跨根)移动文件 · v1 便宜档 —— 开发计划

> **给执行者**:本计划自包含,假设你对本仓零上下文。写作时间 2026-07-08,基于 PR #136(feat/app-multi-root,多根工作区)之后的代码形态。
> **前置依赖**:#136 必须先在你的基分支里(合了 main 就从 main 开分支;还没合就 base 到 feat/app-multi-root)。
> **产品拍板(Colin 2026-07-08,不要重新讨论)**:只做「同文件系统 rename 快路径」;真跨盘(EXDEV)不做复制回退,给明确 toast 提示;不做进度 UI、不做取消。

---

## 0. 背景一句话

多根工作区(#136)允许同时打开多个文件夹,但**跨根拖拽文件被禁**(拖过去没反应):当时的理由是两个根可能在不同磁盘上,`fs.rename` 跨文件系统会报 `EXDEV`,完整方案(复制→校验→删原件)要处理中途失败,另立项。本计划做便宜的那一档:**直接试 rename——同一文件系统(绝大多数场景,两个文件夹都在 Macintosh HD 上)瞬间成功;真跨盘报 EXDEV 就 toast 告知,文件原地不动**。判定交给操作系统,自己不猜「是不是同盘」。

一个白捡的简化:**多根有嵌套禁令**(两个根永不重叠,`src/lib/roots.js` classifyRoot 在加根入口拦死),所以「把文件夹移进它自己的子树」这个最恶心的边界在跨根场景**不可能发生**,不用防。(同根内移动的这个防御在 `workspace.movePath` 里已有,别动。)

## 1. 现状地图(改动会碰到的文件)

| 文件 | 现状 | 本计划动不动 |
|---|---|---|
| `src/main/workspace.js` | `movePath(root, relPath, destDirRel)`:同根移动,fs.rename + 目标重名自动去重(uniquify)+ 拒绝移进自己子树;纯函数、root 作参数、有 node:test | **加** `movePathAcross`(不改 movePath) |
| `src/main/ipc.js` | `ws-move` handler `(rootId, relPath, destDirRel)`;根注册表 `rootById(rootId)` 解析路径;安全红线=renderer 永不发根路径、只发 rootId | **加** `ws-move-across` 通道 |
| `src/renderer/preload.js` | `wsMove(rootId, relPath, destDirRel)` | **加** `wsMoveAcross` |
| `src/renderer/sidebar.js` | 拖拽:`dragNode`(树节点,带 `rootId` 字段);目录行 `ondragover/ondrop` 有守卫 `dragNode.rootId !== dir.rootId → return`(两处:目录行 + 根标题行 head.ondragover/ondrop);`doMove(node, destDirRel)` → wsMove + `retargetTabsUnder` + 打开中文档 `__shellRetargetDoc` + `refreshRoot` | **解禁守卫** + **加** `doMoveAcross` |
| `src/lib/tabs.js` | 标签身份 `keyOf = rootId + ':' + rel \|\| abs`;`retargetEntry(state, rootId, oldRel, newRel, …)` 同根改名/移动跟随(撞名合并 open/pinned 取并集);`rebaseRoot(state, from, to, prefix)` 整根换归属(吸收用) | **加** 跨根 retarget 纯函数 |
| `e2e/multi-root.spec.js` | MR-1~10 多根门;`dnd` 合成 DragEvent 技法在 `e2e/sidebar.spec.js` 顶部(驱动真实 ondragstart/ondragover/ondrop 链) | **加** MR-11~13 |

标签/树行的 DOM 身份约定(e2e 选择器靠它):`data-rel` 存裸 rel、`data-root` 存 rootId,两者组合定位。

## 2. 设计

### 2.1 主进程:`workspace.movePathAcross(srcRoot, relPath, destRoot, destDirRel, opts)`

放 `src/main/workspace.js`,与 movePath 并排。逻辑:

1. `assertInsideWorkspace(srcRoot, relPath)` 和 `assertInsideWorkspace(destRoot, destDirRel)` 双侧防逃逸(`src/lib/file-tree.js` 现成)。
2. 目标叶名 = relPath 最后一段;在 destDir 里按**现有 uniquify 逻辑**去重(movePath 里已有同款,抽成共享 helper 或照抄——绝不覆盖占位文件,同根移动的既有行为)。
3. `await (opts?.renameFn || fsp.rename)(srcAbs, destAbs)`。
   - **`renameFn` 可注入是测试 seam**(照 `deletePath` 注入 `trashItem` 的既有先例):单测里注入一个抛 `{code:'EXDEV'}` 的假 rename,才能确定性测跨盘分支(真单测环境两个 tmp 目录永远同盘,制造不出真 EXDEV)。
4. 成功返回 `{ rel: destRel, abs: destAbs }`(destRel = 目标根内相对路径,'/'分隔,同 movePath 口径)。
5. `EXDEV` 错误**不吞**:向上抛或返回带标记——**定案:抛原错误,ipc 层按 code 分流**(下条)。其他错误(EACCES/ENOENT)也原样抛,renderer 有统一 catch+toast。

文件和文件夹都走同一条(rename 对目录同样原子)。

### 2.2 IPC:`ws-move-across`

```js
ipcMain.handle('ws-move-across', async (_e, fromRootId, relPath, toRootId, destDirRel) => {
  try {
    return await workspace.movePathAcross(rootById(fromRootId), relPath, rootById(toRootId), destDirRel);
  } catch (err) {
    if (err && err.code === 'EXDEV') return { crossDevice: true }; // 跨文件系统:结构化返回,不当异常
    throw err;
  }
});
```

- `rootById` 对未注册/失联(missing)根抛错——失联根的树不渲染、拖不出节点,正常到不了,但守卫免费。
- **别改 `ws-move`**:同根路径零改动,存量 e2e 不动。
- preload:`wsMoveAcross: (fromRootId, relPath, toRootId, destDirRel) => ipcRenderer.invoke('ws-move-across', …)`。
- **测试 seam `WS2_FORCE_EXDEV`**(e2e 用,仅 `!app.isPackaged` 生效,照 WS2_PDF_OUT/WS2_FOLDER_IN 先例):设了就让 handler 在调 movePathAcross 之前直接返回 `{ crossDevice: true }`——e2e 没法真造两个文件系统,这是唯一确定性触发 toast 分支的路。**打包态必须无效**(生产进程继承到该 env 不能改行为)。

### 2.3 纯逻辑:`lib/tabs.js` 加 `retargetSubtreeAcross`

```
retargetSubtreeAcross(state, fromRootId, oldRel, toRootId, newRel, isDir)
```

- 文件(isDir=false):命中 `e.rootId===fromRootId && e.rel===oldRel` 的 entry → 换成 `{rootId: toRootId, rel: newRel}`,title 取 newRel 叶名,open/pinned 保持。
- 目录(isDir=true):命中 `e.rootId===fromRootId && (e.rel===oldRel || e.rel.startsWith(oldRel+'/'))` 的每条 → newRel 前缀替换 + 换 rootId。
- **撞 key**(目标根已有同位置 entry)→ open/pinned 取并集合并、只留一条(语义照抄 `retargetEntry` 的合并段/`rebaseRoot` 的撞 key 段,两处现成参考)。
- activeRel 是被移走的 key → 跟随换成新 key。
- 外部标签(无 rel)、临时文档(`temp:` 前缀 abs)、别的根的 entries **全程不动**(按 rootId 过滤天然隔离,写单测锁死)。
- 双导出 IIFE 里加进 API 表(module.exports + window.WS2Tabs 两侧都要)。

### 2.4 renderer:解禁 + `doMoveAcross`

`src/renderer/sidebar.js`:

1. **解禁两处拖拽守卫**:目录行和根标题行的 `ondragover/ondrop` 里 `dragNode.rootId !== …` 的 early-return 删掉(根标题行那处注意保留「根重排拖拽」分支的判断顺序——dragRootId 分支在前,别动)。同根落同目录的 no-op 判断(`parentDirOf(dragNode.rel) === dir.rel`)只对同根有意义,跨根时跳过该判断。
2. 落点回调分流:`dragNode.rootId === 目标rootId ? doMove(dragNode, destDirRel) : doMoveAcross(dragNode, 目标rootId, destDirRel)`。
3. `doMoveAcross(node, toRootId, destDirRel)`(照 doMove 的骨架):

```
- wasOpen / openUnderDir 判定(移动的是打开中文档或其祖先目录,doMove/commitRenameOp 里现成模式)
- let r; try { r = await wsMoveAcross(node.rootId, node.rel, toRootId, destDirRel) }
  catch (e) { showToast('移动失败：' + shortErr(e)); await refreshRoot(node.rootId); return }
- if (r.crossDevice) { showToast('这两个文件夹在不同的磁盘上，暂不支持直接移动——先在访达里复制过去'); return }
- 标签跟随: tabState = WS2Tabs.retargetSubtreeAcross(tabState, node.rootId, node.rel, toRootId, r.rel, node.isDir); persistTabs()
- collapsed 键迁移(目录时): 旧前缀 colKey(node.rootId, node.rel…) → colKey(toRootId, r.rel…)(照 commitRenameOp 里 SB-12 那段的前缀迁移写法,多换一个 rootId)
- 打开中文档重指向: wasOpen → __shellRetargetDoc(新abs, 新叶名); openUnderDir → 前缀替换 abs 再 retarget(照 commitRenameOp)
- await refreshRoot(node.rootId); await refreshRoot(toRootId)  // 两边树都刷
- 高亮/展开: 若移动的正是激活标签对应文件 → expandToFile(toRootId, 新rel)
```

4. **watcher 一致性(不用写代码,写进 e2e 验证)**:移动后两根的 watcher 都会发 tree-changed → `onTreeChanged(rootId)` 各自 reconcile。源根 reconcile 时被移走的 entries 已换成 toRootId,按 rootId 过滤天然跳过、不会被误删;目标根 reconcile 时 rel 已在新树 relSet 里。这是既有机制自然成立的不变式,MR-11 要断言「移动后触发一次树同步(dispatch focus),标签还在」。

### 2.5 明确不做(防 review 误判遗漏)

跨盘复制回退 / 进度条 / 取消 / 多选批量移动 / 从访达往侧栏拖入(OS→app 的 drop 是另一个 feature)/ 拖到失联根(树都不渲染,天然不可达)。

## 3. 测试计划

### 3.1 单测(node:test)

`test/tabs.test.js` 追加(现有测试风格:f(rel,kind,rootId) helper、invariant() 守去重不变式):
- 跨根移动文件:身份换根换 rel,open/pinned/激活跟随;
- 跨根移动目录:子树整体前缀替换换根;
- 撞 key 合并:目标根已有同位置 entry → 并集、唯一、invariant 过;
- 隔离:外部 abs 标签、temp 标签、第三个根的 entries 纹丝不动。

`test/workspace.test.js` 追加:
- movePathAcross 真移动(两个 tmp 根,文件+目录,断言磁盘真相);
- 目标重名 → 去重不覆盖(「x 2.html」口径同 movePath);
- 注入 renameFn 抛 EXDEV → 原样抛出、**源文件纹丝不动**;
- 双侧 assertInsideWorkspace:relPath 带 `../` 越界 → 拒。

### 3.2 e2e(`e2e/multi-root.spec.js` 追加,复用文件顶部 launch/openTwoRoots/fileRow/tabRow helpers + sidebar.spec 的合成 DragEvent 技法)

- **MR-11 跨根移动文件**:A 根开着并置顶一个文件 → 拖到 B 根的目录行 → 断言:磁盘真相(fs.stat 源没了/目标有了)、标签 data-root/data-rel 换新且 pinned 保持、编辑器面包屑跟随(若是打开中文档)、dispatch focus 触发树同步后标签仍在(watcher 不变式)。
- **MR-12 跨根移动目录**:目录含打开的子文件 → 拖到 B 根标题行(=落到 B 顶层) → 子树标签全跟随;目标重名目录 → 去重不覆盖。
- **MR-13 EXDEV 负路径(变异敏感门)**:`WS2_FORCE_EXDEV=1` 启动 → 拖 → 断言 toast 文案出现 + **源文件还在原地** + 标签没变。这条门顺带锁「crossDevice 分流被删掉/写错时必翻红」。
- 断言口径(CLAUDE.md S4):锚磁盘真相和 computed 状态,不查 JS 直接设的 class。

### 3.3 变异自检(合并前手动跑一轮,两条铁律)

1. **先 commit 再变异**——变异后 `git checkout --` 还原会把未提交的修复一起冲掉(本仓已实踩两次)。
2. 变异点:把 doMoveAcross 里的 retargetSubtreeAcross 调用删掉 → MR-11 必须红;把 crossDevice 分流删掉 → MR-13 必须红。还原后全绿才算门有牙。**fixture 注意**:别让两个根的路径字符串长度相同之类的巧合让断言碰巧通过(MR-10 踩过:软链名与真名同长度,字面切片碰巧算对,门变哑)。

## 4. 环境与流程纪律(本仓惯例,照做别问)

- **自己开独立 worktree**(并行 session 共享目录会互相劫持工作树):`git worktree add ../wordspace-next-xmove -b feat/cross-root-move <base>`;node_modules 用软链:`ln -s <主仓>/node_modules <worktree>/node_modules`。
- 跑 electron 用 `./node_modules/.bin/electron`(npx 会当场下载新版);e2e/冒烟一律 `WS2_USERDATA` 指临时目录(别撞用户正式版的单实例锁);**绝不 `pkill electron` 通杀**(Colin 桌面开着正式版),要杀按 `lsof -t +D <userData目录>` 找 PID。
- renderer 有严格 CSP:改样式只能单 CSSOM property setter(`el.style.prop=`),`setAttribute('style')`/cssText 会被拦。
- 勤 commit(并行 session 凭 git log 对齐);push/开 PR 前 `gh auth switch --user jizhoutang10thglobal`,用完切回 CTlandu。
- 全绿标准:`npm test`(单测)+ `npm run test:e2e`(宿主全量)+ CI(required checks:test + e2e,Linux/xvfb 真跑)。
- **合并前对抗审查**:标签状态机每次延展都要跑一轮对抗审计(本仓铁律,doc-tabs/multiroot 两次都抓出过 P1)。重点攻击面:retargetSubtreeAcross 与 reconcile/undo/absorb 的组合、移动打开中文档的编辑器状态、EXDEV 分支后的状态一致性。

## 5. 验收清单(DoD)

- [ ] 同盘跨根拖文件/文件夹:磁盘真移动、标签/置顶/激活/collapsed/编辑器全跟随
- [ ] 跨盘(seam 模拟):toast 明确提示、任何状态都不变
- [ ] 目标重名:去重不覆盖
- [ ] 单测新增全绿 + 存量 443+ 不回归;e2e 新增 3 门全绿 + 存量 222+ 不回归;CI 绿
- [ ] 变异自检:两处变异各自翻红、还原全绿
- [ ] 对抗审查 confirmed findings 全部整改或书面 defer
- [ ] PR 描述写清:只做同盘档、跨盘提示的产品拍板出处(Colin 2026-07-08)
