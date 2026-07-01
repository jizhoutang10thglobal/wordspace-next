# Heads-up：align 的三单元与 schema-1 在 `shell.js` 的交汇点

**From**：schema-1 session（Feature 1/2/3 已写完并 commit 在 `feat/schema-1`，base=v0.4.3）
**To**：align session（`feat/app-ui-demo-align`，保存模型 / 真收起 / Cmd+P）
**Why**：你的 plan 声明「非合规编辑不碰」——**文件级成立**（你不碰 `basic-edit.js`/`schema-validate.js`/`sidebar.js`/`shell.css`），但实测两条线**唯一都改的文件就是 `src/renderer/shell.js`**，而且有四处**语义必然交互**。这不是要你改方向，是让你写 Unit 1-3 时**预留这四个钩子**，免得 rebase 到 schema-1 之上时才发现 save/分流/浮层各写各的。

下面行号是 schema-1 当前 `shell.js` 的（rebase 后会漂，**认函数名**）。

---

## 1. `save()` — 临时文档分支要和 basicEdit 分支并存（最关键）

schema-1 现在的 `save()`（shell.js:414）：

```js
async function save() {
  if (!docPath || !dirty) return;                 // ← 这行会把你的 tempDoc 挡在门外（tempDoc 时 docPath=null）
  const html = basicEdit
    ? WS2BasicEdit.serialize(frame.contentDocument)   // 非合规：结构保真序列化
    : WS2Serialize.serializeDocument(frame.contentDocument);
  ... await window.ws2.saveDoc(docPath, html) ...
}
```

你的 plan 要「save() 遇 tempDoc → openSaveModal」。合并后正确形状 = **守卫放行 tempDoc + 序列化那行保留 basicEdit 三元 + tempDoc 早分流**：

```js
async function save() {
  if ((!docPath && !tempDoc) || !dirty) return;   // 放行临时文档
  const html = basicEdit
    ? WS2BasicEdit.serialize(frame.contentDocument)
    : WS2Serialize.serializeDocument(frame.contentDocument);
  if (tempDoc) return __sbHooks.openSaveModal(tempDoc.id, tempDoc.title, html);  // 临时→选保存位置
  ... 原有 saveDoc(docPath, html) ...
}
```

**别把 `basicEdit ? serialize : serialize` 那行覆盖成只有一种**——非合规文档存盘就靠它（剥编辑态 + 不 Schema 规整、保真）。你只在它前后加 tempDoc 逻辑。

## 2. `openTempDoc` 渲染前必须设 `docConform`，否则临时文档编辑器错挂

schema-1 靠模块变量 `docConform`（shell.js:7，默认 true）决定 iframe onload 挂哪种内核。三个 onload 入口都是这句：

```js
frame.onload = () => { ...; docConform ? wireEditor() : attachBasic(); };
```

`docConform` 只在 `openDoc`（读磁盘，:360）和 `reloadDoc`（:325）里用 `routeDoc(raw)` 设。**你的 `openTempDoc` 走 `loadFromHtml`（:337），而 `loadFromHtml` 故意不改 docConform**（注释写的是「历史恢复走同一文档既有判定」——对恢复对，对新的临时文档就错了：会读到**上一个打开文档的陈旧 docConform**）。

修法一行：`openTempDoc` 调 `loadFromHtml` **之前** 加

```js
docConform = routeDoc(html);   // 模板产物合规→true→完整块编辑；万一非合规也能正确降级
```

（`routeDoc` 在 shell.js:107，纯函数、吃 html 字符串。）

## 3. 「真收起」toggle 要 reposition 两个编辑器的宿主浮层

我 F3 基础编辑器的格式条/焦点框、还有块编辑器的手柄，都是 `position:fixed` 的**宿主浮层**，坐标 = iframe 视口矩形 + 元素矩形。你 Unit 2 把 `.sb.is-collapsed` 从 48px 改成宽 0，**iframe 一横移,这些浮层全飘**。

schema-1 已经在「缩放」和「窗口 resize」两处收口了这个动作，你的收起 toggle 照抄同一对调用即可（shell.js:451）：

```js
if (blockEdit) blockEdit.reposition();
if (basicEdit) basicEdit.reposition();
```

收起/展开动画结束后各调一次（有 transition 的话在 `transitionend` 里调，或 toggle 后下一帧调）。

## 4. 导出：**保 schema-1 的 `exportPdf(mode)` 版，别退回 ux-fixes 的无参版**

我在 ux-fixes（`0db2863`）把 renderer 的 `exportPdf(mode)` 砍成无参 `exportPdf()`、写死 wordspace（当时以为 raw 是死代码）。**F3 又让 raw 复活了**——非合规文档基础模式导出就靠 `exportPdf('raw')` 直印源文件（走 wordspace 排版会抛错，正是最初那个 bug）。

schema-1 现状：`exportPdf(mode)`（:475），两个触发点（菜单:465 / 按钮:522）都是

```js
exportPdf(basicEdit ? 'raw' : 'wordspace');
```

主进程侧两边一致、raw 原语都在，所以**这只是 renderer 一处**：rebase 时冲突取 schema-1 版，别把无参版带回来。你加 Cmd+P 会动 `onMenu`（就在导出那行附近），注意别顺手清掉那行。

## 小序列注意

你的 plan 说 `openDoc`/`showViewer` 入口先 `stashTemp()`。`stashTemp` 要序列化 `contentDocument` 存回 tempStore——务必**在 `detachEditors()`（:114，换文档时 loadFromFile/wireEditor/attachBasic 会调）之前**跑，否则内核已拆、序列化拿到的是残缺 DOM。

---

## 合并顺序（schema-1 侧的建议，最终 Colin 拍）

align 现在最灵活（还只是 plan），最省事是**最后 rebase 到 (main + ux-fixes + schema-1) 之上**、由你把上面四处一次合掉。schema-1 落后 main 两版、无论如何要先往前 rebase。大致：ux-fixes→main → schema-1 rebase 上来 → align 再叠。你写 Unit 1-3 时按上面预留钩子，rebase 那步就基本是机械的。

schema-1 分支：`feat/schema-1` @ worktree `wordspace-next-schema`。有疑问直接看那边的 `src/renderer/shell.js` 真代码。
