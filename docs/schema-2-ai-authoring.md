# Wordspace Schema #2「分页文档」— AI 创作指南

## 0. 你只需要记住一件事

**Schema #2 = Schema #1 的全部规则 + `<head>` 里一个「分页版式声明」。** 正文（body）能写什么、不能写
什么，跟 Schema #1 **一模一样**——顶层块、行内标记、表格、折叠块、硬禁清单、替代对照表，全都照
`schema-1.md` 那份来（**产出前先把 `schema-1.md` 读完**）。分页文档的区别只有一个地方：`<head>` 里多
一条 `<style data-ws-schema-css="page">`，声明这份文档按纸张分页显示、导出 PDF 按页分页（像 Word）。

判定只认内容：校验器看到 body 结构合规、且 head 里那条 page 块能解析成 canonical `@page`，就把这份
文档认成 Schema #2「分页文档」；解析不出/没有 → 就是普通 Schema #1「流式文档」（不报错、不降级，只是
不分页）。`<meta name="wordspace-schema" content="2">` 只是给个提示，**校验器不看它、只看真实内容**。

## 1. 相对 Schema #1 多出来的东西（全部在 `<head>`）

**① 分页版式块（必需——这是「分页文档」的唯一硬标志）**

`<head>` 里放**恰好一个** `<style data-ws-schema-css="page">`，内容是**恰好一条** canonical `@page`：

```html
<style data-ws-schema-css="page">@page{size:A4 portrait;margin:25.4mm 25.4mm 25.4mm 25.4mm}</style>
```

- `size` = 纸张 + 方向：纸张只认 `A4` / `A3` / `Letter` / `Legal`（白名单），方向 `portrait` / `landscape`（可省，默认竖）。
- `margin` = 上右下左，**单位必须 mm**（1 值 = 四边同；2 值 = 上下/左右；4 值 = 上右下左）。
- **只允许 `size` 和 `margin` 两个声明**，别的（marks/bleed/`@top-center` 等）一律不认 → 整块判不出 → 退回流式。
- **恰好一个** page 块。多写几个 `<style data-ws-schema-css="page">` → 只认第一个；写坏（非上述格式）→ 退回流式。

**② 页码 / 页眉 / 页脚（可选，纯文本）**

用 `<head>` 里的 `<meta name="...">`（Schema head 白名单本就放行 `meta[name]`，不影响合规）：

```html
<meta name="ws-page-numbers" content="true">
<meta name="ws-page-header" content="公司机密 · 第一版">
<meta name="ws-page-footer" content="内部资料">
```

- `ws-page-numbers` = `"true"` → 导出 PDF 页脚居中加页码；缺省/其它值 = 不加。
- `ws-page-header` / `ws-page-footer` = 每页纸顶/纸底显示的一行**纯文本**（空/缺 = 不显示）。就是纯文本，
  别写 HTML 标签（写了也会被当字面文字转义，不会生效）；单行、不宜太长（超 200 字符会被截断）。

## 2. `<head>` 白名单（跟 Schema #1 一致，page 块本就在内）

`<head>` 里只允许：`<meta charset>`、`<meta name="...">`（不带 `http-equiv`，含 wordspace-schema /
ws-page-* 这些）、一个 `<title>`、以及编辑器托管的 `<style data-ws-schema-css="...">`（分页文档就是
`data-ws-schema-css="page"` 那条）。**别放** `<base>`、`<link>`、你自己写的 `<style>`、`<script>`。

## 3. body 规则 = Schema #1（不重复，去读 `schema-1.md`）

顶层块速查、表格、折叠块、行内标记、硬禁清单（不写 `<script>`/`on*`/`javascript:`、块级不带 `style`、
表格禁合并格、标题封顶 h4、没有裸 `<div>`/`<section>`…）、用户要求违规时的替代对照表——**全部照
`schema-1.md`**。分页文档的 body 就是一份合规的 Schema #1 文档，一个字不差。

## 4. 一份完整的分页文档样例（可直接通过校验器、归类 schema-2）

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="wordspace-schema" content="2">
<meta name="ws-page-numbers" content="true">
<meta name="ws-page-header" content="产品周报">
<meta name="ws-page-footer" content="内部资料 · 请勿外传">
<title>产品周报</title>
<style data-ws-schema-css="page">@page{size:A4 portrait;margin:25.4mm 25.4mm 25.4mm 25.4mm}</style>
</head>
<body>
<h1>产品周报 · 第 12 周</h1>
<p>本周<b>重点</b>：完成分页文档，详见 <a href="https://example.com/pr">PR</a>。</p>

<h2>本周进展</h2>
<ul class="ws-todo">
  <li data-checked="true">分页拆成独立 Schema 2</li>
  <li data-checked="false">写分页文档 AI 创作指南</li>
</ul>

<h2>数据</h2>
<table class="ws-table">
  <thead><tr><th>指标</th><th class="ws-al-right">数值</th></tr></thead>
  <tbody>
    <tr><td>日活</td><td class="ws-al-right">1,240</td></tr>
    <tr><td>留存</td><td class="ws-al-right">63%</td></tr>
  </tbody>
</table>

<blockquote><p>「像 Word 一样按页排版。」<br>——分页文档</p></blockquote>

<div class="ws-callout"><p>提示：导出 PDF 会按 A4 分页，页脚带页码。</p></div>
</body>
</html>
```

## 5. marker 不是通行证

`<meta name="wordspace-schema" content="2">` 只是**提示**，方便快速猜「这大概是分页文档」。但校验器
**压根不看它、只查实际内容**：head 里有没有可解析的 page 块决定它是不是 schema-2。写了 `content="2"`
但没 page 块 → 还是流式文档；写了 `content="1"` 但有合法 page 块 → 照样认成分页文档。所以别靠 meta，
靠**真的写对那条 `<style data-ws-schema-css="page">`**。

## 6. 自查

`node scripts/validate-schema.js <file.html>`——stdout 给 `{schemaId, conform, violations}`：
`schemaId` 是 `"schema-2"` 就对了（`"schema-1"` = 结构合规但没被认成分页文档，多半是 page 块写错；
`null` = 结构不合规，看 violations）。
