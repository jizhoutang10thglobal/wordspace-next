# 修复方案 002:点标签页时文件树不再跳走(reveal 改为不滚动、只高亮)

- 日期:2026-07-14 · 报告人:Wendi(v0.8.0,视频实录)· 根因调查:Claude(已闭合)
- 优先级:P2(高频交互的视口跳动,体验刺眼)
- 状态:待实现。**本文档只是方案,修复由执行 AI 完成。**
- ⚠️ **这是产品口径反转**:「点标签自动展开定位」正是 Wendi 本人 2026-07-03 提的 F6-① 需求(e2e 注释可查)。现在 Wendi 要求改成「不跳、留在原处、可见时高亮」。PR 描述里必须写明反转,防止将来有人当 bug 修回去。

## 公共约束(动手前必读)

- **从 origin/main 开新 worktree**:`git worktree add <目录> origin/main -b fix/tab-click-no-reveal`。本文 file:line 锚点已在 origin/main(b19e382,v0.8.3)核实。
- 一 bug 一 PR,base=main;**同一 PR 更新 `docs/features/workspace-file-tree.md`**(铁律)。
- push/PR 用 `jizhoutang10thglobal` 账号(参照 `.claude/skills/remember-global/SKILL.md` 的 token 注入命令);CI required = `test`+`e2e`,BEHIND 先 `gh pr update-branch`;不自合 PR。
- **本 PR 动 `src/renderer/sidebar.js`(共享核心)**:开发迭代跑 `npx playwright test e2e/tabs.spec.js`,推前本地全量 `npm run test:e2e:dot` 兜底(跨文件回归藏得深)。
- 变异自检:先 commit 再变异;翻红+还原翻绿才算门有牙。
- 手测:唯一 `WS2_USERDATA`,按 PID 树杀,禁 `pkill electron`。

## 症状与证据

视频 15-29 秒:Wendi 点侧栏「标签页」区的 `[finalised] The UAE…` 标签,下方文件树自动把 `中国项目-项目执行/供应商资料/具体项目/ODA (YAP)/01…` 逐级展开并滚动定位到文件,整个侧栏视口跳走。Wendi 要求:**不要跳,留在原处;该文件在树里的位置可以高亮**。

## 根因链(已确认)

1. 标签区(#sb-pinned/#sb-tabs)和文件树(#sb-tree)是**同一个滚动容器 `#sb-body`** 的直接子节点(`src/renderer/index.html`,`.sb-body{overflow-y:auto}` 在 `shell.css`)。树内任何 `scrollIntoView` 都会滚动整个侧栏,把标签区一起顶走。
2. 点标签入口:`tabRow()` 里 `row.onclick = () => openTabRow(entry)`(`src/renderer/sidebar.js:1766`)→ `openTabRow(entry, reveal = true)`(`:1663`)默认 reveal。
3. reveal 的实现 = `expandToFile(rootId, rel)`(`:1644-1657`):逐级删父文件夹的 collapsed(→`renderRoot` 重建、树增高)+ 对目标行 `scrollIntoView({block:'nearest'})`(`:1656`,**全树唯一的滚动调用点**)。两条触发路径(注释 `:1658-1662` 写得很清楚):①`openTabRow` 内直接调(`:1688`,覆盖「点的正是已载入文档」时 openDoc 短路的情形)②`openNode→openDoc→onOpen` 里那次(`:2344-2367` 一带消费)。
4. **现成抑制机制**:`suppressRevealOnce`(`:22` 声明,`:1686` 置位,`:2347-2348` 消费)——Colin 2026-07-09 为「关标签回落不滚树」加的,`openTabRow(e, false)` 时两条路径都被抑制。且 `highlightActive()`(`:1182`)在 reveal 开关**之外**总是执行:行已渲染(祖先展开)就加 `is-active`,没渲染就静默落空。**「不滚只高亮已展开行」的语义已经存在,只差把点标签入口接上。**

## 目标行为(新契约)

- 点「标签页」区或「置顶」区的一行:激活该文档(编辑器切换照旧),**文件树不展开、不滚动**;若该文件行当前已在 DOM(祖先文件夹本来就展开着),`is-active` 高亮照常刷新。
- 文件折叠在深层时:不高亮、不移动(行不存在,无从高亮——与 Wendi「如果没有就算了」的口径一致;在 PR 描述里点名这个边界,让 Wendi 确认)。
- **不变**:关标签回落(已是 false)、Ctrl+Tab 循环切换(`:2264`,已是 false)、外部打开/Finder 双击/命令面板 F6/存盘定位(onOpen 及各自调用点,仍 reveal)、从树里点文件(本来就几乎无位移)。

## 实现单元

### U1 · 一行改动

`src/renderer/sidebar.js:1766`:`row.onclick = () => openTabRow(entry)` → `row.onclick = () => openTabRow(entry, false)`。

- `tabRow(entry, zone)` 同时渲染置顶区和标签页区 → 两区点击行为一起变(一致性,符合 Wendi 口径)。
- **其余 `openTabRow` 调用点一个都不动**(`:264`/`:281` rebase 重激活、`:1338` 关标签回落、`:1636` 冷启动恢复激活、`:2246` 外部删除回落、`:2264`/`:2271` 循环切换、`:2284`)。改之前 `grep -n "openTabRow(" src/renderer/sidebar.js` 对照这份清单,确认没有多改。
- 注释同步:`:1658` 起那段「reveal=true(默认,点标签)」的注释要改写——默认语义变了(点标签不再 reveal),把 F6-① → 2026-07-14 反转的来龙去脉写进注释,这是防止回修的第一道防线。

### U2 · e2e 改写(必做,否则 CI 红)

`e2e/tabs.spec.js:138-147` 的 UX4 用例锁着旧行为(点标签 → 断言文件行重新可见),**必须改写**,借 `:209`「关标签不滚树」用例的断言范式:

```
test('UX4v2(2026-07-14 Wendi 反转 F6-①):点标签不展开树、不滚动;已展开时只高亮', ...)
  case A(折叠):展开"数据"→开 b.html→折叠"数据"→点 b.html 标签
    → expect .sb-file[data-rel="数据/b.html"] toHaveCount(0)   // 没展开(变异敏感的主断言)
    → expect 标签行 toHaveClass(/is-active/)                    // 文档确实激活了
  case B(已展开):展开"数据"→点 b.html 标签
    → expect .sb-file[data-rel="数据/b.html"] toHaveClass(/is-active/) // 高亮仍在
```

- 若 fixture 树行数足够溢出滚动容器,加一道 `#sb-body.scrollTop` 前后不变的数值断言(更强);行数不够溢出时别加(scrollTop 恒 0 = 哑断言,S4 教训:能想出「行为坏了断言还过」的情形就是弱门)。
- `:209` 关标签用例、`multi-root.spec.js` 的 reveal 相关用例(外部打开路径)不该动、必须保持绿——它们锁的是「不变」清单。

## 测试要求

1. 定向:`npx playwright test e2e/tabs.spec.js` 全绿。
2. **变异自检**(先 commit):把 U1 改回 `openTabRow(entry)` → UX4v2 的 case A 必须翻红;还原翻绿。
3. 全量兜底:`npm run test:e2e:dot`(sidebar.js 是共享核心)。
4. 手测清单(宿主):深层文件开成标签 → 折叠所有文件夹 → 点标签:树纹丝不动、编辑器切换;展开其文件夹后再点:行高亮;命令面板 F6 搜该文件:**仍然**展开定位(未被误伤);关标签回落:不滚(既有行为)。

## 验收标准

- [ ] U1 一行 + 注释改写;调用点清单核对无多改。
- [ ] UX4 改写为 UX4v2,`tabs.spec.js` 全绿;变异红/绿闭环;全量 e2e:dot 绿。
- [ ] `docs/features/workspace-file-tree.md` 新增「标签点击与树定位」小节:三类入口的 reveal 口径表(点标签/置顶=否,关标签回落/循环切换=否(既有),外部打开/命令面板/存盘定位=是)+ 记录 2026-07-14 反转 F6-① 的决策沿革。
- [ ] PR 描述:写明产品反转 + 「折叠时不高亮」边界请 Wendi 确认。
