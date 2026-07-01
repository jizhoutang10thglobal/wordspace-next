# Wordspace Schema #1 — AI 创作指南

> 读者 = 要为 Wordspace 生成 / 编辑 `.html` 文档的 AI。**严格按本文写**，你的产出才会被判「合规」。

## 0. 你只需要记住一件事

你产出的每一份 HTML，都会被 Wordspace 一个**确定性校验器**逐条检查：

- **合规** → 用户能对它做完整的结构化编辑（像 Notion 那样）。
- **不合规** → 只能做基础文字编辑，很多功能用不了。

所以目标很简单：**产出能通过校验器的 HTML**。校验器是写死的规则、不是 AI，不会「通融」。它**只看你写的实际内容**——你在 `<head>` 里写 `<meta name="wordspace-schema" content="1">` 声称自己合规**没有用**，内容不对照样判不合规（见 §9）。

Schema #1 = 一套**受限的 HTML**（reduced HTML）：块的集合 ≈ Notion 的基础块。下面把「能写什么、不能写什么」讲清楚。

---

## 1. 文档骨架（30 秒）

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="wordspace-schema" content="1">
<title>文档标题</title>
</head>
<body>
<h1>文档标题</h1>
<p>正文……</p>
</body>
</html>
```

- **`<!doctype html>` 必须有**（标准模式）。
- **`<head>` 里只允许**：`<meta charset>`、`<meta name="wordspace-schema" content="1">`、其它 `<meta name="…">`（不带 `http-equiv`）、一个 `<title>`、以及编辑器托管的 `<style data-ws-schema-css>`。**别放** `<base>`、`<link>`、你自己写的 `<style>`、`<script>`。
- **`<body>` 直接挂块**：扁平地一个接一个，**别用 `<div>`/`<section>` 把块包起来**。

---

## 2. 顶层块速查表

「顶层块」= `<body>` 的直接子。每个块的**标准写法**如下：

| 块 | 写法 | 里面放什么 |
|---|---|---|
| 段落 | `<p>文字</p>` | 文字 + 行内标记 |
| 标题 | `<h1>…</h1>` `<h2>` `<h3>` `<h4>` | 文字 + 行内标记（**只到 h4，没有 h5/h6**） |
| 无序列表 | `<ul><li>项</li></ul>` | 每个 `<li>` = 文字/行内 + 可选的尾随子列表 |
| 有序列表 | `<ol><li>项</li></ol>` | 同上；`<ol>` 可带 `start="3"`（整数） |
| 待办清单 | `<ul class="ws-todo"><li data-checked="false">项</li></ul>` | 同列表；`data-checked` **只能是 `"true"` 或 `"false"`** |
| 引用 | `<blockquote><p>文字</p></blockquote>` | 一段或多段 `<p>` + 行内；**不放列表/别的块** |
| 提示框（callout） | `<div class="ws-callout"><p>文字</p></div>` | 一段或多段 `<p>` + 行内；**不放列表/别的块** |
| 分隔线 | `<hr>` | 空 |
| 表格 | `<table class="ws-table">…</table>` | 见 §3 |
| 折叠块（toggle） | `<details>…</details>` | 见 §4 |
| 图片 | `<img src="…">` | 空（块级图片，`<body>` 直接子） |
| 带说明的图 | `<figure><img src="…"><figcaption>说明</figcaption></figure>` | 一个 `<img>` + 可选 `<figcaption>`（图注只放文字+行内） |

**只能出现在特定父元素里、不能当顶层块单独出现的**：`<li>`（只在 ul/ol）、`<summary>`（只在 details）、`<thead>/<tbody>/<tr>/<th>/<td>`（只在 table）、`<figcaption>`（只在 figure）。

**小样例（一份合规的正文）：**

```html
<h1>季度复盘</h1>
<p>本季度<b>关键</b>结论见下。</p>
<h2>进展</h2>
<ul class="ws-todo"><li data-checked="true">写草案</li><li data-checked="false">评审</li></ul>
<blockquote><p>引用，可带<i>行内标记</i>。</p></blockquote>
<div class="ws-callout"><p>提示：记得同步给团队。</p></div>
<hr>
```

---

## 3. 表格

```html
<table class="ws-table">
  <thead><tr><th>名称</th><th>状态</th></tr></thead>
  <tbody>
    <tr><td>方案 A</td><td>进行中</td></tr>
    <tr><td>方案 B</td><td>待评审</td></tr>
  </tbody>
</table>
```

**硬规则**：
- **矩形**：每一行的格数必须相同。
- **禁合并**：不许 `colspan`、`rowspan`。
- **单元格只放文字 + 行内标记**：`<td>`/`<th>` 里不能放段落、列表、`<iframe>` 等，只能是纯文字加 `<b>`/`<a>` 这类行内。
- **表头至多一行**，放在 `<thead>` 里；数据行放 `<tbody>`。
- **禁** `<caption>`、`<colgroup>`、`<tfoot>`。
- 对齐用固定 class：`<td class="ws-al-center">` 或 `ws-al-right`（不要用 `style`）。

---

## 4. 折叠块（toggle）

```html
<details open>
  <summary>点我展开（标题只放文字 + 行内）</summary>
  <p>正文可以是多个块。</p>
  <ul><li>甚至能放列表</li></ul>
  <details><summary>还能再嵌一个折叠块</summary><p>里面继续放块。</p></details>
</details>
```

**硬规则**：
- **第一个子元素必须是恰好一个 `<summary>`**（不能缺、不能多、不能不在最前）。
- **`<summary>` 里只放文字 + 行内标记**，不能塞段落/列表/别的块。
- **`<summary>` 之后是正文** = 一串正常的块（段落、列表、图、甚至嵌套的 toggle）。**这是整个 Schema 里唯一能把块嵌进另一个块的地方**——别的块都不行。
- `open` 属性（可选）= 默认展开。

---

## 5. 行内标记（写在文字里的格式）

| 标记 | 写法 | 说明 |
|---|---|---|
| 加粗 | `<b>粗</b>` | |
| 斜体 | `<i>斜</i>` | |
| 下划线 | `<u>下划线</u>` | |
| 删除线 | `<s>删</s>` | |
| 行内代码 | `<code>code</code>` | **里面只放纯文本**，不嵌别的标记 |
| 链接 | `<a href="https://x.com">链</a>` | href 只能 `http`/`https`/`mailto`/`tel`/相对路径；**禁** `javascript:`/`data:`；别加 `on*`、别加 `target` |
| 文字颜色 | `<span style="color:#c00">红字</span>` | |
| 高亮 | `<span style="background-color:#ff0">高亮</span>` 或 `<mark>高亮</mark>` | |
| 软换行 | `<br>` | 段内换行 |

叠加规则：行内标记之间可自由互嵌（`<b><i>x</i></b>` 随意）；但 **`<a>` 不嵌 `<a>`**、**行内标记里不放块级**、**`<code>` 里只放纯文本**。

> ⚠ **关键区别**：**块级元素**（`<p>`、`<h1>`…、`<li>` 等）上**禁止 `style` 属性**（装饰不入盘、显示按原生）。但**行内 `<span>` 上的 `style`（颜色/高亮）是允许的**。别把颜色写到块上，要写到块里的 `<span>` 上。

---

## 6. 硬禁清单（违反任一条 = 不合规）

下面每一条都直接对应校验器的一条规则（括号里是规则名）。**逐条避开**。

**安全类（最硬）**
1. **不写任何 `<script>`**（`script`）——包括 SVG/MathML 里的 `<script>`。文档 JS 根本不会跑。
2. **不写任何 `on*` 内联事件属性**（`event-attr`）——`onclick`、`onload` 等一律禁。
3. **链接 href 不用危险协议**（`unsafe-href`）——`javascript:`、`data:`、`vbscript:`、`file:` 全禁（连用 tab/换行/控制字符混进去也会被识破）。用 `http/https/mailto/tel/相对路径`。

**结构类**
4. **叶子块和容器里不嵌块**（`nested-block`）——`<p>`/`<h1>~<h4>` 里不放块；`<blockquote>`/`<div class="ws-callout">` 里只放多段 `<p>` + 行内，**不放列表/别的块**。要并列多个块就各自当顶层块；**要真嵌块只有 toggle 正文能做**。
5. **`<ul>`/`<ol>` 的直接子只能是 `<li>`**（`list-child`）——别把文字/段落直接塞进 ul。
6. **待办的 `data-checked` 只能 `"true"`/`"false"`**（`todo-checked`）。
7. **`<li>` 里只放行内 + 可选尾随子列表**（`li-content`）——列表项的文字**直接写在 `<li>` 里，别包 `<p>`**。
8. **表格禁合并格**（`table-merge`）——不用 `colspan`/`rowspan`。
9. **单元格只放文字 + 行内**（`cell-content`）——`<td>`/`<th>` 里不放块/列表/iframe。
10. **表格结构固定**（`table-structure`）——禁 `<caption>`/`<colgroup>`/`<tfoot>`，表头至多一行。
11. **表格必须矩形**（`table-ragged`）——每行格数相同。
12. **`<figure>` 只含一个 `<img>` + 可选 `<figcaption>`**（`figure-content`）——别在 figure 里塞段落/列表。
13. **`<figcaption>` 里只放文字 + 行内**（`figcaption-content`）。
14. **块级元素不带 `style`**（`block-style`）——颜色写到块**里**的 `<span>` 上，别写到块上。
15. **顶层只用允许的块**（`block-tag`）——**没有 h5/h6**（标题封顶 h4）、**没有 `<section>`**、**没有裸 `<div>`**（提示框必须是 `<div class="ws-callout">`）。别的任意标签当块都不合规。
16. **`<head>` 里不写 `meta http-equiv`**（`head-meta-http-equiv`）——`refresh` 跳转会劫持导航。
17. **`<head>` 里的 `<style>` 必须带 `data-ws-schema-css`**（`head-style`）——那是编辑器托管的语义 CSS；**你自己的装饰 `<style>` 不允许**。
18. **`<head>` 里不写 `<base>`**（`head-base`）——它会重写全篇相对 URL。
19. **`<head>` 里不写外联 `<link>`**（`head-link`）——比如 `<link rel="stylesheet">`。
20. **`<head>` 里不放白名单外的标签**（`head-tag`）——head 只放 charset meta / schema meta / 其它 name meta / 一个 title / schema-css style。
21. **toggle 必须恰有一个 `<summary>` 且是第一个子**（`details-summary`）。
22. **toggle 的 `<summary>` 里只放文字 + 行内**（`details-summary-content`）。

---

## 7. 一个必踩的陷阱：浏览器会「重排」你的 HTML

Wordspace 判合规时，是拿**磁盘上的字节重新解析一遍**再看结构。HTML 解析有些自动纠正行为，你得知道，否则会写出「你以为对、其实被浏览器改了」的结构：

- **块级标签会强行关闭没闭合的 `<p>`**。如果你写 `<p>文字<div>x</div></p>`，浏览器解析后会变成 `<p>文字</p><div>x</div>`——那个 `<div>` 跑到了 `<p>` 外面、成了 `<body>` 的**裸 div**，命中的是 `block-tag`（裸 div 非法），**不是** `nested-block`。
- 结论：**叶子块（p/h1~h4）里永远别塞块级标签**。真要嵌块，只有 **toggle 正文**这一个合法出口（§4）。

---

## 8. 一份完整的合规样例（可直接通过校验器）

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="wordspace-schema" content="1">
<title>产品周报</title>
</head>
<body>
<h1>产品周报 · 第 12 周</h1>
<p>本周<b>重点</b>：完成 Schema 校验器，详见 <a href="https://example.com/pr">PR</a>。</p>

<h2>本周进展</h2>
<ul class="ws-todo">
  <li data-checked="true">校验器补 toggle 内部校验</li>
  <li data-checked="false">写 AI 创作指南</li>
</ul>

<h2>数据</h2>
<table class="ws-table">
  <thead><tr><th>指标</th><th class="ws-al-right">数值</th></tr></thead>
  <tbody>
    <tr><td>日活</td><td class="ws-al-right">1,240</td></tr>
    <tr><td>留存</td><td class="ws-al-right">63%</td></tr>
  </tbody>
</table>

<blockquote><p>「校验器是脊梁。」<br>——架构地基</p></blockquote>

<div class="ws-callout"><p>提示：下周评审前把文档发群里。</p></div>

<details open>
  <summary>附：风险清单</summary>
  <p>以下是需要盯的点：</p>
  <ol><li>命中率待实测</li><li>分发方式待定</li></ol>
</details>

<figure>
  <img src="data:image/png;base64,iVBORw0KGgo=">
  <figcaption>示意图</figcaption>
</figure>
<hr>
</body>
</html>
```

---

## 9. marker 不是通行证

`<meta name="wordspace-schema" content="1">` 只是一个**提示标记**，方便 Wordspace 快速猜「这大概是个 Schema 文档」。但**校验器压根不看它、只查实际内容**：

- 写了 marker 但内容违规 → 照样判**不合规**。
- 没写 marker 但内容合法 → 照样判**合规**。

所以别指望靠 marker「声明」合规。**合不合规，只由你写的实际结构决定。**
