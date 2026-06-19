# 编辑器验收期望（editor.expect.md）

> **这是什么。** Wordspace 编辑器的**产品层验收契约**：一组人写的、可证伪的「用户应当能……」期望。
> 不是测试断言、不是实现说明——是「做对了应该长什么样」的标准。验收审计（ui-demo 的
> `ui-demo/audit/`、真 app 的 `scripts/acceptance-audit/`）拿真截图 + DOM 按这份期望判
> make-sense，再人决定修不修。
>
> **谁主导。** 这份契约**由 ui-demo 主导 seed 与演进**（ui-demo 的概念/设计领先于真 app，
> 契约从 ui-demo 流向 app）。真 app 的审计**消费同一份**、向它看齐，不另写一份。
>
> **裁判 ≠ 运动员。** 本文件人写、冻结，受 `.github/CODEOWNERS` 锁。**实现/判定的 AI 只读不改**——
> 不许为了让自己通过而改弱期望。改期望是产品决策，走人审。
>
> **surface 语义。** 每条标 `surface`：
> - `both` —— ui-demo 与真 app 同理，两边都判。
> - `ui-demo` —— 仅 demo 态成立（如 AI 还没上线给「开发中」占位、导出是模拟）。
> - `app` —— 仅真 app 成立（真导出落文件、真 AI 生成内容）。**ui-demo 审计不判 `app` 条目。**
>
> **severity 语义。** `high` = 上手就坏/会误导用户；`medium` = 明显别扭但能绕；`low` = 打磨项。
>
> **status 语义。** 每条可标 `status`：
> - `built`（默认，缺省即此）—— 功能已做，审计照常判 pass/fail。
> - `planned` —— 功能还没做，契约在描述**目标**、不是说 app 坏了。审计判 **pending**、不判 fail；
>   功能真做好了把它翻成 `built`（走 CODEOWNERS review）。
>
> **格式（给解析器）。** 每条期望一个 `### E:<scenario-id> · <标题>` 小节，下接
> `surface` / `severity` / `expect` / `fail-if` 加粗键（可选 `status`，缺省 `built`）。`scenario-id` 对应审计场景 id。

---

## 编辑手感

### E:click-to-edit · 单击即编辑、光标落点击处

- **surface:** both
- **severity:** high
- **expect:** 单击一段文字的中部，应直接进入文字编辑态，光标落在点击的位置附近。
- **fail-if:** 点击后没进入编辑；或光标被甩到段落末尾（与点击处水平偏差远超一个字宽）；或整段被当成一个对象框选、而不是进入文字编辑。

---

## 插入与转换

### E:insert-heading · 插入标题

- **surface:** both
- **severity:** medium
- **expect:** 用斜杠插入「标题 1」后，得到一个可编辑、视觉上明显是一级标题的块，能立即输入。
- **fail-if:** 插入后不可编辑；或渲染成与正文无异的普通文字、没有任何标题样式。

### E:insert-list · 插入列表

- **surface:** both
- **severity:** high
- **expect:** 插入「列表」后，得到一个可编辑、带项目符号的列表；输入文字后回车能产生下一项。
- **fail-if:** 插入后是一个空白、没有任何项目符号的容器；或输入的文字不进入列表项；或回车不分项、堆在同一行。

### E:insert-quote · 插入引用

- **surface:** both
- **severity:** medium
- **expect:** 插入「引用」后，得到一个可编辑、视觉上能一眼辨出（缩进、竖线或底色等）的引用块。
- **fail-if:** 与普通正文没有任何视觉区别；或不可编辑。

### E:insert-callout · 插入提示

- **surface:** both
- **severity:** medium
- **expect:** 插入「提示」后，得到一个用途清晰、视觉成框（有底色/边框/图标等）的提示块，可编辑。
- **fail-if:** 与正文无区别、看不出是提示；或不可编辑。

### E:insert-divider · 插入分隔线

- **surface:** both
- **severity:** medium
- **expect:** 插入「分隔线」后，得到一条清晰可见的水平线作为视觉分隔，分隔线本身不被当文字编辑。
- **fail-if:** 看不到任何线；或这条「分隔线」其实是一个可编辑的空块；或插入后页面没有任何可见变化。

### E:slash-menu-coverage · 斜杠菜单覆盖度与可用性

- **surface:** both
- **severity:** medium
- **expect:** 斜杠插入菜单覆盖常用块类型、命名直白无误导；在文档任意位置（含文末）触发时，菜单都应完整可见、可选。
- **fail-if:** 菜单在文末等位置被视口裁掉，看不全或选不到下方的项；或列出了承诺却用不了的项；或缺少用户合理预期的常用块（如「插入图片」）又没有任何说明。

### E:turn-text-to-heading · 转块保内容

- **surface:** both
- **severity:** high
- **expect:** 对正文块用 ⋮⋮ 菜单「转为标题」后，原文字内容完整保留，并渲染成标题。
- **fail-if:** 文字内容丢失或被清空；或转换后仍渲染成正文；或转换后块变得不可编辑。

---

## 文字格式

### E:format-bold · 加粗

- **surface:** both
- **severity:** high
- **expect:** 选中一段文字点气泡工具栏「加粗」，文字应立即变粗；存盘后粗体仍在内容里（`<b>` / `<strong>` 或 font-weight），不丢。
- **fail-if:** 点了没反应；或视觉变粗但存盘后粗体丢失；或把选区外的文字也加粗了。

### E:link-add · 加链接

- **surface:** both
- **severity:** medium
- **expect:** 选中一段文字点「链接」、填入地址，应生成一个指向该地址、可点的链接，存盘保留。
- **fail-if:** 填了地址不生成链接；或链接指向错误地址；或选中的文字被吞掉 / 替换。

### E:undo-restores · 撤销干净回退

- **surface:** both
- **severity:** medium
- **expect:** 插入或修改一个块后按一次撤销（Cmd+Z 或菜单「撤销」），应干净回到这步之前的状态。
- **fail-if:** 撤销没反应；或只回退了一半、残留半个块；或撤销破坏了文档其余部分。

---

## 安全与保真（红线）

### E:safety-dangerous-link · 危险链接被拒

- **surface:** both
- **severity:** high
- **expect:** 给链接填 `javascript:` 等危险 scheme，**必须被拒绝**：不在文档里生成该链接，也绝不写进磁盘。
- **fail-if:** 危险 scheme 的链接被生成；或被写进保存的文件。

### E:safety-fidelity · 存盘保真、不泄漏编辑器痕迹

- **surface:** both
- **severity:** high
- **expect:** 打开文档、不做任何编辑就存盘，写回的文件应与原文**结构一致**，且**不含任何编辑器运行时痕迹**（`data-ws2-*` 等）。
- **fail-if:** 存盘后结构被改写 / 塌平；或文件里出现 `data-ws2-*` / 编辑器覆盖层节点等痕迹。

---

## AI 入口（demo 态）

### E:ai-entry-slash · /AI 诚实占位

- **surface:** ui-demo
- **severity:** high
- **expect:** AI 尚未上线的 demo 态，用 /AI 触发 AI 入口应弹出诚实的「开发中」提示，且绝不改动文档内容。
- **fail-if:** 真的修改/生成了文档内容（假装 AI 工作了）；或点了没有任何反馈；或报错。

### E:ai-entry-toolbar · 气泡 AI 按钮诚实占位

- **surface:** ui-demo
- **severity:** high
- **expect:** 选中文字后，气泡工具栏的 AI 按钮应弹出同样的「开发中」提示，不改文档、不丢失或替换选中内容。
- **fail-if:** 改动了文档；或吞掉/替换了选中的文字；或无任何反馈；或报错。

---

## 导出（demo 态）

### E:export-pdf · 导出有反馈与收尾

- **surface:** ui-demo
- **severity:** medium
- **expect:** demo 态从「···」菜单导出 PDF，应给出进度反馈并最终给出明确的完成提示，让用户知道导出已发生（即便是模拟）。
- **fail-if:** 点了没有任何反馈；或一直停在「正在导出」不收尾；或报错。

---

## 仅真 app（ui-demo 审计不判）

> 下列条目 `surface: app`，是真 app 才成立的强期望。列在同一份契约里，
> 是为了让 ui-demo 与 app 共享同一张「应当怎样」的地图；ui-demo 审计会按 surface 跳过它们。

### E:app-export-produces-file · 真导出落文件

- **surface:** app
- **severity:** high
- **status:** planned
- **expect:** 真 app 中导出 PDF / Word / PPT 应实际产出一个能打开的文件，并落到用户可见的位置。
- **fail-if:** 只弹提示但没有真实文件产出；或文件打不开 / 内容与文档不符。

### E:app-ai-generates-content · 真 AI 生成

- **surface:** app
- **severity:** high
- **status:** planned
- **expect:** 真 app 中 AI 入口应实际生成或重排内容，并把结果落进文档供继续编辑。
- **fail-if:** AI 入口只给占位提示、不产出内容；或产出与请求无关 / 破坏了已有内容。
