# `/audit-feature` skill —— 指哪打哪的 AI feature 审计 plan

2026-07-24。来源:Colin 要一套「AI 模拟人 + 有 taste」的测试系统,经调研(业界实践:UXAgent 模拟用户
/ MLLM-as-UI-Judge / Baymard 95% 方法论)与多轮收敛,拍板为**一个手动触发的 skill**:
`/audit-feature <名字>` → 对指定 feature 跑一轮全套 bug sweep(功能行为 / 后端落盘 / UI·UX taste),
产出分级报告。**执行前必读**(按序):

1. 本文件全文——四条产品拍板 + 已核实事实是设计边界,别自行扩展。
2. `docs/plans/bug-hunt-2026-07-14/README.md` —— 上一轮 AI 探索测试的产出形态与执行纪律(方法论正本
   HARNESS.md 当时没进 git,本 plan 的 U4 负责把它重新沉淀成 skill 的一部分)。
3. `docs/style.md` —— 视觉 rubric 的唯一来源(Wendi 冻结的官方设计语言,U3 从这里提炼)。
4. 仓根 `CLAUDE.md` 的「开发时的测试纪律」——skill 试跑也要守(定向跑、收窄输出)。

## 0. 产品拍板(Colin,2026-07-24,不可自行更改)

- **只有手动触发**。不做合并后自动、不做发版前自动、不做账本/截图库/定时任务。想跑的时候跑一次。
- **优化目标:占机时间最短**(测试期间 Colin 的电脑要可用)。token 成本次要。目标:占机段 ≤15 分钟。
- **行为判官优先级最高**。spec 里行为契约写得少,判官要**自己从 feature 信息拓展出行为预期(UX 预期)**
  再对照实测——这是本 skill 的核心 prompt 工程,见 U2。
- **不确定就问,不许猜**。名字歧义、预期存疑、疑似有意设计、P 级拿不准——都走 AskUserQuestion 找
  Colin clarify,避免错误决策(D6 列了完整触发清单)。

## 1. 已核实事实(别再调研,直接信)

- **驱动基建全套现成**。e2e 已有 Electron launch seam:`WS2_OPEN_FILE`(冷启动开文件)、
  `WS2_FOLDER_IN`(文件夹选择器返回路径)、`WS2_USERDATA`(独立 profile)、`WS2_LANG`、
  `WS2_NO_CLOSE_DIALOG`;菜单动作走 `webContents.send('menu', …)` seam(不需要窗口焦点)。
  照抄 `e2e/sidebar.spec.js` 的 `launch()`/`openWorkspace()` 模式,别发明新的。
- **CDP 注入不抢真实键鼠焦点**,但窗口会弹在桌面上;实测 e2e 全量在宿主跑 19 分钟期间电脑可用。
  占机的大头是「LLM 在驱动循环里每步等思考」——所以 D3 拍批式,LLM 不进驱动环。
- **feature → 文件的映射已有基建**:`docs/features/*.md` 每份带「文件映射」表(现有:browser、
  paged-doc、editor-select-all、editor-cross-block-selection、new-document-modal、todo-list 等);
  没有 spec 的 feature 靠 `git log --oneline --grep`/文件名 grep/memory 索引推。
- **模糊名解析有真实弹药**:`docs/features/` + `docs/*.md` 专项文档 + 近期 PR 标题(中文动宾式,
  信息量大)。三路交叉后仍多候选 → 问 Colin(D6①)。
- **调研的三条实证结论**(出处:arXiv 2510.08783、baymard.com/blog/ai-heuristic-evaluations):
  ① 视觉/taste 判断 **pairwise 显著好于绝对打分**;② 裸 prompt 泛泛品鉴准确率 ~20%,**收窄成
  逐条可证伪的检查项**才能到人类水平;③ 整体好坏判断可信度 > 细粒度维度打分。U2/U3 的 prompt
  设计直接落这三条。
- **上轮试点的血教训**(memory `exploratory-bug-hunt`):subagent 报告全绿≠对,**每个 finding 必须
  独立对抗验证**(复现 ≥2 次);jsdom/合成状态会造假象,验证要在真 app 复现。
- **落盘正确性有现成校验器**:`src/lib/schema-validate.js`(对磁盘字节 reparse 判合规)+
  `test/` 的 node:test 模式。后端判官验「编辑后落盘的字节仍合规」零成本。
- **docs/qa/ 目前不存在**,本 plan 新建(报告落点)。
- **HARNESS.md 不在 git**——2026-07-14 试点的方法论只活在当时的 scratchpad。U4 从
  bug-hunt README + memory 教训重新沉淀,这次进 git。

## 2. 设计决策(D1–D7,已在对话中与 Colin 对齐)

- **D1 模糊名解析**:输入可能是「新建文档那个弹窗」这种口语。解析次序:`docs/features/` 文件名+
  标题 → docs 专项文档 → 近期 PR 标题 → 代码 grep。唯一高置信候选 → 展示解析结果继续;
  多候选或低置信 → AskUserQuestion 列候选让 Colin 挑。**绝不带着猜测开跑**。
- **D2 行为判官两步法(核心)**:(a) **预期推导先行**——采证**之前**,判官只凭 feature 名、spec
  (如有)、入口截图,独立写出「预期清单」:一个懂 Notion/现代编辑器习惯的用户对这个 feature 的
  行为预期,含边界情况(空态/连续操作/undo/键盘/中文输入/亮暗主题)。先写预期再看实况,防
  「看到什么都觉得合理」的确认偏差(锚定)。(b) **对照实测**——逐条判:符合 / **违反(→finding)** /
  预期外但可能是有意设计(→查 feature spec 有意分歧清单,查不到就问 Colin)/ 判官自己拿不准(→问)。
  预期清单**原文进报告**,Colin 可纠——判官的 taste 错了要能被看见。
- **D3 批式采证(占机最小化)**:探索 agent 预先计划一批操作 → Playwright 脚本一口气执行(LLM 不在
  环内)→ 看证据产物 → 再计划下一批。默认 2~3 批封顶;app 实例 ≤2 个(独立 WS2_USERDATA);
  采证段硬超时 15 分钟,到点截断收尾进判官阶段。证据:截图(亮/暗双主题)、DOM/computed style
  快照、落盘字节、主进程 stdout、console 报错——全落 scratchpad 证据目录。
- **D4 判官阵容(按 Colin 优先级排序)**:**行为判官(主,D2)** > 后端判官(落盘字节过
  schema-validate、主进程日志/console 报错扫描、文件系统副作用核对)> 视觉判官(U3 rubric 按
  component 过滤后判截图;有对照物时 pairwise——「亮 vs 暗」「真 app vs ui-demo 同 feature」,
  不做绝对打分)。
- **D5 对抗验证**:每个 finding 由独立 skeptic agent 证伪——真 app 重放 repro ≥2 次,复现不了就杀。
  需要再开 app 时先告知 Colin(占机)。verified finding 才进报告正文,没验的进附录明示未验。
- **D6 clarify 触发清单**(全流程有效,AskUserQuestion):① 名字解析多候选/低置信;② 预期推导中对
  产品意图拿不准(如「⌘A 三级选择在这个语境该不该生效」);③ 实测行为疑似有意设计但 spec 有意分歧
  清单查不到;④ P 级定不了(丢数据类恒 P1 不用问);⑤ 报告后是否起修。**宁可多问,不许脑补拍板。**
- **D7 报告**:`docs/qa/audits/YYYY-MM-DD-<slug>.md`,结构:审计范围与解析过程 → 行为预期清单
  (判官原文)→ finding 分级列表(每条:现象 / repro 步骤 / 证据引用 / 哪个判官发现 / 验证结论)→
  待 Colin 拍板的不确定项。截图证据留 scratchpad,只有 confirmed finding 的关键截图
  (每张压到 <200KB)挑少量进 `docs/qa/assets/`。P1 经 Colin 点头后直接起 fix worktree 走 PR(人审)。

**明确不做**(v1 边界,别夹带):账本 / 截图库 / 像素哈希层 / 自动触发 / CI 驱动 / `--deep` 逐步
探索模式 / ui-demo 侧审计(ego-browser 路线另议)。

## 3. 执行切片(每片一个 commit)

### U1 · skill 骨架:`.claude/skills/audit-feature/SKILL.md`
主流程 prompt:名字解析(D1)→ scope(读 spec/映射,列关键状态)→ 行为预期推导(D2a,在采证前!)→
批式采证(D3)→ 三判官(D4)→ 对抗验证(D5)→ 报告(D7)。clarify 清单(D6)写进流程各卡点。
频繁引用而非内联:判官 prompt、采证套路放 references/(按需加载,主 prompt 保持短)。
**验收**:SKILL.md 里能指着行数找到 D1–D7 每条的落点;一个不认识本对话上下文的冷启动 session
只读 skill 就能跑(自包含性 review——执行 AI 自查,U5 试跑真验)。

### U2 · 行为判官:`references/behavior-judge.md`(优先级最高)
两步法 prompt 全文:预期推导的角色设定(「懂 Notion/现代编辑器习惯的挑剔用户」,列举必查维度:
空态/边界/连续操作/undo/键盘流/中文 IME/亮暗主题/与相邻 feature 的交界)+ 对照阶段的四分类
判定规则 + 「拿不准就标记待问,禁止脑补产品意图」的硬约束。
**验收**:拿一个已知答案的历史 case 干跑校准——把「跨块选中打字无反应」(#324 修前的行为)喂给
预期推导,不给答案,判官的预期清单必须含「选中后打字应替换选区」这条(考卷有标准答案:推导不出
= prompt 不合格,改到能推出为止)。再拿一个反向 case:「模板只剩空文档」(有意设计,#334)——
判官必须走「疑似有意→查 spec 有意分歧」路径而不是直接报 bug。两个 case 的干跑记录附在 PR 里。

### U3 · 视觉 rubric 种子:`references/rubric.md`
从 `docs/style.md` 提炼 10~15 条**可证伪**检查项,每条:检查什么(具体到 computed style/几何/
可见性)+ 怎么判 + component 标签(sidebar/editor/modal/browser/全局)。例:「弹窗必须
elevation 阴影、禁纸张堆叠假边」「动效 150~250ms 区间」「暗色下正文对比度 ≥4.5:1」「hover 必须有
可见反馈」。**宁少勿滥**:拿不准可证伪性的条目不收(Baymard 路数:没验证的检查项就是误报机器)。
**验收**:在当前 app(已知好样本)的 5 个主界面截图上干跑一遍,**零误报**;误报的条目删掉或改判据。

### U4 · 采证 playbook:`references/probe-playbook.md`
把 bug-hunt 试点方法论沉进 git:launch seam 清单(抄 `e2e/sidebar.spec.js` 模式)+ 批式驱动模板
(计划→脚本→证据→复盘的循环约定)+ 证据目录结构(`shots/` `dom/` `disk/` `logs/`)+ 双主题截图
约定 + 落盘字节采集(编辑动作后读磁盘文件存证)+ 占机纪律(实例数/超时/结束即关)。
**验收**:U5 试跑的采证段完全照 playbook 执行,不需要临场发明;占机实测 ≤15 分钟。

### U5 · 试跑 + 校准(先跑一个 feature,Colin 挑;没挑就默认「新建文档弹窗」)
全流程真跑:解析→预期→采证→判官→验证→报告落 `docs/qa/audits/`。跑完开对齐会:报告里
预期清单哪里推歪了、误报几条、漏报(Colin 已知但没抓到的)几条——**改回 U2/U3 的 prompt**,
校准闭环是本片的正经产出,不是跑完就完。
**验收**:Colin 读报告,拍「有用/没用」;误报率、占机时长、token 实耗三个数进报告尾注,
给下次迭代当基线。

## 4. 风险与对策

- **预期推导与 Wendi 意图相左** → 预期清单原文进报告可被纠;拿不准就问(D6②);U2 双 case 校准。
- **误报噪音让报告不可信** → rubric 宁少勿滥 + 对抗验证杀 plausible-but-wrong + U5 统计误报率。
- **占机超时** → 批数/实例数/15 分钟硬超时三道闸;超时截断仍出报告(标注覆盖不全)。
- **skill 冷启动跑不动**(引用断链/上下文缺失)→ U1 自包含性验收 + U5 用干净 session 试跑。
- **非确定性**(两轮 finding 集不同)→ 定位就是探索器,报告首行明示;回归门仍是 e2e,不混。

## 5. 验收总门

U5 的报告让 Colin 拍板「这东西有用」;占机 ≤15 分钟实测达标;U2 两个历史 case 干跑通过;
U3 零误报;方法论(playbook)进 git 不再散佚。
