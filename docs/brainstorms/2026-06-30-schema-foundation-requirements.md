---
date: 2026-06-30
topic: schema-foundation
title: Schema-first 编辑的架构地基（校验器脊梁 + AI 接口 + 合规/非合规分流）
---

# Schema-first 编辑的架构地基

## Summary

给 Wordspace 的 schema-first 编辑定一层贯穿性的架构地基：**一套 Schema 单一真相源 + 一个确定性校验器（脊梁）**；AI 通过一份"AI 可读的 Schema 文档"在范式内生成/编辑（MVP 不上 MCP）；文件按 **"合规 → 完整编辑 / 不合规 → 基础文字编辑"** 分流。"编辑不出 bug"靠**校验器永远把门 + 非合规降级兜底**，而非靠 AI 完美。这层地基托起 3 个 feature（定义 Schema #1、Schema 的 AI 文档、非合规文件的基础编辑）。

## Problem Frame

Wordspace 编辑野生 HTML **bug 不断**，根因 = 编辑器没有一套被强制执行的结构规则，在任意 DOM 上乱编辑、出事后才打补丁。新方向：定义一套受限 Schema（reduced HTML），编辑器与之 co-design、对其操作闭合 → 没有结构 bug。要让 AI（**先外部 agent、后应用内**）在 Schema 内生成/编辑，并让 Wordspace 认出 / 校验文件是否合规。

本文档定的是**贯穿"定义 Schema、AI 接口、非合规文件处理"这 3 个 feature 的共同架构决策**，不铺开每个 feature 的细节设计。

## Key Decisions

- **KD1 — 校验器是脊梁，也是"不出 bug"的真正保证。** 一个**确定性代码**校验器、内置在 Wordspace、是"这份 HTML 算不算某 Schema"的**唯一权威**。文件进入（打开 / 导入 / 吃进 AI 产出）即校验 → 合规走完整编辑、不合规走基础编辑。"不出 bug"来自"**永远把门 + 非合规有兜底**"，不是"AI 保证完美"。
- **KD2 — Schema 单一真相源。** 机器可读那份（驱动校验器）= 权威；人 / AI 读的那份从它派生或与它对应，避免两边漂移。
- **KD3 — AI 接口 = 一份"AI 可读的 Schema 文档"（prompt / documentation），MVP 不上 MCP。** prompt 的作用是**提高 AI 一次产出合规的命中率**，不负责兜底（兜底是 KD1）。**先外部 agent**（读这份文档、产出 `.html` 文件，走文件式回路），**后应用内 AI**（同一套，进程内调）。等需要 AI 交付前自检、或直接操作正在打开的实时文档时，再把校验器暴露成工具（MCP / CLI）——后话。
- **KD4 — 文件内标记（marker）只当"提示"，永不当权威。** 文件里可藏"我是 Schema #1 vN"的标记做快速线索，但识别永远以校验器核实际内容为准 → 篡改 / 漂移天然失效（信的从来不是那个标签）。
- **KD5 — 编辑器对 Schema 闭合 → Wordspace 自己编辑过的文件天然合规，不必反复校验。** 校验只发生在**边界**：打开外部文件、或吃进 AI 产出那一刻。校验是道门卫，不是每步都收的税。
- **KD6 — 非合规文件 = 允许基础文字编辑（粗 / 斜等），复杂编辑流受限**（Wendi 定）。这是"校验失败之后做什么"的答案 = feature 3。

## Requirements

**Schema 与校验**

- R1. 存在一套受限 Schema（reduced HTML）的**单一真相源（机器可读）**，定义允许的结构 / 嵌套 / 样式表达。
- R2. 存在一个**确定性校验器**：输入任意 HTML → 输出"是否合某 Schema + 哪里不合规"；它是合规判定的**唯一权威**，不依赖文件内标记的声称。
- R3. 文件进入编辑器（打开 / 导入 / 吃进 AI 产出）时**自动校验并据结果分流**。
- R4. Wordspace 自身编辑操作**对 Schema 闭合**（合法进 → 合法出），无需对自编辑结果反复校验。

**AI 接口**

- R5. 存在一份**AI 可读的 Schema 文档**，让（外部）AI 理解 Schema 并据此生成 / 编辑出合规 HTML。
- R6. "AI 改不出错"的保证由**校验器（R2）+ 非合规降级（R8）**提供，**不依赖 AI 产出必然合规**。
- R7. MVP **不引入 MCP**；AI 走"读文档 → 产出文件 → Wordspace 校验"的文件式回路。（后续可把校验器暴露为工具供 AI 自检 / 操作实时文档。）

**文件分流**

- R8. **合规文件 → 完整（类 Notion）编辑；非合规文件 → 基础文字编辑**（粗 / 斜等），复杂编辑流受限。
- R9. marker 仅作快速线索，识别仍以校验器为准。

## Key Flows

- F1. **创建 + 编辑合规文档。** 用户在 Wordspace 新建（或 AI 按 Schema 文档生成）→ 校验合规 → 完整 Notion 式编辑 → 编辑闭合保持合规 → 存盘。**Covers R1, R2, R4, R8.**
- F2. **打开非合规 / 野生文档。** 打开 → 校验不合规 → 进基础文字编辑模式（可粗 / 斜，复杂流受限）。**Covers R2, R3, R8.**
- F3. **外部 AI 产出。** 外部 agent 读 Schema 文档 → 产出 `.html` → 用户在 Wordspace 打开 → 校验 → 合规走完整、不合规走基础。**Covers R5, R6, R7, R8.**

## Scope Boundaries

**Deferred / 不在本架构文档铺开（各 feature 详细设计时做）：**
- 编辑器与 Schema 的**具体 co-design**：每个交互动作（箭头键切行 / 元素间切换 / 拖动元素…）如何做成"合法进 → 合法出"的安全变换 —— feature 1 的核心难点，单独一轮做。
- **Schema #1 的具体"允许集合"**（块类型 / 行内标记 / 嵌套规则 / 样式清单）—— feature 1 详细设计。
- 非合规文件"基础编辑"的具体范围 —— feature 3 详细设计。
- MCP / 应用内 AI / AI 交付前自检 —— 后续阶段。

**定位决定（不做）：**
- 不把校验器做成 AI / 概率性的——必须确定性；AI 不作合规权威。

## Dependencies / Assumptions

- 假设 Schema 的允许集合**可表达成机器可读规格并驱动确定性校验器**（标准做法，形态 plan 时定）。
- 依赖"**编辑器对 Schema 闭合**"成立——这是 feature 1 co-design 要保证的，本架构以它为前提。
- **ui-demo 原型化分工**：feature 1 / 3 的**编辑 UX** 在 ui-demo（React）做给 Wendi review；底下的 Schema / 校验器是纯逻辑（浏览器可跑），建议写成**框架无关、易移植**到真 app（vanilla JS）。feature 2 是文档产物、非 ui-demo 内容。注意 ui-demo（TS/React/Vite）与真 app（vanilla-JS/Electron）分属两套构建——**引擎在真 app 仍需各自实现**，UX 那层在真 app 也要 vanilla 重做（可接受：ui-demo 本就是领先、可丢弃的快迭代场）。

## Open Questions

**Deferred to planning / feature design：**
- 引擎（Schema + 校验器）是否做成**可跨 ui-demo 与真 app 共享的框架无关纯 JS**，还是各写各的（取舍：共享省重写，但需打通两套构建）。
- marker 的具体形式 / 位置。
- 何时引入**校验器-as-tool（MCP / CLI）**给 AI 交付前自检。
