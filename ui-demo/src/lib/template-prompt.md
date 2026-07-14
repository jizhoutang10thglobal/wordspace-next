# Wordspace 版式模板创作 Prompt（给外部 AI）

你要为 Wordspace 生成一份**版式模板**。模板 = 一段受管制的 CSS（决定文档长什么样）+ 可选的起始骨架。
产出一个 **JSON 对象**，用户会把它粘贴进 Wordspace 导入。

## 你只需要记住一件事

模板 CSS 会被 Wordspace 一个**确定性安全门**逐条检查。**没过门的整份被拒**（不是部分生效）。
所以目标很简单：产出能过门的 CSS。门是写死的规则、不通融。

## 输出格式（严格）

```json
{
  "name": "模板名称",
  "kind": "doc",
  "description": "一句话描述这个版式",
  "accent": "#1d6fbf",
  "css": "选择器 { 属性 }\n……",
  "blocks": []
}
```

- `css`：版式 CSS 字符串。**选择器写相对形式**（`h1`、`p`、`.ws-callout`、`blockquote`、`table th` 等），
  Wordspace 会自动把整包 CSS 作用域到文档区（你不用写 `.ws-doc` 前缀）。
- `blocks`：可选起始骨架，留 `[]` 表示纯版式模板。
- `accent`：卡片装饰色（十六进制）。

## 能用什么（文档常见元素）

`h1`–`h4`（标题，没有 h5/h6）、`p`（正文）、`ul`/`ol`/`li`（列表）、`blockquote`（引用）、
`.ws-callout`（提示框）、`table`/`th`/`td`（表格）、`pre`（代码块）、`hr`（分割线）。
行内可用 `b`/`i`/`u`/`s`/`code`/`mark`/`a`/`span`。

## 硬禁清单（撞任一条 = 整份被拒）

1. **禁外链**：`url()` 只允许内嵌 `url(data:font/*)`（内嵌字体）和 `url(data:image/*)`（内嵌图片，SVG 除外）。
   任何 `http`/`https`/外部路径的 `url()` 都拒——包括外部字体、外部图片、追踪信标。
2. **禁 `@import`**（拉外部样式表）。
3. **禁执行向量**：`expression()`、`-moz-binding`、`behavior:`（`scroll-behavior`/`overscroll-behavior` 可以）。
4. **禁定位类**：`position: fixed / sticky / absolute`（会盖住界面）。用文档流布局（margin/padding/flex/grid 都行）。
5. **禁 `!important`**（会覆盖用户的手动改色，破坏体验）。
6. **禁隐藏正文**：`display: none`、`visibility: hidden`（模板不许藏内容）。
7. **at-rule 白名单**：只允许 `@font-face`、`@keyframes`、`@media`、`@supports`。别的（如 `@page`）都拒。
8. **体积**：整包 CSS 别太大（内嵌字体请用子集化的小字体）。

## 品牌字体 / logo 怎么放

内嵌，不外链：
```css
@font-face { font-family: '品牌字体'; src: url(data:font/woff2;base64,……) format('woff2'); }
h1, h2 { font-family: '品牌字体', Georgia, serif; }
.cover::before { content: ""; background-image: url(data:image/png;base64,……); }
```

## 好的模板长什么样

- 定义清晰的标题层级节奏、正文行高、配色（用中性色 + 一个主色）。
- callout / 引用 / 表头有辨识度的样式。
- 整体协调，像一套设计，而不是随机上色。

**先在心里过一遍硬禁清单，确认每条都不撞，再输出 JSON。**
