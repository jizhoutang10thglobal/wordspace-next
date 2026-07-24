# 审计报告 · 新建文档弹窗 — 2026-07-24

`/audit-feature` 首跑(U5 试跑样本)。**探索性发现,非回归门**——同一 feature 再跑 finding 集会不同。

## 范围与名字解析

- 输入:「新建文档弹窗」。解析(高置信,未问):`docs/features/new-document-modal.md` → 真 app `src/renderer/sidebar.js`(`openCreateModal`)+ `browser.css`/`shell.css` + i18n。
- 覆盖:三入口(⌘T→omni / 文件夹「+」→非 omni / 右键新建)、左范式轨(类 Notion / 分页文档 / 范式 3)、模板卡建文档(schema-1 空文档 / schema-2 分页)、关闭方式、omni 地址栏、焦点/键盘、亮暗主题、落盘字节、连续操作。
- 采证:真 app dev 构建 Playwright 驱动,T1–T11 + 分页渲染对抗验证。证据留 scratchpad(session 隔离);关键截图见 `../assets/2026-07-24-new-document-modal/`。

## 行为预期清单(判官采证前定稿)

完整清单 50 条见 [`2026-07-24-new-document-modal-expectations.md`](2026-07-24-new-document-modal-expectations.md)(A 三入口 / B 范式轨 / C 模板卡 / D 关闭 / E omni 地址栏 / F 焦点键盘 / G 亮暗 / H 相邻交界 / I 中文 IME)。判官逐条对照实测,结果如下。

## Finding(verified)

### P3 · 非 omni 新建弹窗打开后焦点没进模态

- **现象**:文件夹「+」/右键「新建文档」打开弹窗(非 omni)后,焦点仍停在触发按钮(`sb-add`),没有移进弹窗;而 ⌘T(omni)打开会自动聚焦地址栏。两入口焦点行为不一致。
- **根因(代码实锤)**:`sidebar.js` `openCreateModal` 的 omni 分支有 `setTimeout(() => omniIn.focus(), 0)`,非 omni 分支走 `modalHead(...)` 且 `modalHead` 内无任何 `.focus()`。→ 非 omni 打开不移焦进对话框,也没有 focus trap。
- **影响**:纯键盘用户经右键菜单「新建文档」打开弹窗后,Tab 会先在文件树里绕,而不是落进弹窗;标准模态 a11y 应在 open 时把焦点送进对话框。鼠标用户无感(P3)。
- **非驱动伪影**:已排除——不是 Playwright 点击残留焦点,而是代码确实没在非 omni 分支移焦(读源码确证,`modalHead` 无 focus)。
- **repro**:右键某文件夹→「新建文档」→ 观察 `document.activeElement`(实测 = `sb-add`,在弹窗外)。
- **建议**:非 omni 分支 open 后 focus 首张卡片(或第一个可用范式),并给弹窗加 focus trap。

## 调查过 · 非 bug(留档,防下次重报)

### CSP inline-style console 报错 —— 良性,已验镜像生效

- 采证时冒出 1 条 `Applying inline style violates ... style-src 'self' file'`,分页文档新建是触发源(`blank-paged.html` 是唯一含内联 `<style>@page` 的落盘物)。
- **查清=非 bug**:srcdoc 文档继承外壳**严格 CSP**(S4 安全红线,不削弱),内联 `<style>` 被拦是**已知刻意副作用**——`shell.js:490-537` 逐字记录了这条 console 串,并用 `adoptedStyleSheets`(constructable stylesheet,CSSOM 不受 `style-src` 限)镜像还原样式。
- **对抗验证(S4 纪律:验样式没静默失效)**:直开分页文档 → docframe `adoptedStyleSheets=4`(镜像已注入)、**console 零报错**、截图分页视图**渲染正确**(白页 + 页边距坐在灰背景 desk 上,见 assets `paged-doc-opened.png`)。@page 真生效,不是静默失效。
- 结论:console 噪声,非缺陷。**别修**(修则要削弱 CSP)。

## 需真机手测(自动化够不着)

- **I1** omni 地址栏中文输入法 composition 期间按 Enter 是否只上屏候选、不误提交导航。
- **I2** 新建文档打开后中文输入首字符是否不丢。
- **R8** 分页卡聚焦描边似有蓝→紫渐变(仅顶/左)——疑偏色或 PNG 抗锯齿伪影,需真机读 computed `outline` 区分。

## 待 Colin 拍板(产品决策,判官不猜)

- **E3** 地址栏「像网址」vs「像搜索词」的判定阈值(spec 未写死)。
- **H3** 非 omni 落盘新建的文档,能否/该不该被全局 ⌘Z 撤销(建文件 vs 撤销的边界)。
- **B5** 灰态「范式 3」键盘语义:彻底跳过(不可聚焦)还是可聚焦但不可激活。
- **F3(小)** omni 弹窗 Tab 序是 地址栏→X→范式轨→pane(X 在范式轨前),与视觉序略不一致;是否要调。(注:「双 X」是误读——那 X 是一个元素带 `sb-modal-x sb-cm-omni-x` 两个 class,非两个元素。)

## 未采证(本轮 probe 没覆盖,如实标,非「符合」也非 finding)

标签区「+」点击(A1)、右键菜单入口(A4)、卡片键盘 Enter/Space 建档(C6)、快速连点同卡去重(C8)、点 X 关闭(D3)、关闭后焦点落点(D4)、空地址栏 Enter(E4)、focus trap 是否闭环 + 纯键盘全链(F1/F2)、temp 临时文档不落盘/成未保存标签(H1)、卡片 hover 前后反馈(C7)。下轮或定向补。

## 符合(逐条对照实测通过,不展开)

三入口打开形态(⌘T→omni 无标题头 + 自动聚焦地址栏 / 文件夹+→非 omni 标题头带真实文件夹路径 / 三入口范式轨都在)、范式轨三档纯切换不关不建、每范式一张对应空卡不串范式、空文档落盘 schema-1、空白分页落盘 schema-2(@page)且分页视图渲染正确、去重命名(未命名 / 未命名 2 / 未命名 3 无覆盖漏写)、Esc/点遮罩关闭无落盘副作用、omni 输网址 Enter 开网页标签不建文档、亮暗两态可读无刺眼。

**有意分歧(spec 已声明,不报)**:真 app 无 `/templates` 模板管理页、模板 blank-only(每范式一张空卡)。

## 尾注(给下次当基线)

- **占机**:采证 ~3 分钟(probe;首跑因脚本漏开工作区重跑一次)+ 对抗验证 ~1 分钟。合计 ~4 分钟,远低于预算(采证 15 + 验证 10)。
- **误报**:硬误报 0。1 条候选(CSP)经对抗验证正确降级为非 bug——这正是「对抗验证」该干的活(不是误报,是「吓人但良性」被查清)。rubric 静态检查 0 误报(建 skill 时 U3 已校准,修过 R1 卡片判据)。
- **token**:U5 判官/agent 约 230k(预期推导 47k + 三判官 181k);token 非约束(Colin 定:省的是时间/占机)。
- **覆盖诚实度**:probe 有明确未覆盖清单(见上),不假装全测了。这是探索器不是回归门。
