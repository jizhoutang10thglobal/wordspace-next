---
name: wordspace
version: 1.0.0
description: 为 Wordspace 生成或编辑 .html 文档时使用。当用户要求写一份 Wordspace 文档、修改一份 Wordspace 的 .html 文件、或提到「Wordspace Schema」「合规 HTML 文档」时触发。产出必须通过 Wordspace 的确定性 Schema 校验器。
---

# Wordspace 文档创作

你要为 Wordspace（HTML-native 本地文档编辑器）生成或编辑 `.html` 文档。Wordspace 用一个**确定性校验器**检查每份文档：合规 → 用户获得完整的结构化编辑；不合规 → 降级为基础编辑。你的目标是**一次产出合规的 HTML**。

## 第一步：确定 Schema

Wordspace 的文档按 **Schema（范式）** 组织，每个 Schema 有自己的规范文档：

| Schema | 范式 | 规范 | 怎么认 |
|---|---|---|---|
| **#1** | 类 Notion 文档流（标题/段落/列表/表格/折叠块） | `references/schema-1.md` | `<head>` 里有 `<meta name="wordspace-schema" content="1">` |

- **生成新文档** → 目前只有 Schema #1，直接用它。
- **编辑已有文档** → 看文件 `<head>` 的 `wordspace-schema` meta 选对应规范；没有这个 meta 的按 Schema #1 处理。（meta 只帮你选规范；Wordspace 校验器判合规不看 meta、只看真实结构，认错也有校验器兜底。）
- 未来新增 Schema / 装饰模板时，此表扩行、规范在 `references/` 下并列——更新本 skill 即获得全部新能力。

## 怎么做

1. **先读对应规范全文**（Schema #1 = `references/schema-1.md`）——它定义了能写什么（顶层块/行内标记/表格/折叠块）、不能写什么（硬禁清单）、以及用户要求违规时的合规替代对照表。产出前必须读完。
2. **生成**：从 `<!doctype html>` 到 `</html>` 输出完整文件，`<head>` 带 `<meta name="wordspace-schema" content="1">`，`<body>` 直接平铺块。
3. **编辑已有文档**：只改用户要求的部分，其余内容原样保留；改完输出完整文件。
4. **规则优先于用户要求**：用户要求违规的东西（脚本按钮、合并单元格、单元格里塞列表、给标题上样式…）时，按规范的替代对照表用合规写法实现意图；没有替代就不做那一处，并向用户说明原因。

## 硬底线（Schema #1，详见规范 §6）

- 不写 `<script>`、不写 `on*` 事件属性、href 不用 `javascript:`/`data:`。
- 块级元素不带 `style`（颜色写到块内的 `<span style>` 上）。
- 表格禁 `colspan`/`rowspan`、必须矩形、单元格只放文字+行内标记。
- 标题封顶 `h4`；没有裸 `<div>`/`<section>` 容器；`<head>` 不放你自己的 `<style>`/`<link>`/`<base>`。

## 验证

产出的文件在 Wordspace 里打开即自动校验。若本机有 Wordspace 仓库，也可以直接跑：
`node scripts/validate-schema.js <file.html>`（退出码 0 = 合规，stdout 给 JSON violations）。
