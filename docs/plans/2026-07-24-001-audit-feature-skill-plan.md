# `/audit-feature` skill —— 指哪打哪的 AI feature 审计 plan

2026-07-24。来源:Colin 要一套「AI 模拟人 + 有 taste」的测试系统,经调研(业界实践:UXAgent 模拟用户
/ MLLM-as-UI-Judge / Baymard 95% 方法论)与多轮收敛,拍板为**一个手动触发的 skill**:
`/audit-feature <名字>` → 对指定 feature 跑一轮全套 bug sweep(功能行为 / 后端落盘 / UI·UX taste),
产出分级报告。**已过三路 doc review(一致性/可行性/范围守卫,2026-07-24),修订落在 v2(本文)。**
**执行前必读**(按序):

1. 本文件全文——四条产品拍板 + 已核实事实是设计边界,别自行扩展。
2. `docs/plans/bug-hunt-2026-07-14/README.md` —— 上一轮 AI 探索测试的产出形态与执行纪律(方法论正本
   HARNESS.md 当时没进 git,本 plan 的 U4 负责把它重新沉淀成 skill 的一部分)。
3. `docs/style.md` —— 视觉 rubric 的唯一来源(Wendi 冻结的官方设计语言,U3 从这里提炼)。
4. 仓根 `CLAUDE.md` 的「开发时的测试纪律」——skill 试跑也要守(定向跑、收窄输出)。

## 0. 产品拍板(Colin,2026-07-24,不可自行更改)

- **只有手动触发**。不做合并后自动、不做发版前自动、不做账本/截图库/定时任务。想跑的时候跑一次。
- **优化目标:占机时间最短**(测试期间 Colin 的电脑要可用)。token 成本次要。
  **占机口径(v2 修订,把账算全)**:占机 = app 实例开着的时间。分两段——采证段 ≤15 分钟 +
  对抗验证段 ≤10 分钟,**全流程占机合计 ≤25 分钟**;LLM 思考/判官/写报告全程 app 关闭、零占机。
  批与批之间、段与段之间 **app 必关**(LLM 规划期间不许挂着实例)。
- **行为判官优先级最高**。spec 里行为契约写得少,判官要**自己从 feature 信息拓展出行为预期(UX 预期)**
  再对照实测——这是本 skill 的核心 prompt 工程,见 U2。
- **不确定就问,不许猜**。名字歧义、预期存疑、疑似有意设计、P 级拿不准——都走 AskUserQuestion 找
  Colin clarify,避免错误决策(D6 列了完整触发清单)。

## 1. 已核实事实(别再调研,直接信;可行性 review 已逐条对代码验真)

- **驱动基建全套现成**。e2e 已有 Electron launch seam:`WS2_OPEN_FILE`(`src/main/main.js:524`)、
  `WS2_FOLDER_IN`(`src/main/ipc.js:623`)、`WS2_USERDATA`(`main.js:17`)、`WS2_LANG`、
  `WS2_NO_CLOSE_DIALOG`;菜单动作走 `webContents.send('menu', …)` seam(直接 IPC,不需要窗口焦点)。
  照抄 `e2e/sidebar.spec.js` 的 `launch()`/`openWorkspace()` 模式(13-60 行),别发明新的。
- **⚠ 所有 seam 都锁 `!app.isPackaged`**:审计打的是仓内 dev 构建,不是签名安装版。updater、
  默认打开方式(protocols)这类 **packaged-only feature 审计设备够不着**——D1 解析到这类直接走
  D6 问 Colin(只能人工/真机验),别硬跑。
- **⚠ 驱动器伪影(仓内实证,会造假 finding)**:① CDP 合成键盘**不触发菜单加速器**——
  `page.keyboard.press('Meta+z')` 得到「⌘Z 不撤销」的假 FAIL(`e2e/todo-undo.spec.js:3` 原话),
  加速器类操作必走 menu seam;② **IME/中文输入自动化驱动不了**
  (`docs/features/editor-cross-block-selection.md:42`);③ OS 焦点依赖的行为(如 blur 触发)在
  合成驱动下不可信。这三类见 U4 伪影清单,判官与 skeptic 都要认得它们。
- **CDP 注入不抢真实键鼠焦点**,窗口弹在桌面但电脑可用(e2e 全量 19 分钟宿主实测)。
- **feature → 文件的映射已有基建**:`docs/features/*.md` 每份带「文件映射」表(现有:browser、
  paged-doc、editor-select-all、editor-cross-block-selection、new-document-modal、todo-list 等,
  模板普遍带「有意分歧」章节);没有 spec 的 feature 靠 `git log` + 文件名 grep 推。
- **调研的三条实证结论**(出处:arXiv 2510.08783、baymard.com/blog/ai-heuristic-evaluations):
  ① 视觉/taste 判断 **pairwise 显著好于绝对打分**;② 裸 prompt 泛泛品鉴准确率 ~20%,**收窄成
  逐条可证伪的检查项**才能到人类水平;③ 整体好坏判断可信度 > 细粒度维度打分。
- **上轮试点的血教训**(memory `exploratory-bug-hunt`):subagent 报告全绿≠对,**每个 finding 必须
  独立对抗验证**;jsdom/合成状态会造假象,验证要在真 app 复现。
- **落盘正确性有现成校验器**:`src/lib/schema-validate.js` 导出 `validate(document)`(纯函数,
  传磁盘字节 reparse 出的 Document;jsdom 调用模式见 `test/schema-validate.test.js`)。
- **skill 结构有先例**:`.claude/skills/wordspace/` = SKILL.md + `references/` 按需加载的活样板。
- **docs/qa/ 目前不存在**,本 plan 新建;**报告落 main 必须走 PR**(branch protection,直推 403;
  docs-only 也跑全量 CI ~6 分钟,零占机零 token,挂 auto-merge 即可)。
- **HARNESS.md 不在 git**——U4 从 bug-hunt README + memory 教训重新沉淀,这次进 git。

## 2. 设计决策(D1–D7;v2 = 三路 review 修订后)

- **D1 模糊名解析**:输入可能是「新建文档那个弹窗」这种口语。解析次序:`docs/features/` 文件名+
  标题 → docs 专项文档 → 近期 PR/commit 标题(本地 `git log --oneline origin/main -50`,中文动宾式
  信息量大)→ 代码 grep。唯一高置信候选 → 展示解析结果继续;多候选或低置信 → AskUserQuestion 列
  候选让 Colin 挑;解析落在 packaged-only feature → 问 Colin(§1 第二条)。**绝不带着猜测开跑**。
- **D2 行为判官·两步工作法(核心)**:(a) **预期推导先行**——采证**之前**,判官只凭 feature 名、
  spec(如有)、入口截图,独立写出「预期清单」:一个懂 Notion/现代编辑器习惯的用户对这个 feature
  的行为预期,含边界情况(空态/连续操作/undo/键盘流/亮暗主题)。**中文 IME 维度只标「需真机手测」,
  不下自动化结论**(§1 伪影②)。先写预期再看实况,防「看到什么都觉得合理」的锚定偏差。
  (b) **对照实测**——逐条判五类:符合 / **违反(→finding)** / 预期外但疑似有意设计(→查 feature
  spec 的「有意分歧」清单;**spec 不存在或无此章节视同查不到 → 问 Colin**)/ 无法自动化采证
  (→报告「需真机手测」列)/ 判官拿不准(→问 Colin)。预期清单**原文进报告**,Colin 可纠——
  判官的 taste 错了要能被看见。
- **D3 批式采证(占机最小化)**:探索 agent 预先计划一批操作 → Playwright 脚本一口气执行(LLM 不在
  环内)→ **关 app** → 看证据产物、计划下一批 → 再开。**时间是硬约束**:采证段(实例开着的时间
  合计)≤15 分钟,到点截断收尾,报告标注「采证不完整」;批数是启发(通常 2~3 批),不是硬约束。
  app 实例 ≤2 个(独立 `WS2_USERDATA`)。证据:截图(亮/暗双主题,切换走 menu seam)、
  DOM/computed style 快照、落盘字节、主进程 stdout、console 报错——全落 scratchpad 证据目录。
- **D4 判官阵容(按 Colin 优先级排序)**:**行为判官(主,D2)** > 后端判官(落盘字节过
  schema-validate、主进程日志/console 报错扫描、文件系统副作用核对)> 视觉判官(U3 rubric 按
  component 过滤后判;computed-style 类条目用 DOM 快照判、观感类用截图判;pairwise 只做
  **「亮 vs 暗」**同界面对照,不做绝对打分)。~~真 app vs ui-demo 对照~~(v2 砍,见「明确不做」)。
- **D5 对抗验证(占机已入总账)**:所有 finding 的 repro **合并成单脚本、单实例**,由独立 skeptic
  agent 连跑两遍——**连续 2 次均复现 → verified;任一次不复现 → 「未确认(复现不稳)」进附录**。
  skeptic 证伪规程第一步 = **排除驱动器伪影**:凡涉及快捷键/焦点的 finding,换 menu seam 路径重放
  一次,seam 路径正常 = 伪影,杀。验证段占机 ≤10 分钟,开跑前告知 Colin。
- **D6 clarify 触发清单**(全流程有效,AskUserQuestion):① 名字解析多候选/低置信/packaged-only;
  ② 预期推导中对产品意图拿不准;③ 实测行为疑似有意设计但有意分歧清单查不到(含 spec/章节缺失);
  ④ P 级定不了(丢数据类恒 P1 不用问);⑤ 报告后是否起修。**宁可多问,不许脑补拍板。**
- **D7 报告**:`docs/qa/audits/YYYY-MM-DD-<slug>.md`,结构:审计范围与解析过程 → 行为预期清单
  (判官原文)→ verified finding 分级列表(每条:现象 / repro 步骤 / 证据引用 / 哪个判官发现 /
  验证结论)→ 需真机手测列 → 未确认附录 → 待 Colin 拍板项。**证据引用规则**:verified finding 的
  支撑截图**复制**进 `docs/qa/assets/<YYYY-MM-DD-slug>/`(每张压到 <200KB),报告用相对路径引用;
  未验/被杀的不进 assets,报告正文自足描述、不引用 scratchpad 路径(session 结束即失效)。
  assets/ 口径:只服务报告可读性,**不做检索/比对,不是截图库**;累积量大了由 Colin 拍清理。
  报告走 PR + auto-merge 落 main。P1 经 Colin 点头后直接起 fix worktree 走 PR(人审)。

**明确不做**(v1 边界,别夹带):账本 / 截图库 / 像素哈希层 / 自动触发 / CI 驱动 / `--deep` 逐步
探索模式 / ui-demo 侧审计 / **真 app vs ui-demo 对照截图**(需要一套没人认领的 ui-demo 驱动基建,
真要另立 plan)。

## 3. 执行切片(每片一个 commit)

### U1 · skill 骨架:`.claude/skills/audit-feature/SKILL.md`
主流程 prompt:名字解析(D1)→ scope(读 spec/映射,列关键状态)→ 行为预期推导(D2a,在采证前!)→
批式采证(D3)→ 三判官(D4)→ 对抗验证(D5)→ 报告(D7)。clarify 清单(D6)写进流程各卡点。
判官 prompt、rubric、采证套路放 `references/`(仿 `.claude/skills/wordspace/` 结构;执行时顺手验证
references 确实按需加载——若实测是整吞,就合并回单文件,别为拆而拆)。
**验收**:SKILL.md 里能指着行数找到 D1–D7 每条的落点;一个不认识本对话上下文的冷启动 session
只读 skill 就能跑(U5 用干净 session 真验)。

### U2 · 行为判官:`references/behavior-judge.md`(优先级最高)
两步工作法 prompt 全文:预期推导的角色设定(「懂 Notion/现代编辑器习惯的挑剔用户」,必查维度:
空态/边界/连续操作/undo/键盘流/亮暗主题/与相邻 feature 交界;**IME 维度恒标「需真机手测」**)+
对照阶段的五分类判定规则(D2b)+「拿不准就标记待问,禁止脑补产品意图」硬约束。
**验收(双 case 纸面干跑,不开 app、零占机;防考题泄露的输入定义如下)**:
- **case A(应能推出的预期)**:输入只有 feature 名「跨块选中后直接打字」+ 一句界面描述
  (「块编辑器,已拖选跨越多个块」)。**不给 spec、不许查仓/git log/memory**(干跑时判官作为
  子 agent 只拿这段输入)。合格线:预期清单必须含「打字应替换选区内容」。这是 #324 修前的真实
  盲区,当时 spec 尚不存在——输入即还原当时时点。
- **case B(应识别疑似有意)**:输入 = feature 名「新建文档弹窗」+ 实测行为描述(「模板台只有
  空文档一张卡,无其他模板」),同样不给 spec。合格线:判官必须走「疑似有意设计→需查有意分歧
  清单」分支而**不是**直接报 bug;补给它 `docs/features/new-document-modal.md` 后,必须落到
  「有意设计,不报」。两段推理都要考。
推不出/走错分支 = prompt 不合格,改到通过;两个 case 的干跑记录(纯文本推理)附在 PR 里。

### U3 · 视觉 rubric 种子:`references/rubric.md`
从 `docs/style.md` 提炼 10~15 条**可证伪**检查项,每条:检查什么(具体到 computed style/几何/
可见性)+ 判据 + 判定物料(DOM 快照 or 截图)+ component 标签(sidebar/editor/modal/browser/全局)。
**收录原则**:① 拿不准可证伪性的不收(Baymard 路数:没验证的检查项就是误报机器);② **已有
确定性门的检查不重复收录**(如暗色对比度已由 `e2e/appearance.spec.js` + WCAG 遍历硬门保住——
rubric 重判只会制造误报面)。
**验收(物料自采,占机 ~3 分钟计入本片)**:开一次 app,拍 5 个主界面(起始页/打开文档的编辑器/
新建弹窗/侧栏文件树/浏览器标签页)× 亮暗双主题 = 10 张截图 + 每界面 DOM/computed-style 快照;
rubric 全量干跑,**零误报**(rubric 是窄检查,零误报是合理门槛;误报条目改判据或删)。
注:U5 统计的「误报率」是整份报告(判官+探索)的指标,与本门不是同一个数。

### U4 · 采证 playbook:`references/probe-playbook.md`
把 bug-hunt 试点方法论沉进 git:launch seam 清单(抄 `e2e/sidebar.spec.js` 模式)+ 批式驱动模板
(计划→脚本→**关 app**→复盘的循环约定)+ **驱动器伪影清单**(§1:加速器必走 menu seam /
IME 标不可测 / 焦点依赖态不可信,skeptic 证伪第一步先排伪影)+ 证据目录结构(`shots/` `dom/`
`disk/` `logs/`)+ 双主题截图约定 + 落盘字节采集(编辑动作后读磁盘文件存证)+ 占机纪律
(实例 ≤2 / 采证 ≤15 分钟 / 验证 ≤10 分钟 / 批间必关)。
**验收**:U5 试跑的采证段完全照 playbook 执行,不需要临场发明;占机分段实测达标。

### U5 · 试跑 + 校准
开跑前 AskUserQuestion 让 Colin 挑试跑 feature(给 2~3 个候选,默认推荐「新建文档弹窗」)。
用**干净冷启动 session** 全流程真跑:解析→预期→采证→判官→验证→报告落 `docs/qa/audits/`(走 PR)。
跑完开对齐会:预期清单哪里推歪、误报几条、漏报(Colin 已知但没抓到)几条——**改回 U2/U3 的
prompt**,校准闭环是本片的正经产出,不是跑完就完。
**验收**:Colin 读报告拍「有用/没用」;误报率、分段占机时长、token 实耗三个数进报告尾注当基线。

## 4. 风险与对策

- **预期推导与 Wendi 意图相左** → 预期清单原文进报告可被纠;拿不准就问(D6②);U2 双 case 校准。
- **驱动器伪影混进报告**(最伤信任:Colin 一试不复现,整个 skill 信誉塌)→ §1 伪影清单 +
  U4 写死规程 + skeptic 第一步排伪影 + IME 类恒走「需真机手测」列。
- **误报噪音** → rubric 宁少勿滥 + 不与既有硬门重复 + 对抗验证 + U5 统计误报率。
- **占机超预算** → 分段硬超时(15+10)+ 批间必关 + 验证合并单脚本;超时截断仍出报告(标注)。
- **skill 冷启动跑不动** → U1 自包含验收 + U5 干净 session 试跑。
- **非确定性**(两轮 finding 集不同)→ 定位就是探索器,报告首行明示;回归门仍是 e2e,不混。

## 5. 验收总门

U5 的报告让 Colin 拍板「这东西有用」;**分段占机(采证 ≤15 + 验证 ≤10)实测达标**;U2 双 case
按防泄露输入定义干跑通过;U3 零误报;方法论(playbook 含伪影清单)进 git 不再散佚。
