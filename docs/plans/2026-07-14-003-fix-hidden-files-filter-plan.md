# 修复方案 003:隐藏文件出现在文件树(扩展名字过滤,覆盖 Windows/云盘垃圾文件)

- 日期:2026-07-14 · 报告人:Wendi(v0.8.0,文字反馈:「现在的隐藏文件是在 wordspace 显示的,按说不应该显示」)· 根因调查:Claude
- 优先级:P2
- 状态:待实现。**本文档只是方案,修复由执行 AI 完成。**
- ⚠️ 根因是**推断**(证据链强但缺 Wendi 的具体文件名),方案含确认步骤;名字过滤扩展本身无论如何都该做(安全、无副作用)。

## 公共约束(动手前必读)

- **从 origin/main 开新 worktree**:`git worktree add <目录> origin/main -b fix/hidden-junk-files`。本文 file:line 锚点已在 origin/main(b19e382,v0.8.3)核实。
- 一 bug 一 PR,base=main;**同一 PR 更新 `docs/features/workspace-file-tree.md`**(铁律,这个 spec 里「隐藏文件」条目就是本次要改的契约)。
- push/PR 用 `jizhoutang10thglobal` 账号(参照 `.claude/skills/remember-global/SKILL.md`);CI required = `test`+`e2e`,BEHIND 先 `gh pr update-branch`;不自合 PR。
- 单测 = `npm test`(node --test)。本 PR 不动 renderer 共享核心,不需要全量 e2e 本地跑。
- 变异自检:先 commit 再变异。

## 症状与背景

Wendi 说文件树里显示了「隐藏文件」。她的工作区根在 `/Users/fwd/Library/CloudStorage/…`(公司共享云盘,视频可见),team 里有 Windows 同事,文件夹里大量 Office 文档(.docx/.pdf)。

## 根因链(推断,证据如下)

1. 文件树的**所有**生成路径(初扫/watcher 重读/窗口聚焦兜底/文件操作后刷新)全部收口在 `walk()` + `skip()`(`src/main/workspace.js:35,72-75`),没有任何绕过 skip 的乐观插入(renderer 从不自己 readdir,已逐点核实)。
2. `skip()` 现状:`name.startsWith('.') || name.includes('.ws2tmp') || IGNORE.has(name)`——**dotfile 一直被过滤**,且有单测锁着(`test/workspace.test.js:232`「隐藏/临时文件不进树」,断言 .DS_Store/.hidden.md/.obsidian 不进树)。所以「显示 .DS_Store」这个字面 bug 在现有代码上**无法复现**。
3. 但 `skip()` 纯按「点开头」判,放过了整类**非点号的隐藏文件**——恰好是共享云盘 + Windows 同事场景的高发物:
   - `desktop.ini` / `Thumbs.db` / `ehthumbs.db`:Windows 生成,靠 FILE_ATTRIBUTE_HIDDEN 隐藏;同步到 macOS 后属性丢失、现形;
   - `~$xxx.docx`(Office 打开文档时的锁文件):Windows 上隐藏,同步过来现形;
   - `Icon\r`(macOS 自定义文件夹图标,文件名是 "Icon"+回车):靠 UF_HIDDEN flag 隐藏,Node 的 `fs.stat` **读不到 BSD flags**,按名字也不带点;
   - `$RECYCLE.BIN` / `System Volume Information`(外置盘/同步盘残留)。
4. 已知限制:任意文件上的 macOS `chflags hidden`(UF_HIDDEN)按名字判不出来,Node 无原生 API 读 flags——记为 spec 欠账,不在本 PR 硬修(引原生模块/逐文件 shell-out 都不成比例)。

## 实现单元

### U0 · 确认步骤(不阻塞 U1,但要做)

在 PR 描述里给 Colin 一段可以转给 Wendi 的话:请 Wendi 发一张「看到隐藏文件」的截图或报几个文件名。
- 若是 `desktop.ini`/`~$…`/`Thumbs.db`/`Icon` 这类 → 本方案命中,合 PR 即修;
- 若截图是**点开头文件** → 与现有代码矛盾,转入现场诊断(核实她的 app 版本 ≥v0.6.6、看到文件的界面是不是文件树本体而非「标签页区的外部文件」等),本方案的 U1 仍保留(无害)。

### U1 · 扩展 `skip()`

`src/main/workspace.js`(现 `:18-35` 一带,IGNORE/skip 定义处):

```js
// Windows/云盘垃圾:靠隐藏属性藏身的非点号文件,属性在跨系统同步(共享云盘的 Windows 同事)后丢失现形。
// 大小写不敏感(Windows 文件系统保留任意大小写)。'Icon\r' 是 macOS 自定义文件夹图标(名字带回车,UF_HIDDEN)。
const JUNK = new Set(['desktop.ini', 'thumbs.db', 'ehthumbs.db', '$recycle.bin', 'system volume information']);
const skip = (name) =>
  name.startsWith('.') || name.includes('.ws2tmp') || IGNORE.has(name) ||
  JUNK.has(name.toLowerCase()) || name.startsWith('~$') || name === 'Icon\r';
```

注意:
- `~$` 前缀是 Office 锁文件命名约定;理论上会误伤用户真的以 `~$` 开头命名的文件——概率趋零,PR 描述里记一句即可。
- `skip` 同时被 `walk`(树/链接索引/listDocs)使用,垃圾文件从此对整个 app 不可见——预期行为,无需分叉。
- `listNames`(重名检查)不走 skip,保持现状(新建文件的防撞名应看见磁盘上全部真实文件)。

### U2 · 单测扩展

`test/workspace.test.js:232` 那条「隐藏/临时文件不进树」测试里追加 fixture 与断言:
- 写入:`desktop.ini`、`Desktop.INI`(大小写变体)、`Thumbs.db`、`~$报告.docx`、`Icon\r`(注意写文件时名字带真实回车字符)、目录 `$RECYCLE.BIN`、目录 `System Volume Information` → 断言全部不进树;
- **反误伤断言**(防过滤过宽,S4 口径):写入 `desktop.html`、`~波浪号开头.html`(单 `~` 不带 `$`)、`Iconography.html` → 断言**都在**树里。

## 测试要求

1. `npm test` 全绿。
2. **变异自检**(先 commit):把 U1 的 `JUNK.has(...)` 一段删掉 → U2 新断言必须翻红;还原翻绿。fixture 命名注意别和真名同长度巧合(MR-10 教训)——反误伤断言已经天然起对照作用。
3. e2e 不需要新增(树过滤是纯 main 逻辑,单测层足够;现有 e2e 无隐藏文件覆盖,不是本 PR 的债)。

## 验收标准

- [ ] U1 + U2 落地,单测绿,变异红/绿闭环。
- [ ] `docs/features/workspace-file-tree.md`「隐藏文件」条目扩写:点开头 + Windows/云盘垃圾名单(列全)+ `~$` 前缀 + `Icon\r`;「欠账」新增一行:UF_HIDDEN(chflags hidden)按名字判不出,Node 无原生 API,待有真实用户案例再评估原生方案。
- [ ] PR 描述含 U0 的 Wendi 确认话术 + 「若她看到的是点文件则另案诊断」的分支说明。
