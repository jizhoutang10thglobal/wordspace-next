# todo / 列表项的「交互粒度」—— 是否解耦存储单元与交互单元

Created: 2026-07-23
Status: **needs-decision（Colin + Wendi 拍板，见文末开放问题）**
Origin: Colin 2026-07-23 手动测 todo UX sweep 时提的三点吐槽
调研方式: 4 视角并行调研（架构代价 / 产品·Notion 对标 / Schema-1 完整性 / Wendi 范式方向），各自读真代码与愿景文档后合成。

---

## 1. 问题

一个 `<ul class="ws-todo">` 连同里面 N 个 `<li>` 在本编辑器里是**一个块**；每一行 `<li>` 是这个块的子项、**不是独立的块**。根源：`blockOf` 向上爬到 `blockRoot` 的直接子元素为止，而 `<ul>` 就是那个直接子——`<li>` 永远不是「块」；`enterEdit` 把 `contenteditable` 设在整个 `<ul>` 上。Colin 实测三个痛点，本质都是「块粒度 = 整个 ul」的同一个根：

- **⌘A** 一次选中的是「当前块」= 整个列表（他想选中的是当前**一行**的内容）；
- **「转为」（turn into text/toggle）** 作用在整个块 = 整列表一起变（他想只把**那一行**抽出去转）；
- **Tab** = 把当前项嵌到上一项下做子列表（他想要「整行往右**文本缩进**」，不是嵌套）。

这跟 Notion 不同——Notion 每个 checklist 项是独立块，才能单行操作。产品愿景是「对标取代 Notion」。

## 2. 核心张力（四视角共识）

张力的本质**不是「整块 vs 每项独立块」，而是「存储单元」要不要跟「交互单元」解耦**。

- **Notion** 把两者绑死（块 = 项），所以能单行操作——代价是它不承诺磁盘产物是一棵真 HTML 树。
- **Wordspace** 立命之本 = 文档就是干净、可直接发布的 HTML 文件。磁盘上带子项的列表**就是 `<ul><li><ul>…` 一棵树**，不能像 Notion 打散成 body 层平铺的游离 `<li>`（那不是合法 HTML、发布不成列表、且破坏 Schema-1 闭合不变式 I2「ul/ol 直接子只能是 li」）。
- **可行解**：磁盘恒为一个 canonical `<ul>`，**编辑器层给 `<li>` 一个「虚拟块 / 交互单元」身份**——只在选择 / ⌘A / turn-into / 块菜单里把操作单元解析到 `<li>` 而非 `<ul>`，静止时 DOM 形状不变、虚拟块边界永不落盘（serialize 本就按精确白名单剥 `data-ws2-*`）。Schema 视角确认这条 **schema-safe，且最贴现有架构**（存储与编辑器块粒度本来正交，Schema-1 从没规定「一个块 = 一个 ul」）。

## 3. 严重度：劝退级，不是能忍级

产品视角判定这**不是「反直觉但能忍」，而是「劝退级」**，理由是「高频 × 破坏性 × 无预期替代路径」三者叠加，且它直接卡 **North Star 第一阶段验收**（团队日常文档搬进 Wordspace，其中 checklist 是高频原子操作）。

最尖的坑：**⌘A 全选列表 → 随手打字 → 整份 checklist 被一次覆盖**（本问题里唯一到「数据丢失级」的坑）。迁移用户凭 Notion 肌肉记忆，头 5 分钟就会踩到，还没体验到 HTML / 一键发布的好处，就在编辑器手感上流失。所以优先级应按「阻断北极星验收」算，不是按「一个编辑器小 bug」算。

（诚实边界：产品真正的 differentiator——本地 HTML、一键发布、AI 生成——跟这个无关，产品没死；伤害的精确位置是 **getting-started 流失**。）

## 4. 推荐路径：方案 B（整块模型上加项级操作），不是方案 A

- **方案 A「每个 `<li>` 升为独立顶层块」= 动脊椎。** 要么让 `blockOf` 对 li 破例（直接废掉「块 = blockRoot 直接子」这条不变式，`topBlocks` / 箭头导航 / 合并 / serialize / drag / 跨块删除全要重写，正中「共享核心」爆炸半径）；要么磁盘拆成 N 个单项 `<ul>`（磁盘格式变更，结构断言全废、`<ol>` 编号连续性丢、md 往返碎片化）。用一次脊椎重写换 Notion 对等。
- **方案 B「保留整块模型、加项级操作」。** Colin 三个诉求本质都是「只作用于当前行」——那是三处**定点拦截**，不需要重建块模型。保住磁盘 canonical `<ul>` 不变、块身份稳定、e2e 基本不动。**四个视角一致推荐 B。**

### 分阶段（按产品优先级 + 工程依赖）

1. **列表内 ⌘A 分级化 —— 先做，是杠杆点。** 复用王波「Ctrl+A 分级全选」（#264，`docs/features/editor-select-all.md`，`selectWholeDoc`）：给已有分级多插一档 → **① 选当前 `<li>` 内容 / ② 选整个 `<ul>` 块 / ③ 全篇**。频率最高、破坏最强（顺手堵死「全选列表→打字覆盖」的丢数据坑）、复用最多（不是新造轮子）、且**解锁下游 turn-into 单行**（一旦有「选中单个 li」这个操作单元，turn-into 的作用域就能从选区推导）。**小改。**
2. **单行 turn-into 抽出。** 把 `<ul>` 在目标 `<li>` 处劈成最多三个兄弟 `[前 ul][该行内容 retag 成的新块][后 ul]`，每段仍只含 `<li>`、**绝不留孤儿 `<li>`**（复用现成 `flattenListToPhrasing`；本质是 Schema §7 A1 那个 bug 从「整列表转出」到「抽一行」的推广）。离开 todo 时抄 `ws-todo` class 到剩余 ul、清掉抽出行的 `data-checked`。依赖第 1 步的「单 li 选择单元」。**中改，全是加法、不碰 `blockOf`。**
3. **Tab 语义 —— 卡在设计决策，必须先拍板（见开放问题 Q2）。**

## 5. 需要拍板的开放问题（不该我们替 Wendi / Colin 定）

- **Q1（North Star 级取舍）** 值不值得给列表项升「交互单元」——用「block = list 这个最干净闭合模型」的复杂度上升，换 Notion 手感。
- **Q2（最需要先定的一条）Tab 到底要哪种缩进？** Colin 要的「整行文本缩进」在受限 HTML 里**没有干净落点**：数值 margin 被范式约束「缩进/层级用 DOM 嵌套表达、不用数值」+「块级禁 `style`」双重禁掉；嵌套是唯一 HTML-native 的缩进表达（而嵌套正是 Colin 不想要的子列表）。两条出路——
  - **(a)** 新增一档**有限缩进原语** `<li class="ws-indent-N">` + 入盘 baseline CSS + 校验器白名单（照抄表格对齐 `ws-al-*` 范式：有限值域、`:where()` 零权重、随文件走、零 JS）。这是 **spec 决策**，不是实现技巧。
  - **(b)** 告诉 Colin「**嵌套就是 HTML-native 的缩进**」，维持现状。
  - **两个独立视角（产品 + 范式）都判断 Wendi 大概率选 (b) / 顶回**：她已拍过「缩进用嵌套」、Notion 的 Tab 本来也是嵌套——**Colin 这条其实是个人偏好上偏离 Notion，不是 bug**。⚠ 务必先跟 Wendi 当面确认，别当 bug 直接改、返工。
- **Q3** 单行 turn-into 是否接受把一个 `<ul>` 劈成 ul-p-ul（合法 HTML，但改写了「一个列表 = 一个块」的闭合叙事）。
- **Q4** 只给 to-do 特殊待遇（最像「每行独立」），还是三种列表（bullet / numbered / todo）一视同仁。

## 6. 落地注意（Schema 视角的坑，给将来执行用）

① 虚拟块边界只能活在 `data-ws2-*` 标记 / 编辑器逻辑里，**绝不进结构标签**（给 `<li>` 外套 `<div data-block>` 直接违反 I2、校验器当场拒）。
② 劈成多个 `<ul class="ws-todo">` 时每个都留 class、**保持扁平**（勾选框 `.ws-todo>li::before` 是直接子选择器，中间插一层就失配、勾选框不渲染）。
③ 子列表归属定死：每行 li = 一个虚拟块，⌘A 父行**不吞**子行。
④ 每次项级操作后对 reparse 字节重跑 `schema-validate`（铁律③门）；劈出的空 `<ul>`（删完最后一个 li）会触发 `list-child` 违规，同一事务里剪掉。
⑤ 缩进那条虚拟分层**变不出**合法 flat indent，必须走 Q2(a) 的 `ws-indent-*` 扩展，别指望编辑层糊过去。

## 7. 相关

- **源起**：Colin 2026-07-23 手动测 todo UX sweep（PR-A..E 收官后）三点吐槽。
- **代码锚点**：`src/editor/blockedit.js`（`blockOf` / `classify` / `turnInto` / Tab 处理 / `selectWholeDoc`）、`src/editor/schema-validate.js`（`validateList`）。
- **前置能力**：王波「Ctrl+A 分级全选」#264（`docs/features/editor-select-all.md`）——⌘A 分级化直接在它上面加档。
- **Schema 约束**：`docs/schema-1-draft-v0.md` §0/§1（范式约束、块级禁 style、缩进用嵌套）、§7 A1/A3（列表转出不留孤儿 li、离 todo 清 data-checked）。
- **承接**：todo UX sweep 收官（`docs/features/todo-list.md` 全量契约）；本文档是 sweep 之外浮现的**产品方向**问题，独立于那 26 条 bug。
