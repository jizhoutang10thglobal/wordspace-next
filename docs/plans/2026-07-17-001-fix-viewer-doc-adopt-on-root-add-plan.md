# fix: viewer 态文档在工作区出现时收编进标签系统(Wendi/Colin 2026-07-17 反馈的残留半边)

> status: active · origin: Slack Wendi/Colin 2026-07-17 反馈 + 本日 ce-debug 真机诊断(冷开/warm 两路径复现,锚点全核于 main@860eccf) · 日期 2026-07-17
>
> **与 PR #253 的关系(先读这段)**:同一条用户反馈拆成两个洞。①「外部**标签**(abs 身份+↗)在树到货时收编」= #253 已修合 main(mergeExternalDupes 挂四个树到货点+loadTabs 启动自愈,Wendi 的「↗ 不消失」属于这半,她装下个版本即愈)。②本 plan 修**另一半**:无工作区(0 根)时打开的文件走单文件 viewer 态、**从未进过 tabState**,之后添加文件夹时收编引擎对它视而不见——文档游离在标签系统外(树行高亮、编辑区开着,标签区却写「没有打开的标签」),且树里点同一文件也救不回(同文档早退守卫短路)。Colin 1:27 PM 截图 = 这半。

## 症状与根因链(真机实测,main@860eccf)

复现:0 根状态打开文件(冷启动双击或 app 开着时双击,实测两路径行为一致)→ 添加该文件所在文件夹。

1. 0 根打开文件 → 单文件 viewer 态:侧栏不挂,文档只写进 shell 的 `docPath`,**不建标签**——`src/renderer/sidebar.js` `openTabFromAbs`(≈:2677)的守卫是故意的(「单文件模式:不建看不见的幽灵标签」),`src/renderer/shell.js`(≈:897-899)同款分支。这个设计**保留**(侧栏藏着时标签没意义)。
2. 添加文件夹 → 侧栏挂载、树到货 → `mergeExternalDupes`(`sidebar.js` ≈:500-522)只扫 `tabState.entries` 里的 abs 身份条目,**viewer 文档不在 tabState** → 空转。
3. 结果:树行高亮(树认得 `docPath`)但标签区空;持久化 `workspace.json` 的 tabs 也为空(重启后文档彻底丢出视野)。
4. 树里点该文件也救不回:`openNode`(`sidebar.js` ≈:1487)→ `openDoc(abs)` → **同文档早退守卫**(`shell.js` ≈:855 `p === docPath` 直接 return)→ `onOpen` 永不触发,标签依旧不建(真机实测:点击后标签数仍为 0)。

## 公共约束(执行者必读)

- 从 **origin/main** 开新 worktree(分支建议 `fix/viewer-doc-adopt`),别在共享目录干活。push/PR 用 `jizhoutang10thglobal` token(CTlandu 403)。**一 bug 一 PR**;同 PR 更新对应 feature spec(铁律)。
- CI required = test+e2e;PR BEHIND 先 `gh pr update-branch`。开发迭代只跑受影响 spec(`npx playwright test e2e/tabs.spec.js --reporter=dot`);本 fix 动 sidebar.js/shell.js 共享核心,**推 PR 前本地 `npm run test:e2e:dot` 全量兜底**(CLAUDE.md 例外条款命中)。
- 变异自检:**先 commit 再变异**。手测 Electron:唯一 `WS2_USERDATA`、按 PID 树杀,严禁 `pkill electron`。
- e2e 现成 seam:`WS2_OPEN_FILE`(仿 Finder 双击冷启动,`main.js` ≈:458)、warm 路径用 `electronApp.evaluate` 对 `app.emit('open-file', {preventDefault(){}}, p)`、`WS2_FOLDER_IN`+菜单「打开文件夹」(`ipc.js` ≈:620)。#253 在 `e2e/tabs.spec.js` 加的「外部标签收编」两条测试是直接先例(含 launch/teardown 范式)。

## Key Technical Decisions

- **KD1 收编时机 = 复用 #253 的全部挂点**:四个树到货点(`loadRootTree`/`loadLazyTop`/`loadDirChildren`/`adoptRoot`)+ `loadTabs` 尾,在每处 `mergeExternalDupes` 之后(或其函数末尾内联,实现者定)追加 viewer 收编。不另设「0→1 根」特判——树到货是更通用的正确时机,天然覆盖 lazy 根/后加根/展开深层命中等场景,且与 #253 的心智模型统一(「引擎跑到哪,收编就到哪」)。
- **KD2 树外文件也收编,身份=abs 外部标签(↗)**:添加的文件夹不含当前文档时,收编成 abs 身份外部标签——与现行「工作区存在时打开根外文件」(`openTabFromAbs` 的 rel=null 分支)完全一致。原则:**侧栏一旦在场,任何打开中的真文档必须以标签形态可见**;「viewer 无标签」只在 0 根(侧栏藏着)时合法。
- **KD3 纯身份登记,绝不动内容,且只在文档面可见时收编**(doc review 对抗员+可行性员同抓的 P1,已裁定):收编只改 tabState(建 entry、`open:true`、`activeRel` 指向它)+ `persistTabs()` + `renderZones()`,**不 reload 文档、不触碰编辑器/自动保存/dirty**;并且**引擎入口先判「当前激活面是不是文档」——web/temp 标签激活时(`window.__webIsActive()` 或 activeRel 为 web/temp key)整个收编跳过**。理由:①WS2Tabs.openEntry 无条件切 activeRel(`src/lib/tabs.js` ≈:69-76),web view 挂屏时抢激活=「标签栏显示文档 is-active、屏幕显示网页,⌘W/⌘S/地址栏作用到看不见的标签」——本仓为这类状态劈开修过两轮(SH-4/浏览器 P1-2),不再造;②跳过(而非「登记但不激活」)还结构性消灭「用户关掉收编标签后被下一次树到货复活」的循环——文档面不可见时引擎不跑,重入统一靠 KD4 兜底(用户把文档带回前台/树里点它,那是**有意重建**)。Wendi/Colin 的复现场景(正看着文档时添加文件夹)不受影响,照常收编+激活。*此为 plan 默认语义,Colin review 时可改(见 Open questions)。*
- **KD4 同文档早退守卫加兜底带子**(防御第二层):`shell.js` `openDoc` 的 `p === docPath` 早退分支,在 return 前确保当前文档已有 entry(无则经 `__sbHooks.onOpen(docPath)` 补建——onOpen 本就幂等地走建标签漏斗)。主修靠 KD1;这层保证即使将来出现新的「viewer 无 entry」路径,用户点一下树也能自愈,也是 KD3 跳过语义下的官方重入通道。
- **KD5 temp/网页标签排除;查看器态纳入收编(Colin 2026-07-17 拍板)**:temp/web 沿用现有判定(`isTempEntry`/`isWebKey`);读当前编辑器文档用现成 seam `window.__shellDocPath()`(shell.js ≈:939)。实现时确认它对 tempDoc 返回什么——若返回 null/非路径则天然豁免,否则显式排除。**PDF/图片查看器态(showViewer)`docPath` 恒为 null**(shell.js ≈:533 显式清)——**Colin 拍板一起修**:shell 新增只读 seam(如 `window.__shellViewerFile()` 返回 `{abs, kind}` 或 null,showViewer 设、关闭/切走清),引擎取「当前打开面文件」= `__shellDocPath()`(编辑器)?? `__shellViewerFile()`(查看器),同一条收编管线;查看器分支 kind 用 seam 自带的(pdf/img/other),不走扩展名推定。工作区模式下查看器文件本就有标签(openNode→showViewer→onOpen),收编后行为对齐。

## 实现单元

### U1. viewer 文档收编引擎(主修)

- **Goal**:树到货/启动自愈时,若当前 viewer 文档(`__shellDocPath()`)是真文件且 tabState 无对应 entry,建 entry 收编(树内=rel 身份,树外=abs ↗ 身份),`open:true` + 激活,持久化并重绘。
- **Dependencies**:无。
- **Files**:`src/renderer/sidebar.js`(引擎+挂点);测试 `e2e/tabs.spec.js`。
- **Approach**:小函数(如 `adoptViewerDoc()`)挂在 KD1 列的全部 `mergeExternalDupes` 调用点之后(或并入其末尾)。流程:**KD3 门(web/temp 激活 → return)** → 取 `__shellDocPath()` → 排除 null/temp/web → 已有 entry(abs 直配 **或** `findNodeByAbs` 出的 `rootId:rel` 命中)→ no-op → 否则 `findNodeByAbs(abs)` 命中 → rel entry(kind 取 node.kind);miss → **`window.ws2.pathExists(abs)` 守卫**(文件已被外删就别收编死标签;loadTabs 外部 entry 校验同款)→ abs 外部 entry,**kind 按扩展名推定 `isMdPath(abs) ? 'md' : 'html'`**(docPath 只可能来自 openDoc、只吃 html/md,showViewer 态恒 null——绝不能回填 'other',否则 openTabRow 按 kind 分发会把这条 ↗ 标签路由到「用默认应用打开」卡片而非编辑器,sidebar.js ≈:2022);`activeRel` 指向新 key;`persistTabs()`+`renderZones()`。
- **已知形状(继承 #253,不在本轮修)**:`findNodeByAbs` 是纯字符串比对(≈:1546),软链路径对不上/lazy 深层未加载时会先收成 abs ↗ 外部标签——**这不是死态:两引擎组合自愈**,该层真正加载时 #253 的 `mergeExternalDupes` 会把这条 abs entry 自动并进 rel 身份。刻意不换成 `classifyFile`(realpath 归一)路线:rel 身份指向未加载 lazy 层时点击反而无响应,#253 引擎同为此形状,保持一致。watcher 驱动的树刷新(refreshRoot 等)不在挂点集合,同 #253 形状,可接受。
- **Patterns to follow**:`mergeExternalDupes`(sidebar.js ≈:500-522,身份改写+激活跟随+persist 的范式)、`openTabFromAbs`(≈:2668-2686,rel/abs 两分支建 entry 的范式)、loadTabs 的外部 entry `pathExists` 校验。
- **Test scenarios**(挨着 #253 的「外部标签收编」节写):
  1. 冷开无根(`WS2_OPEN_FILE`)→ 菜单添加其所在文件夹(`WS2_FOLDER_IN`)→ 标签区出现该文件、`is-active`、**无** `sb-tab-ext`、zone count=1(= 今日诊断复现脚本的失败样例,修前红)。
  2. warm 路径(`app.emit('open-file',…)`)同 1。
  3. 打开的文件在**根外**(添加别的文件夹)→ 收编成外部标签:标签在、**带** `sb-tab-ext`;**再点这条 ↗ 标签 → 回到编辑器**(kind 推定正确,不是「用默认应用打开」卡片)。
  4. dirty 保全:viewer 里往 iframe 注入 sentinel(改动内容)→ 添加文件夹 → 收编后 sentinel 仍在(断言编辑器没被 reload)。⚠ dirty 标志断言与 1.2s 自动保存有天然竞态——主断言放 sentinel 未被 reload,dirty 断言要么抢在窗口内要么略去。
  5. 去重:收编发生后再触发一次树到货(如添加第二个根)→ 标签数不变、不翻第二条。
  6. 重启恢复:收编后重启(同 `WS2_USERDATA`)→ rel 标签与激活态恢复(persistTabs 生效)。
  8. **KD3 门(正向)**:0 根 viewer 开着文档 → 开一个网页标签(web 激活,web 标签不依赖工作区)→ 添加文件夹 → **不收编**:标签区无该文档、网页标签仍 is-active、web view 不被顶走;随后在树里点该文档 → U2 兜底建 entry(有意重入)。
  9. **不复活**:收编 → 开网页标签 → 后台 × 关掉该文档标签 → 再触发一次树到货(加第二根)→ 标签数不变(KD3 门挡住重收编)。
  10. **查看器纳入(拍板②)**:0 根冷开一个 PDF(`WS2_OPEN_FILE` 指 .pdf)→ 添加其所在文件夹 → 标签区出现该 PDF(kind 正确,点击进查看器不是编辑器)。
- **Verification**:场景 1(修前红/修后绿)= 变异证据的正向;变异自检=注释掉挂点调用 → 场景 1 翻红(先 commit 再变异)。

### U2. 同文档早退守卫兜底(防御层)

- **Goal**:`openDoc` 同文档早退分支在 return 前补建缺失 entry——树点击可自愈。
- **Dependencies**:U1(复用其判定;单独也可落,但测试要 U1 的场景构造)。
- **Files**:`src/renderer/shell.js`(≈:855 分支);测试 `e2e/tabs.spec.js`。
- **Approach**:该分支现只在 `wasWebActive` 时调 `onOpen`;改为「entry 缺失时也调 `onOpen(docPath)`」(onOpen 幂等,建标签+高亮走既有漏斗)。判定「entry 是否存在」经 `__sbHooks` 暴露轻查询(如 `hasTabFor(abs)`)——**必须双域判定:abs 直配 *或* `findNodeByAbs(abs)`→`rootId:rel` 命中**(rel entry 不带 abs 字段,只查 abs 会对已收编文档误判缺失、重建出第二条——正是本 fix 要杀的「翻倍」)。避免 shell 直接摸 tabState。
- **Test scenarios**:
  7. 兜底:构造「viewer 有文档、tabState 无 entry」态——**定死构造方式:新增仅测试用的删 entry seam**(如 `__sbHooks.dropEntryForTest(key)`,包一层现有 removeEntry)。⚠ 别走「closeTab 关掉再看」路线:实测 finishClose 无相邻 entry 时直接 `__shellCloseDoc()` 清 docPath,该态到不了。删 entry 后点树里同一文件 → 标签重新出现。修前(main@860eccf)实测:点击后标签数为 0。
- **Verification**:场景 7 修前红/修后绿。

### U3. spec 契约 + 账本(同 PR,铁律)

- **Goal**:行为契约落 spec,防将来漂移/被"修回去"。
- **Dependencies**:U1/U2 定稿。
- **Files**:`docs/features/workspace-file-tree.md`(#253 已建的「外部标签收编」节,追加 viewer 收编契约:**侧栏在场 ⇒ 任何打开中的真文件(编辑器 html/md + 查看器 PDF/图片)必有标签**(Colin 2026-07-17 拍板纳入查看器);web/temp 激活时收编跳过、树点重入=有意重建;0 根 viewer 无标签仍是设计而非 bug;**先后打开多个只收编当前显示的那个(单槽)——现状语义,写明防止将来被当 bug 报**)。
- **Test expectation: none** —— 纯文档;门在 U1/U2 的 e2e。

## Scope boundaries

- **不改** 0 根时 viewer 不建标签的既有设计(幽灵标签守卫保留)。
- **不做** viewer 态本身的跨重启恢复(收编后自然由 tabs 持久化接管;0 根 viewer 关掉即走,现状不变)。
- **不改** 0 根切临时文档清 docPath 的既有行为(此后原 viewer 文档无从收编——前置于本 fix,引擎救不了)。
- **ui-demo 不移植**:mock 恒有工作区、无单文件 viewer 双态,无此 bug(记「真 app 独有,不算漂移」)。
- 多窗口不存在(单窗 app),不设防。

## 已拍板(Colin 2026-07-17,AskUserQuestion)

1. **开工**:按本 plan 实现,一 bug 一 PR。
2. **PDF/图片查看器文件纳入收编**(「一起修」)——KD5 已更新:shell 加只读 `__shellViewerFile()` seam,查看器文件与编辑器文档走同一收编管线;U1 测试场景补查看器一条(场景 10)。
3. **web 标签激活时不冒标签**(「不冒,不打扰」)——KD3 的跳过语义定案。

## 验收

- U1/U2 全部 e2e 场景绿 + 变异自检(先 commit;注释树到货点的 adopt 调用→场景 1 红,还原→绿;**若实现采用了 loadTabs 尾挂点,给它配对应场景+探针**——viewer 的 docPath 不持久化,该挂点是否必要属实现期判断,别留没有门的挂点);
- 定向 `e2e/tabs.spec.js` 全绿 → 本地 `npm run test:e2e:dot` 全量兜底(动了 shell/sidebar 共享核心)→ 推 PR 交 CI(test+e2e required);
- 真机手验一遍原始复现(冷开→添加文件夹→标签即现、active、无 ↗;树点不翻倍);
- spec(U3)同 PR;PR 描述引用本 plan 与 #253 的分工。
