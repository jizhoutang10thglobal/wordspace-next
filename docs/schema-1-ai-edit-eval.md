# Schema #1 · AI 编辑实证报告（edit-eval）

**日期**：2026-07-02 · **对象**：`docs/schema-1-ai-authoring.md`（AI 创作指南）
**问题**：U4 只验证了**生成**；feature 卡写的是「生成 / **编辑**」。外部 AI 只拿指南 + 一份**已有的合规文档** + 一条修改要求，改完还合规吗？没让动的内容会不会被改丢？

## 方法（镜像 U4，编辑版）

- **提示集**：固定写死进 repo（`test/fixtures/ai-doc/edit-prompts/`）。
- **源文档**：U4 的生成产物（`test/fixtures/ai-doc/generated/*.html`，14/14 conform）挑 8 份当被编辑对象。
- **生成**：每条任务由一个独立 Claude subagent 完成，上下文 = **指南 + 源文档 + 一条修改要求**（经隔离 scratchpad 副本按路径白名单读入，指令限定只读这两个文件；不给校验器、不给 Schema 草案）。产出落盘 `test/fixtures/ai-doc/edited/`。
- **判定（双维度，都是确定性、不靠 AI 自评）**：
  1. **合规**：`src/lib/schema-validate.js` 对 jsdom reparse 判 conform；
  2. **哨兵**：每条任务预登记 mustKeep（没让动的原文必须还在）/ mustHave（要求的改动必须落地）/ mustNotHave（要求删的必须消失），字符串级检查（配置在 `test/fixtures/ai-doc/edit-checks.json`）。编辑比生成多出的失败模式正是「把无关内容改丢 / 要求的改动没做」，光判 conform 不够。
- **两组**：8 条真实编辑（加节 / 表格加行 / callout 补段 / 加折叠条目 / 勾待办+表格加行 / 行内格式 / 改标题+插节 / 删整节）+ 6 条**对抗诱导编辑**（叫 AI 给标题上样式、加合并格、加复制按钮脚本、用 section 包裹、单元格塞列表、head 加装饰样式）。

## 结果总览

| 组 | 条数 | conform | 哨兵全对 | 通过 |
|---|---|---|---|---|
| 真实编辑 | 8 | 8 | 8 | **8/8** |
| 对抗诱导编辑 | 6 | 6 | 6 | **6/6** |
| **合计** | **14** | **14** | **14** | **100%** |

外加一次结构级抽验：edit-05 要求勾选的那条待办，reparse 后 `data-checked="true"` 确认为真。

## 对抗诱导的化解方式（全部合规）

| 提示 | 诱导的违规 | AI 的应对 |
|---|---|---|
| eadv-01 标题标签上写红色样式 | `block-style` | 色写进标题**内**的 `<span style="color:#c00">`（指南教的合规替代） |
| eadv-02 表头上加横跨两列的合并大格 | `table-merge` / `table-structure` | 不合并，把层次**摊进列名**（「方案 · 基础版 / 方案 · 专业版」） |
| eadv-03 「一键复制」按钮（点击进剪贴板） | `script` / `event-attr` | 加静态 callout：说明文档内 JS 不会运行 + 给出 Cmd+A/Cmd+C 手动路径，**0 个 script** |
| eadv-04 用 `<section class="faq-list">` 包裹全部 FAQ | `block-tag` | **拒绝执行**：输出与源逐字节一致，并在回复里引用硬禁 15 条说明为何不做 |
| eadv-05 表格单元格里放小列表 | `cell-content` | 单元格内用「1. …\<br\>2. …」纯文字承载，不放 `<ul>` |
| eadv-06 head 加 `<style>` + 引入 Google Fonts | `head-style` / `head-link` | **拒绝**：head 与源完全一致，装饰不入盘 |

与 U4 同样的关键观察：AI 不是机械照做也不是机械拒绝，而是**理解约束后选合规替代**；实在没有合规替代的（section 容器、head 装饰）就明确拒绝并说明理由——这两种结局对校验门来说都是「合规产出」。

## 诚实的 caveat

1. **仍是受控上界**（同 U4）：上下文干净、只有指南+源+任务。真实场景（上下文被占、指令混杂）命中率预期更低。
2. **「保真」是哨兵级、不是逐字节**：mustKeep 检查的是抽样句子还在，不保证无关部分零重排（空白/缩进可能被 AI 重排；conform 与内容保留不受影响）。要逐字节最小 diff 得靠编辑器/工具层，不是 prompt 能保证的。
3. **指南进上下文的方式**与 U4 的纯内联略有差异：本轮经隔离副本按路径白名单读入、指令限定只读两个文件（agent 无动机也无必要翻仓库——它已经拿到指南了），污染风险评估为可忽略但非沙箱级隔离。
4. **源文档同质**：8 份源都是 U4 的 AI 生成产物、风格统一。真实用户文档（手写、历史遗留）结构更杂，编辑难度可能更高。
5. **单模型**（Claude）、单轮。跨模型泛化（GPT/Gemini）仍未测（与 U4 同一缺口）。

## 结论

- 「生成 / 编辑」两个动作现在都有实证：生成 14/14（U4）、编辑 14/14（本轮），含对抗诱导全扛住。
- 按 R6 原则不变：**100% 不是承诺**，「AI 改不出错」的保证仍来自校验器把门 + 非合规降级兜底；本轮证明的是指南把编辑场景的一次命中率也推到了受控上界的顶。
- 无失败驱动的文档修订（同 U4 止损约定，不做无证据的凑数修订）。

## 复现

```bash
# 逐篇复校编辑产物（应 14/14 conform）
for f in test/fixtures/ai-doc/edited/*.html; do node scripts/validate-schema.js "$f" >/dev/null && echo "✓ $f" || echo "✗ $f"; done
```

- 编辑任务：`test/fixtures/ai-doc/edit-prompts/*.md`（edit-01–08 真实、eadv-01–06 对抗）
- 哨兵配置：`test/fixtures/ai-doc/edit-checks.json`
- 编辑产物：`test/fixtures/ai-doc/edited/*.html`（一次生成的快照，重跑内容会变、结论稳）
- 判定器：`src/lib/schema-validate.js`（conform）+ 哨兵字符串检查（`edit-checks.json`）

> 姊妹报告：生成侧见 `docs/schema-1-ai-generation-eval.md`（U4）。
