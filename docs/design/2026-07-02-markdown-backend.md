# 实现设计：Markdown 作为文档后端格式

**状态**：设计 / 待落地（ui-demo 已验证原型，真 app 未做）
**日期**：2026-07-02
**背景**：Feature「markdown 文件阅读编辑器」——让 Schema #1 文档不只能存成 `.html`，也能存成 `.md`。
ui-demo 原型已合并 main（PR #88），本文是把同一套架构落进真实 Electron app 的实现设计。

---

## TL;DR

Wordspace 的编辑器和 Schema 校验器**天生就是格式无关的**——它们只操作「块模型 / HTML DOM」，
格式（HTML）只被写死在**磁盘读、写两个端点**。所以加 Markdown 后端 **不用动编辑器、不用动校验器**，
只在磁盘读写处各插一个「翻译器」（`md→html` 进来时、`html→md` 出去时）。真 app 约 3 处小改。

---

## 一句人话（ELI5）

一份文档有两个东西：**「意思」**（有个大标题、几段话、一个列表）和**「写在纸上的样子」**。
同一个「意思」可以用两种写法记在磁盘上：
- **HTML**：啰嗦的写法（给机器看的）
- **Markdown**：简洁的速记写法

我们软件中间那个**编辑器只认「意思」**（标题/段落/列表这些「块」），它根本不管纸上是哪种写法。

所以「支持 Markdown」= 在**门口放两个翻译员**：
- 打开 `.md` 文件时，翻译员先把速记翻成软件认识的样子，再交给编辑器；
- 保存成 `.md` 时，翻译员再把它翻回速记写到磁盘。

编辑器从头到尾不知道纸上用的是哪种写法。软件里面一行都不用改，只是门口多了俩翻译员。

---

## 核心洞察：app 已经是「后端无关」架构

（以下行号是 2026-07-02 时 `feat/app-ui-demo-align`（含 schema-1 集成）的真实代码，会漂，认函数名。）

格式（HTML）在整个「打开→编辑→保存」链路里**只被假设了两处**，都在磁盘边界：

| 步骤 | 文件 | 是否假设格式 |
|---|---|---|
| 打开：读盘 | `src/main/ipc.js:88` `read-doc` | **是**：读字节→`toString('utf8')`，`assertHtmlPath` 只放 `.html/.htm`，原样返回、无转换 |
| 打开：判合规 | `src/renderer/shell.js:116` `routeDoc` | 否：`DOMParser.parseFromString(rawHtml,'text/html')` → 校验器判 DOM，不关心 DOM 从何格式来 |
| 编辑 | `src/editor/blockedit.js` | 否：操作 iframe 的 **DOM 节点**（insertBefore/tag/文本），不碰 HTML 源码字符串 |
| Schema 校验 | `src/lib/schema-validate.js:143` `validate(doc)` | 否：遍历 `doc.querySelectorAll('*')` 判**拓扑结构**（禁 script、块嵌套、表格合并格），与格式无关 |
| 保存：序列化 | `src/renderer/shell.js` `save()` / `src/editor/serialize.js` | 否：块 DOM → HTML 字符串（`basicEdit?serialize:blockSerialize`，都出 HTML） |
| 保存：写盘 | `src/main/ipc.js:98` `save-doc` | **是**：`assertHtmlPath` 只放 `.html`，`writeDocSafe` 原样写字符串、无转换 |

**结论**：编辑器和校验器是格式无关的中间层；格式只活在最外面的磁盘 IO。这正是业界「模式 A：
单一内核模型 + 多序列化」（Notion / ProseMirror / Lexical 同款）。加 Markdown = 在两个磁盘端点插适配器。

---

## 落地：3 个插点（renderer 零改动）

```
                     ┌─── 全程不变（编辑器 + Schema 校验器只认 HTML DOM）───┐
打开:  [.md] ─①md→html─▶ read-doc 返回 HTML ─▶ routeDoc 判合规 ─▶ 挂块/基础编辑器
保存:  [.md] ◀─③html→md─ save-doc 收到 HTML ◀─ save() 序列化成 HTML ◀─ 编辑器
分流:  ② 扩展名 .md → 认成「可编辑格式」
```

全部改在**主进程**，renderer / 编辑器 / 校验器一律不动：

1. **`src/main/ipc.js:88` `read-doc`**：decode 后加扩展名分流——
   `if (/\.md$/i.test(p)) return md2html(text); else return text;`
   → renderer 永远收到 HTML，后续 `routeDoc`/`wireEditor`/校验器全不用改。
2. **`src/main/ipc.js:47` `assertHtmlPath` + `src/lib/file-tree.js:9` `kindOf`**：把 `.md` 放进可编辑白名单
   （现在只放 `.html/.htm`）。`kindOf` 加 `case 'md'`。
3. **`src/main/ipc.js:98` `save-doc`**：写盘前加分流——
   `if (/\.md$/i.test(p)) writeDocSafe(p, html2md(content)); else writeDocSafe(p, content);`

**不用动**：`routeDoc`、`blockedit`、`save()` 里的 `basicEdit?…:…` 序列化选择——它们收发的一直是 HTML 字符串。
整个 Markdown 后端 ≈ 主进程里 `md2html` / `html2md` 两个函数 + 几个扩展名判断。

---

## 关键决策（落地前拍板）

1. **round-trip 是「有损下转」，不是无损**。HTML 语义比 Markdown 丰富，`html→md` 官方就承诺故意有损。
   Schema 里 md 表达不了的（callout / 文字色 / 高亮 / 下划线）→ **方案 b：存成内嵌 HTML 岛**
   （跟 ui-demo 原型一致，仍是合法 `.md`、全保真）。
2. **规范化会改用户手写格式**（`*斜体*`→`_斜体_`、`*`项目符号→`-`）。缓解：把序列化器风格选项**固定死**，
   并跟用户对齐「打开手写 .md 再保存，格式会被统一成 canonical 形态」——所有 md WYSIWYG 都这样。
3. **默认永远开 GFM**（表格 / 任务列表 / 删除线不在标准 CommonMark 里，不开会被当纯文本）。
4. **HTML 岛要过 Schema 校验**：`.md` 内嵌的 `<div class="callout">` 转成 DOM 后，仍须是合规 Schema 结构
   （用 `rehype-raw` 让内嵌 HTML passthrough，但别绕过校验器）。
5. **外部改 .md 后重载会清空 undo 栈**——模式 A 的结构性代价（重载=重新 parse 覆盖），说明即可。

## 坑（业界实证）

- round-trip 反复 `md→html→md` 会累积微小格式漂移 → save 时只做一次 canonical 规范化、固定选项。
- turndown（html→md）边界情况多、转义激进、内嵌 HTML 处理不匀 → 若用它要写不少自定义规则。
- Bear 的 `::highlight::` 一类方言会破坏跨编辑器兼容 → 别自造 md 方言，表现层一律走 HTML 岛。

---

## 库选型

**首选：`unified` 生态（remark + rehype），双向都用**
- **load（md→html）**：`remark-parse` + `remark-gfm` + `remark-rehype`（`allowDangerousHtml:true`）+ `rehype-raw` + `rehype-stringify`
- **save（html→md）**：`rehype-parse` + `rehype-remark` + `remark-gfm` + `remark-stringify`

理由：Electron/Node 里跑得好；GFM 表格/任务列表都是插件；`rehype-raw` 正好处理 HTML 岛；能到 AST 层给
Wordspace 自定义块写映射 handler（`remark-rehype` 的 `handlers`）；生态最活。

**次选**：`markdown-it`（只 md→html、更小更快）配 `turndown`（html→md，但边界多）——除非要极小体积，否则 unified 更省心。

> ⚠ 真 app 别用手写解析器。ui-demo 原型里的 `mdToBlocks`/`blocksToMd`（`ui-demo/src/lib/markdown.ts`）是为了 demo
> 不加依赖、当作「映射表的可执行证明」；Markdown 边界情况极多，生产要用 unified 这种成熟库。

---

## 与 ui-demo 原型的关系

ui-demo 已验证的那套（`.md` 开进同一个块编辑器 + 「Markdown 源码」实时面板 round-trip）**就是这份架构的浏览器版**。
真 app 只是把两个「翻译器」从浏览器挪到 Electron 主进程的读写盘那两处，并把手写转换器换成 unified 成熟库。
内核、编辑器、校验器，一个都不用动。

- 原型代码：`ui-demo/src/lib/markdown.ts`（转换器）、`ui-demo/src/components/MarkdownSourcePanel.tsx`（源码面板）
- 原型接入：`FileKind:'md'`（`types.ts`）、`openFileTab` md 分流（`store.ts`）、示例 `产品说明.md`（`seed.ts`）
