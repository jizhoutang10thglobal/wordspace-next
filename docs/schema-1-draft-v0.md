---
title: Wordspace Schema #1 草案 (v0)
date: 2026-06-30
status: draft-for-review
origin: workflow define-schema-1 (25 agents · ground+spec+behaviors+verify+synth)
---

# Wordspace Schema #1 草案（v0 · 给人 review + ce-plan 底稿）

> 状态：起草冻结待评审。本文整合 ground 阶段代码核实、各块/行内/骨架/media/behavior 簇规格、以及对抗阶段的可复现反例。**所有"已实现"标注都对照活代码核实；标⚠/❌的是真缺口，第 7 节按严重度收口。**
> 代码锚点：`src/editor/blockedit.js`（`WS2BlockEdit` 内核）、`format.js`（DOM 工具）、`serialize.js`（存盘剥离）、`src/lib/doc-templates.js`（骨架）、`src/renderer/index.html`（iframe sandbox）。行号默认指 `blockedit.js`。

---

## 0. 决策冻结（2026-06-30 · Colin 拍板 · 覆盖下文冲突处）

> 本节是人拍板的权威覆盖。下文 §1–§7 的分析与对抗发现仍有效，但**与本节冲突处，以本节为准**。

### Schema / Template 模型校正（最重要）

- **Schema** = 编辑方式 + 结构规则 + 文件格式约束（页边距 / 宽高底线）+ 让块渲染正确的**最小语义 CSS**。管"怎么编辑、能放什么结构"，**不管装饰好不好看**。
- **Template** = 在 Schema 约束内的视觉装饰（字体 / 配色 / 那套"漂亮的 Notion 居中窄栏"——它本身就是一个 Template）。
- **显示 = 永远按 `.html` 原生渲染（所见即所得）；编辑器不主动套装饰样式。** 调色板只是"编辑器能用哪些色"，文件本有的颜色照常原生显示。
- **符合 Schema → 完整 schema 编辑；不符合 → 只给基础文字编辑（feature 3），不强行修成符合。**
- ⛔ **删，不是修**：下文 §1 原则 6 / §7 C2 里"编辑器给裸文档套 Notion canvas 排版（`docHasAuthorStyles` / `data-ws2-canvas`）"那套**整体删除**——漂亮 = Template，不是编辑器硬套。删后 C2 自然消失。
- ✅ **保留并升级为"Schema baseline"**：让块长对样子的**语义 CSS** 入盘（to-do 勾选框、callout 提示框、table 边框/对齐）+ 页边距/宽度底线，全部打 `data-ws-schema-css` 标记随文件走 = "Schema 自带的最小样式"。所以 §7 C1（callout 无入盘 CSS）的修法照做 = 把 callout 语义 CSS 纳入 Schema baseline。
- 🔄 **baseline v2 演进（Colin 2026-07-05 拍）**：baseline 从「宽度+留白」升级为**完整排版底线**——字体栈/16px/1.75 行高/标题层级节奏（上重下轻）/段落列表引用表格代码分割线的间距与形状，色彩只用中性灰阶（正文墨色 #37352f + 边框灰），参考 Notion/Obsidian 的基础观感。仍然全部 `:where()` 零权重（作者样式永远优先，baseline 只是地板）、仍然 `data-ws-schema-css="baseline"` 入盘随文件走、app 外浏览器直开同样好看。**装饰性主题（配色/字体个性）仍归 Template**——baseline 是"好看的白纸"，不是主题。旧文件的 v1 baseline / v1 todo·callout CSS 在编辑器 attach 时静默升级；文档里存在语义块但缺入盘 CSS 的（md 转换产物 / 外部 AI 生成）attach 时补注。

### 六个决策（覆盖下文对应处）

1. **颜色/高亮**：固定调色板（≈Notion 十来色）= 编辑器能用的色；高亮用 `<mark>`（最稳）；**显示按原生**——文件本有的任意颜色不动、照常渲染。
2. **样式/保真**：编辑器不套装饰；存盘 = 干净内容 + Schema baseline 语义 CSS（+ 用户选的 Template）。覆盖 §2 末 / §7 F2 的"保真哲学"纠结——不再有"存盘要不要带漂亮"的问题。
3. **Toggle `open`**：**持久态**（`<details open>` 入盘、记住收/展）。
4. **callout / quote / 表格单元格 内部模型（中间档 b）**：callout / quote 内 = **多段文字**（可多个 `<p>` + 行内标记 + `<br>`），**但不嵌列表/别的块**；**表格单元格 = phrasing-only（单文字 + 行内标记）**。覆盖 §2 把 callout/quote 写成"单文字区"的描述（升级为多段）；cell 维持 phrasing-only。
5. **Heading**：封顶 **h4**；**h5/h6 = 不符合 Schema → 走基础编辑**（不压成 h4、不静默 normalize）。覆盖 §7 S8 的"normalize"取向。
6. **Table**：**禁合并格**（no `colspan`/`rowspan`），像 Notion（与 §2.3 文法一致）。

> §7 的 bug 收口（A1/A2/B1/B2/F1 等内容模型 + 存盘 bug）**不受本节影响、照修**——它们是现有代码的真缺陷，跟 Schema/Template 模型独立。

---

## 1. 概述 + 设计原则

Wordspace = Electron HTML-native 本地编辑器。Schema #1 = 一套**受限 HTML 格式（reduced HTML）**，编辑器与它 co-design、对它"操作闭合"——任何编辑动作把"合法 Schema 文档"变成"合法 Schema 文档"，从构造上消灭结构 bug。块集合 = Notion Basic blocks（去掉 Page / Link to page）。

六条不可违背的物理约束（决定一切设计）：

1. **schema-first / 闭合**：编辑动作是 `合法 → 合法` 的全函数。守卫不靠"小心写"，靠"把非法输入挡在动作外或 coerce 到最近合法形态"。
2. **不跑文档 JS**：渲染 = Chromium 直载 `file://`，iframe `sandbox="allow-same-origin"`（`index.html:94`，无 `allow-scripts`/`allow-modals`/`allow-downloads`/`allow-popups`）。**任何块的视觉/状态都不能依赖文档运行时 JS**，只能靠 (a) 静态 HTML 结构、(b) 浏览器原生非脚本交互（`<details>`、`<video controls>`）、(c) 入盘静态 CSS + 属性选择器。
3. **文档流，绝不绝对定位**：所有块留在文档流、能 reflow、可发布。绝不写 `position:absolute`/固定 `top/left/width/height`。缩进/层级用 DOM 嵌套表达，不用 margin/padding 数值。
4. **保真存盘**：编辑器注入物用 `data-ws2-*` 标记，存盘按**精确白名单**剥除（`serialize.js:12` `WS2_MARKERS`）。**红线：绝不用 `startsWith('data-ws2')` 前缀剥**（误删用户自带属性）——但精确名碰撞 + 整节点删同样会误伤，见 §7 F1。
5. **无云存储**：纯本地单文件 `.html`。资源要么 `data:` 内联（真单文件、体积膨胀）、要么相对路径（体积小、破坏单文件）。没有第三条路。
6. **"内容性样式"入盘范式**：承载**意义/状态**的 CSS 必须入盘（`ensureTodoStyle`，`:340`：往 `<head>` 注 `<style id="ws-todo-style">`，随 serialize 存盘、零 JS）；承载**美观**的 CSS（820 窄栏 Notion 排版字体）留编辑器 `adoptedStyleSheets`（`:164`），不入盘。toggle/callout/table/受限色板的视觉态都该照搬入盘范式。

**内核分类规则**（`classify`, `:35`）：`H1/H2/H3→heading`、`P→text`、`UL/OL→list`、`BLOCKQUOTE→quote`、`HR→divider`、`IMG→image`、其余→`other`。"块" = `blockRoot` 直接子元素；`pickBlockRoot`（`:83`）穿透单一无语义包裹容器。**当前缺口**：`H4/H5/H6`、`DETAILS`、`TABLE` 都落 `other`（灰选不可深编）。

---

## 2. 块表

每个块的 reduced-HTML 表示。**canonical = 编辑器产出的标准形态**；输入侧对更宽的导入容差另有规整规则（见 §7）。

### 2.0 三类内容模型（闭合论证的支点）

| 类 | 块 | 内容模型 |
|---|---|---|
| **A 短语叶子** | Text / H1–H4 / Quote / Callout | phrasing（文本 + 行内标记 + `<br>`） |
| **B 列表** | Bulleted / Numbered / To-do | `<li>+`（li 内 = phrasing + 可选尾随子列表） |
| **C 结构/void** | Table / Divider / Toggle | 各有专属文法 |

A→A 转换无条件安全；A↔B 必须包/拆 `<li>`；越类必须经内容模型适配（§6、§7 的核心修法）。

### 2.1 块逐项规格

| 块 | reduced-HTML | 允许子内容 | 允许行内标记 | 嵌套规则 | 属性白名单 | 状态 |
|---|---|---|---|---|---|---|
| **Text** | `<p>` | phrasing | 全集 | 顶层块，不互嵌 | `id`(唯一)/`class`/`lang`/`dir`/`title`/`role`/`aria-*`/用户`data-*`；**无 `style`** | ✅ |
| **Heading 1-3** | `<h1>`/`<h2>`/`<h3>` | phrasing | 全集 | 顶层块 | 同上 | ✅ |
| **Heading 4** | `<h4>` | phrasing | 全集 | 顶层块 | 同上 | ⚠ `classify` 落 other；补 2 处（§7） |
| **Bulleted** | `<ul><li>` | li=phrasing+可选尾随子列表 | li 内全集 | li 内可嵌同构子列表（Tab） | ul:无 class（除 ws-todo）；li:无 | ✅ |
| **Numbered** | `<ol><li>` | 同上 | 同上 | 同上 | ol:可选 `start`(整数)，省 `type`；li:无 | ✅ |
| **To-do** | `<ul class="ws-todo"><li data-checked>` + 入盘 `#ws-todo-style` | 同上 | 同上 | 子列表抄 `ws-todo` class | ul:`class="ws-todo"`；li:`data-checked∈{"true","false"}` | ✅ |
| **Toggle** | `<details [open]><summary>…</summary>flow</details>` | summary=phrasing；body=flow（可嵌块/toggle） | summary 内全集 | body 各块独立可编辑；可嵌 details | details:`open`(布尔)；summary:无 | ❌ 完全未实现 |
| **Callout** | `<div class="ws-callout">` + 入盘 `#ws-callout-style` | phrasing（单文字区） | 全集 | 顶层块，内部不嵌块 | `class="ws-callout"` | ⚠ 逻辑✅ 但**无入盘 CSS**（§7 C1） |
| **Quote** | `<blockquote>` | phrasing（单文字区） | 全集 | 顶层块 | 可选 `cite`(过 safeHref) | ✅ |
| **Table** | `<table class="ws-table">[thead?][tbody]` + 入盘 `#ws-table-style` | 见下 | cell 内全集 | 不可嵌块/表 | 见下 | ❌ 未实现 |
| **Divider** | `<hr>` | 无 | 无 | 顶层块 | 无（裸） | ✅ |

**小样例（裸挂 body，canonical）：**
```html
<h1>季度复盘</h1>
<p></p>
<h2>本季<b>关键</b>结论</h2>
<p>切到 <code>iframe</code> 直载，<a href="https://x.com">见调研</a>。</p>
<ul class="ws-todo"><li data-checked="true">写草案</li><li data-checked="false">评审</li></ul>
<blockquote>引用，可带<b>加粗</b>。</blockquote>
<div class="ws-callout">提示：可带<i>行内标记</i>。</div>
<hr>
```

**空块入盘 = 字面空标签**：`<p></p>` / `<h2></h2>`，不塞 `<br>`/`&nbsp;`/filler。空块靠 `data-ws2-root` + CSSOM 撑行高（交互态、存盘剥除）。

### 2.2 To-do 入盘样式（语义 CSS 范式样板）

```html
<style id="ws-todo-style" data-ws-schema-css>
.ws-todo{list-style:none}
.ws-todo>li{list-style:none;position:relative}
.ws-todo>li::before{content:"";position:absolute;left:0;top:.3em;width:15px;height:15px;
  box-sizing:border-box;border:1.5px solid #b5b9c0;border-radius:4px;background:#fff}
.ws-todo>li{padding-left:22px}
.ws-todo>li[data-checked="true"]{color:#8a8f96;text-decoration:line-through}
.ws-todo>li[data-checked="true"]::before{content:"\2713";border-color:#1a73e8;background:#1a73e8;
  color:#fff;font-size:11px;line-height:13px;text-align:center}
</style>
```
注意：① 加 `data-ws-schema-css`（排除 `docHasAuthorStyles`，§7 C2）；② checkbox 用 `left:0;padding-left` 内缩，**不用 `left:-20px` 负偏移**（防容器贴边裁切，§7 语义损失 1）。

### 2.3 Table 文法（v1）

```
table     := <table class="ws-table"> thead? tbody </table>
thead     := <thead><tr> th{N} </tr></thead>     // 至多一行表头
tbody     := <tbody> (<tr> td{N} </tr>)+ </tbody> // ≥1 行
th        := <th scope="col" [class="ws-al-center|ws-al-right"]> phrasing </th>
td        := <td [class="ws-al-center|ws-al-right"]> phrasing </td>
```
不变式：**矩形**（每行恰 N 格）、**无合并**（禁 `colspan`/`rowspan`）、**单元格 phrasing-only**、表头至多一行在 thead、无 caption/colgroup/tfoot。对齐用有限 class `ws-al-*` + 入盘 CSS（`text-align`，非定位、非任意 inline style）。

### 2.4 Toggle 持久态

展开/收起 = `<details>` 的 `open` 布尔属性有无（真内容、存盘保留、零 JS）。view/独立浏览器靠 UA 点击 `<summary>` 翻转（已实证：sandbox 无 allow-scripts 下原生 toggle 仍触发）；编辑期用**父层 renderer** + `data-ws2-ui` 三角翻转（不依赖 iframe JS、不依赖"contenteditable summary 是否还能原生 toggle"这个未实证项）。**`open` 的语义未决**：Notion 是会话态、`<details open>` 是持久态，需拍板（§7）。

---

## 3. 行内标记规格

| 标记 | canonical 标签 | 属性 | 产出路径 | 跨块 |
|---|---|---|---|---|
| Bold | `<b>` | 无 | `execCommand('bold')` + 强制 `styleWithCSS=false`（`:440`） | 自由跨块（逐块） |
| Italic | `<i>` | 无 | `execCommand('italic')` | 同上 |
| Underline | `<u>` | 无 | `execCommand('underline')` | 同上 |
| Strikethrough | `<s>` | 无 | `execCommand('strikeThrough')` | 同上 |
| Inline code | `<code>` | 无（**内只放文本**） | `surroundContents`（`:524`） | **跨块拒绝** |
| Link | `<a href [title]>` | `href` 过 `safeHref` | `createLink`（`:514`） | 见 §7（无守卫） |
| 文字色 | `<span style="color:…">` | — | `wrapInlineStyle`（`format.js:49`） | **跨块拒绝** |
| 高亮 | `<span style="background-color:…">` | — | 同上 | **跨块拒绝** |
| 软换行 | `<br>` | — | Shift+Enter（`:805`） | — |

**叠加/嵌套规则**：行内标记互嵌自由、顺序无关（`<b><i>x</i></b>` ≡ `<i><b>x</b></i>`）。硬约束三条：① `<a>` 不嵌 `<a>`；② 行内里不放块级（跨块拒绝守卫物理保证）；③ `<code>` 内只放文本。

**`safeHref`（`format.js:70`）**：trim + 剥控制/空白字符防绕过，放行 `http/https/mailto/tel` + 无 scheme（相对/锚点/协议相对），拒绝 `javascript:/data:/vbscript:/file:` → null → 不写入。`<a>` 上禁一切 `on*` 事件属性，不入 `target`。

**三个 reduced 化决策点（§7 待决）**：
- 色/高亮当前是**任意** inline style 值，不闭合。建议收敛成有限 class 调色板（`ws-color-*`/`ws-bg-*`，6+6）+ 入盘 CSS；高亮**至少**改 `<mark>`（UA 默认黄底兜底，抗 CSP）。
- `b/i/s` vs 语义 `strong/em`：导入容差接受 `em/strong/mark`，canonical 是否归一化。
- 色/高亮缺失 remove（toggle 去除）需补逆动作。

---

## 4. 文档骨架 + Schema 标记

### 4.1 标准骨架

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
<p></p>
</body>
</html>
```

| 节点 | 规则 |
|---|---|
| doctype | **必须 `<!doctype html>`**（标准模式；quirks 会改盒模型破坏 `::before` 度量）。serialize 原样透传 doctype。 |
| `<html>` | 一个 head + 一个 body。`lang` 建议、`dir` 可选。 |
| `<head>` | 允许：`<meta charset>`(首个)、`<meta name=wordspace-schema>`、可选 viewport/generator、一个 `<title>`、**仅编辑器托管的语义 `<style data-ws-schema-css>`**。**禁止**：`<base>`、`<script>`、作者排版 `<style>`/`<link>`。 |
| `<body>` | Schema 块序列，canonical = **扁平直接挂块、无包裹容器、blockRoot 唯一**。 |

### 4.2 Schema 标记

`<meta name="wordspace-schema" content="1">`，放 head、紧跟 charset。`content` = 格式身份号（预留 `1.x`）。可选 `<meta name="generator" content="Wordspace x.y.z">`（答"谁造的"，与格式戳分开）。

**绝不用 `data-ws2-` 前缀**（会被 serialize 剥/混淆）。

### 4.3 标记 = advisory，校验器 = 权威（核心立场）

- **盖戳**：存盘时幂等写入（已有不重复，版本不同则覆盖）。
- **读取**：打开时当参考。标记说"我是 1" **不等于**它合法（可缺失/写错/漂移/恶意）。
- **裁定**：一个**确定性纯函数校验器**（纯逻辑模块，对标 `va-eval.js`，jsdom 可单测）遍历 DOM 核对"允许标签/属性/嵌套"。它是唯一权威。
- **三条铁律**（对抗阶段 F4）：① **绝不因 meta 自称 "1" 就跳过校验**（防伪造 meta 混入 `<script>`/`on*`）；② 校验必须跑在**磁盘字节 reparse 出的 DOM** 上，不跑编辑器活 DOM、也不跑 `cleanRoot` 后的有损 DOM；③ **状态只认属性、不认视觉**——勾选态唯一权威是 `data-checked` 值，`::before content` 是不可信衍生物（防恶意预置 `#ws-todo-style`）。
- **缺标记 ≠ 非 schema**：手写的合法文档照判合法。不静默给外来文档盖戳（除非用户显式"转为 Schema 文档"）。

---

## 5. Media 建议

先分清两层：(A) 存盘 .html 在普通浏览器打开能不能渲染/播放（决定 schema 合法性）；(B) 在编辑器 iframe 里表现对不对（受 sandbox 限制，File/bookmark 会分叉）。

**关键事实**：data: URI 实践 DOM 内嵌 ~2MB 起卡（远低于 512MB 硬上限）；base64 +33%；`<video>/<audio>` data: 仅 <1MB 稳（再大 seeking 坏、duration Infinity）；`<img>` data: 全平台稳。

| 块 | 元素 | 结论 | 理由 |
|---|---|---|---|
| **Image** | `<img>`（caption 用 `<figure><figcaption>`） | **现在加（Tier 1）** | data: base64 内联真单文件干净；`classify` 已认 IMG；定为原子叶子块、整块灰选 |
| **Code** | `<pre><code>` | **现在加（Tier 1）** | 纯文本零 media 问题；高亮**编辑时预渲染**成着色 `<span>` + 入盘 CSS，不靠运行时 highlight.js |
| **Video** | `<video controls src>` | **暂缓** | 无云下 data: 撑爆 + 引擎 seeking bug；相对路径破坏单文件，无干净路 |
| **Audio** | `<audio controls src>` | **暂缓** | 同上（轻一档，3min MP3≈4MB base64 已过安全区） |
| **File** | `<a href download>` | **暂缓** | base64 全量膨胀；编辑器 iframe 内下载被 `allow-downloads` 缺失拦死 |
| **Web bookmark** | 静态卡片 `<a>` 包预抓标题/描述/缩略图 | **暂缓** | live embed 靠 JS 全死；需"编辑时抓 metadata"子系统，最像独立产品功能 |

**无云存储可行性直答**：`.html` 全都"支持"（标准元素）。真门槛是资源数据放哪——Image/Code 干净（图片小尺寸 data: 内联、代码即文本），**进 Schema #1**；Video/Audio/File/bookmark 不卡合法性、是纯增量，但都**阻塞于一个未决的"文档+资源"打包/sidecar 约定**，Tier 2 推迟。Schema #1 文档里要**显式记一句"media 资源模型 = 未决，Tier 2 阻塞于此"**。

护栏（写进 spec 注意事项，非 schema 规则）：图片编辑时自动降采样（长边 ≤1600、单图 base64 ≤1.5MB），防用户塞 10MB 原图卡 DOM。

---

## 6. 编辑行为安全变换表

每个动作的闭合 = "合法进 → 合法出"，靠列出的守卫。要守的不变式：**I1** 顶层块扁平不互嵌；**I2** `ul/ol` 直接子只 `<li>`；**I3** 叶子块只装 phrasing；**I4** id 全局唯一；**I5** 干净存盘无 `data-ws2-*`；**I6** 表格矩形 + summary 首子等结构不变式。

| 动作 | 变换 | 关键守卫 | 边界 / 状态 |
|---|---|---|---|
| **打字 / IME** | 单块 contenteditable 内原生文本插入 | contenteditable 宿主=**单块**（`:299`）；列表光标下放 `<li>`（`:318`）；Enter/paste 不交原生 | ✅ 闭合（out≡内容层不变）。空块/选区替换/行内边界均安全。⚠ 跨块选区打字=no-op 不替换（缺口，§7） |
| **Enter 换段** | list 专路 / `splitBlock` 劈同标签兄弟 / 块末新 `<p>` | `splitBlock`（`:487`）手工建同标签兄弟、`extractContents` 劈跨界行内、剥后块 id；`isCaretAtRealEnd`（`:137`）严格分流 | ✅ text/h/quote/callout/list。❌ toggle/cell 未接 Enter 专路=fall-through 劈出残缺 `<details>`/游离 `<td>`（落地前必堵） |
| **块首 Backspace** | 删空块 / 叶子合并 / 并入列表 / list 首 li 跨块并入上一块 / 拒绝 | `isLeafTextBlock`（`:60`）双向把关；并列表包 `<li>`；prev 不可编辑则 no-op；**list 首 li 行首**：并入上一块（上块是 list→接其末项；是叶子文字块→接其末尾；空 ul 删掉；有子列表的 li 不动） | ✅ 主路径。**list 内非首 li 退格交原生（ul 内 li→li 合并，正确）；首 li 行首改为自己跨块并入上一块**——原来整个交原生，但块间是独立 contenteditable、原生跨不过去 = 第二个 list 块行首退格「哑掉、不上移」（Wendi bug3，2026-07-21 修）。⚠ 并列表/跨块删缺 leaf 守卫（§7 B1/B2） |
| **Tab/Shift-Tab 缩进** | list 项移入/移出子列表 | 缩进只在 `prev.tagName==='LI'` 时动（`:859`，杜绝子列表直挂 ul）；子列表幂等去重 | ✅ list。⚠ 子列表 tag/class 抄"顶层 list"非"直接父"（`:862`，混合嵌套类型错乱/丢 ws-todo，§7 D3）。❌ toggle/table 未接 |
| **↑/↓ 跨块导航** | 纯光标移动 | **零内容写入**；`isEditableEl` 决定 enterEdit vs selectBlock | ✅ 最强闭合（out≡入逐字节）。保列位 best-effort。table/toggle 落地需扩展 |
| **turn-into 转块** | retag + 内容模型适配 | A→A 裸 retag；A→B 包 `<li>`（`:373`） | ✅ A→A、A→B、B→B。❌ **list→A 留孤儿 `<li>`**（§7 A1 真 bug）；⚠ 非叶子源→phrasing 越界、todo→list 留 `data-checked`（§7 A3） |
| **拖动重排** | `before/after` 搬整块 | `blockOf`（`:222`）把源和落点钉死在 blockRoot 直接子层 | ✅ 最易闭合（只置换顶层兄弟、零内部改动）。故意不支持跨层/列表内拖拽 |
| **To-do 勾选** | 翻转 `data-checked` | 值域 `{"true","false"}` 三元钳住（`:694`）；落点 `parentElement===todoUl` 守卫 | ✅ 最干净（封闭值域改一属性）。脏值首次 toggle 收敛进合法集 |
| **行内标记** | 见 §3 | color/code 跨块拒绝（构造性闭合）；B/I/U/S 逐块 styleWithCSS=false | ✅ color/code 最稳。⚠ B/I/U/S 跨 list 押原生 execCommand 行为（§7 E 需 e2e 实证）；⚠ link 守卫最弱 |
| **粘贴** | `sanitizeToBlocks`（default-deny 白名单）∘ `splice`（上下文敏感） | 离线 DOMParser；整体丢 script/style/危险标签；剥 on*/id/class；safeHref 过链接 | ⚠ 当前仅纯文本地板（`shell.js:116`）；富粘贴待实现。**禁用 `insertHTML`**（盲插破嵌套）。表格/toggle 有损降级；图片缺口；script 净化只能 ingest 做（serialize 不兜） |

---

## 7. 已知漏洞 / 待决问题（按严重度 + 收口）

### A 档：纯编辑器操作就落盘非法/越界（必修，ship-blocker 级）

**A1 [真 bug·UI 三入口可达] turn-into 列表→引用/正文/标题留孤儿 `<li>`。**
`<ul>` 点"转为引用" → `turnInto` 走通用分支（`:386`）裸 retag → `<blockquote><li>x</li></blockquote>` = 非法 HTML 落盘。入口：fmtbar 转为菜单（`:590`）、块菜单转为引用（`:617`）、空列表斜杠（`:670`）。根因=`turnInto` 不对称（转入列表包 `<li>`、转出不拆）。**收口**：B→A 前把每个 `<li>` 拍平为行内（`<br>`/空格分隔、嵌套子列表先 flatten）再 retag，覆盖三入口。

**A2 [真 bug·证伪 spec 自报红线] 块菜单调色板往块上写 `style` 属性。**
块菜单颜色行（`:624-627`）对每个块执行 `el.style.color = c`，`retagElement` 跨 turnInto 保留、serialize 不剥 → 落盘 `<ul style="color:…">`/`<h2 style="…">`。直接违背 text+heading §5 自称的"绝不往块写 style"（这条还被当闭合论据=S4 假绿）。**收口**：块级颜色也收敛成有限 class + 入盘 CSS，别 `el.style.x=`；同步把 spec §5 改成事实描述。

**A3 [越界] turn-into todo→普通 list 留孤儿 `data-checked`。**
摘 `ws-todo` class 时（`:371`）不清 li 的 `data-checked` → `<ul><li data-checked="true">`，越界 + `::before` 选择器失配成死规则。**收口**：摘 class 时连带 `querySelectorAll('li[data-checked]').forEach(li=>li.removeAttribute('data-checked'))`。

**B1 [真 bug·守卫不对称] `deleteSelection` 跨块合并缺 `isLeafTextBlock` 守卫。**
合并分支（`:474`）只查 `isEditableEl + 非 list`，不查叶子。透明包裹块 `div.lead>p`（`isTextEditable` 可编辑、编辑器明确支持）被拖选跨块删 → `<p>fo<p>bar</p></p>` 嵌套 `<p>` 落盘。折叠 Backspace（`:904`）有此守卫、跨块选区删没有。**收口**：合并前加 `isLeafTextBlock(sBlk)&&isLeafTextBlock(eBlk)`，两条删除路径共用同一道闸。

**B2 [真 bug·同根] Backspace 并入列表（`:891`）缺 leaf 守卫。**
cur 是 wrapper 时无条件搬进 `<li>` → `<li><p>b</p></li>` 越出 reduced li 模型。**收口**：加 `isLeafTextBlock(cur)` 守卫。

### F 档：存盘/保真层（F1 ship-blocker）

**F1 [致命·实测复现] `cleanRoot` 按属性名删整节点 → 用户内容静默删光。**
`serialize.js:20` `querySelectorAll('[data-ws2-ui]').forEach(n=>n.remove())` 按名删整子树，不区分是不是编辑器自建。用户文档带 `data-ws2-ui` 的元素（CMS 标记/老残留）首次保存连内容消失。白名单里 `data-ws2-block/-container/-eid` 编辑器已不再 emit、纯剩误伤。**收口**：覆盖层节点创建时（`mk()`，`:192`）登记进 `WeakSet`，`cleanRoot` 只删登记过的节点，永不 `querySelectorAll('[data-ws2-ui]')`；属性剥除同理只剥本会话加的；删掉已退役名字。

**F2 [高·宣传矛盾] 存盘是 DOM 重序列化、非字节保真。**
`serializeDocument` 走 `outerHTML` + 硬编码大写 `<!DOCTYPE`：改一个词 = 全文件 reflow（大小写/引号/实体/void 风格/缩进全变），git diff 爆炸，跨机器/跨 Chromium 版本还不一致。**收口**：要么宣传降级为"DOM 等价保真"并写进 spec；要么把归一化形态本身定为 canonical（第一次存盘后稳定、不再每次抖），至少对 doctype/void/实体做确定性一次性归一。

**F5 [低·一致性] export 路径（`shell.js:447`）另一套硬编码剥除名单，会漂移。** 收口：export 与存盘共用 `WS2_MARKERS` + 同一 clean 函数。

### C 档：闭合到磁盘的视觉/版式（ship 前必堵）

**C1 [真缺陷·实测] callout 无入盘 CSS，存盘后是无样式纯文本。**
全文件无 `ensureCalloutStyle`；callout 盒样式只在 `[data-ws2-canvas] > .ws-callout`（`:1111`，CSSOM 不序列化）。存盘 `<div class="ws-callout">` 在任何浏览器/重开有作者样式的文档里 = 无背景无边框普通文字，语义全丢。**收口**：加 `ensureCalloutStyle` 照 todo 范式注入盘 `<style id="ws-callout-style" data-ws-schema-css>`，`EDITOR_CSS` 那条收敛（单一真相）。

**C2 [真 bug·版式漂移] `docHasAuthorStyles` 把编辑器自注入 style 误判为作者样式。**
`docHasAuthorStyles`（`:102`）= `style:not([data-ws2-ui])` 计数；`ws-todo-style` 无 `data-ws2-ui`（故意入盘）→ 存过待办的裸 body 文档**重开掉 820 窄栏 canvas 版式**。callout/table/色板入盘后放大到"几乎所有非纯文本文档"。**收口**：所有语义 `<style>` 打 `data-ws-schema-css`（`data-ws-` 前缀，serialize 保留、不被剥），判定改 `style:not([data-ws2-ui]):not([data-ws-schema-css])`。**这一个修法同时解 C1/C2/语义损失/骨架簇 §6.1。**

### S 档：结构歧义 / 内容模型盲（导入/操作可达，校验器兜）

**S1 透明 `<a>` 包块级骗过 `isLeafTextBlock`**（只查直接子）→ 合并产嵌套 `<p>`。收口：`isLeafTextBlock` 对 `<a>` 递归确认无块级，或校验器解包块级链接。
**S2 `<li>` 内容模型跨簇自相矛盾**（lists 簇一处说无 `<p>`、§6.1 又说允许）。收口：一锤定音 canonical = 裸 phrasing + 可选尾随子列表，删模棱两可句。
**S3 尾随子列表"必须末位"无人强制** → `<li>text<ul>…</ul>tail</li>` 勾选语义乱。收口：校验器规范化。
**S4 block 身份=裸 class（无命名空间）** → 导入文档 `ws-callout`/`ws-todo` 碰撞、turnInto 静默改作者 class。收口：schema class 全 `data-ws-schema-*` 化 + meta 作为"按 schema 解释"的前提开关，或校验器结合"有无配套入盘 style"综合判定。
**S5 空结构容器**（`<ul></ul>`/空 table/空 thead）语义未定。收口：校验器列为非规范 + 修复动作。
**S6 `<details>` 缺/多 `<summary>`**。收口：校验器强制恰一个 summary 首子。
**S7 `<img>` 双重身份**（既 inline 又块）。收口：拍板 inline image 是否进 Schema #1。
**S8 h4/h5/h6 不被 classify 认 heading**，h5/h6 静默繁殖。收口：classify 纳入 H4 + 校验器定 h5/h6 normalize 规则。
**S9 注入 style 固定 id 与内容 id 碰撞**（`getElementById` 去重被作者 `id="ws-todo-style"` 骗过 → 不注入 → checklist 全废；粘贴产重复 id）。收口：用 `head.querySelector('style[data-ws-schema-css="todo"]')` 属性查重，不依赖内容 id 空间。
**S10 body 下多容器→"什么是块"歧义**（两栏布局塌成一个灰块）。收口：骨架簇显式声明 canonical=扁平挂块、blockRoot 唯一；校验器对多容器导入文档降级。

### D 档：已知待堵（中低）

**D1** 嵌套子项 Enter 退出留空 `<ul></ul>`（`:811`，应 promote 一级）。
**D2** `tryMarkdown` 无 `isComposing` 守卫（`:1014`，IME 组词可被吞）。
**D3** Tab 子列表抄"顶层 list"非"直接父"的 tag/class（`:862`，混合嵌套类型错乱/丢 ws-todo）。收口：来源改 `li.parentElement`。
**空块表示二义** `<p></p>` vs `<p><br></p>` vs `<p>text<br></p>`（尾随 br 是软换行还是 filler）。收口：定 canonical = 字面 `<p></p>`，serialize 前归一删纯 filler `<br>`。

### E 档：经验性闭合，必须 e2e 实证（本仓"教训要实证"）

**E1 execText（B/I/U/S）跨 list 项交原生 execCommand**（`:430`），闭合押在 `:418` 注释里那句"已 fact-check"。Chromium 原生 bold 在多 `<li>` contenteditable 上是否产 `<ul>` 直挂 `<b>`/裸文本无自动断言。**收口**：e2e 变异探针——多项列表跑 B/I/U/S 后断言 `ul > :not(li)` 为空、每 li 仍 ul 直接子，在真 Electron renderer iframe 跑。
**E2 toggle `<details>` 在 sandbox 无 allow-scripts 下展开收起**（原生 toggle 已验，但 contenteditable summary 是否抑制 toggle 未验——设计已用父层三角绕开，降为 ship 前确认项）。

### 跨簇决策点（需 Colin/Wendi 拍板）

1. **色/高亮**：任意 inline style（抗剥离、死于严 CSP）vs 有限 class（死于剥离、可 CSP-nonce）。建议高亮改 `<mark>`，text color 接受"严 CSP 不显示"为已知限制。
2. **保真哲学**：save 坚持纯内容（裸 body + 仅语义 CSS），"带全套样式自呈现"做成 export/publish 时一次性烘焙（注 `data-ws-schema-css` 的全套 `<style>`），不每次存盘背着。
3. **toggle `open` 语义**：持久态 vs 会话态。
4. **quote/callout/li/cell 内部模型**：v1 全锁 phrasing-only（最少代码风险、闭合现成），多段/嵌子块推迟。
5. **heading 上限 h4**：h5/h6 保留还是归一。
6. **table 合并格**：v1 禁 colspan/rowspan，导入带 span 的表由校验器拒绝行/列操作或规范化。

### 实现总账（三类根因 → 三个统一修法）

1. **"内容模型盲"类**（A1/B1/B2/S1/S2/S3 + turn-into/cell）：根因=`isLeafTextBlock` 只查直接子 + `retagElement`/合并/turnInto 不查目标内容模型。**统一修法 = 一个内容模型适配/校验纯函数**（jsdom 可单测，对标 `va-eval.js`），merge/split/turn-into/paste 全过它。**最高优先级**（产真·非法 HTML）。
2. **"身份/存盘靠裸标记"类**（A2/F1/S4/S9/C2）：裸 class 当身份 + 固定 id 去重 + 按属性名删节点，全和作者命名空间碰撞。**统一修法 = schema 标记全 `data-ws-schema-*` 化 + meta 作前提开关 + 覆盖层走 WeakSet 而非属性查询 + `docHasAuthorStyles` 排除标记**，合并成一套。
3. **"退化结构无人判"类**（S5–S10/D 档/空块）：合法 HTML 但 schema 语义未定，编辑守卫挡不住（从 import/paste 进来）。**统一修法 = 确定性校验器 + 明确规范化规则**，兑现 §4.3"标记 advisory、校验器权威"的立场——目前校验器只是声明，规则清单 = 上面每条的"收口"。

---

**给 ce-plan 的执行切片建议**：先做 C2 的 `data-ws-schema-css`（一改解多 bug、解锁 callout/table 入盘）→ 内容模型适配纯函数（堵 A1/B1/B2，最高危）→ 校验器 v1（S/D 档兜底 + §4.3 三铁律）→ A2/A3/D3 收口 → H4 接线（轻，2 处 + 核对 SLASH_ITEMS 下标）→ 富粘贴 + Image/Code（Tier 1 media）→ toggle/table（各需"改四处" + Enter/Tab/Backspace 专路 + e2e 实证）。