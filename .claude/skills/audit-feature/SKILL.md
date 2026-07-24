---
name: audit-feature
version: 1.0.0
description: 手动触发的 AI feature 审计。对 Wordspace 真 app 的**指定 feature** 跑一轮全套 bug sweep——功能行为 / 后端落盘 / UI·UX taste——产出分级报告(P1/P2/P3 + repro + 证据)。用户说「audit <feature>」「测一下 <某功能>」「查查 <某界面> 有没有问题」「sweep <feature>」时触发。占机最短、不确定就问。
---

# /audit-feature —— 指定 feature 的 AI 审计

对用户**指定的一个 feature** 跑一轮「模拟人 + 有 taste」的审计:功能对不对、后端落盘干不干净、UI/UX 有没有交互与样式问题。产出一份分级报告给 Colin;P1 经他点头直接修。

要审的 feature 名在调用参数里(可能很模糊,如「新建文档那个弹窗」);没给就先问。

**这不是回归门**——那是确定性 e2e(`npm run test:e2e`)。本 skill 是**探索性发现**:同一 feature 跑两次 finding 集会不同。定位是「给这个 feature 多一双懂行、挑剔的眼睛」,不替代回归门,别混。

**方法论出处**(不用重读,已浓缩进本 skill 与 references):调研(UXAgent 模拟用户 / MLLM-as-UI-Judge 的 pairwise 实证 / Baymard「收窄成可证伪检查项」95% 方法论)、上一轮 AI 探索测试(`docs/plans/bug-hunt-2026-07-14/README.md`)、plan `docs/plans/2026-07-24-001-audit-feature-skill-plan.md`。

## 铁律(先记牢,全程适用)

- **占机最短**。审计要开真 app(窗口会弹在桌面),但 Colin 的电脑必须保持可用。所以:
  - LLM 思考 / 判官 / 写报告**全程 app 关闭**,零占机;
  - 只有跑探测脚本、采证据那几十秒真占机;**批与批之间、采证段与验证段之间 app 必关**;
  - 采证段 app 累计开着 **≤15 分钟**,对抗验证段 **≤10 分钟**,全程占机 **≤25 分钟**。超时就截断收尾,报告标注「采证不完整」。
- **不确定就问,不许猜**。名字含糊 / 行为预期拿不准 / 疑似有意设计 / P 级定不了 / 是否起修——一律 `AskUserQuestion` 问 Colin。别脑补产品意图。全流程的问点标了「⚠ 问」。
- **驱动器会造假 bug**。我们的自动化按键有已知盲区(见 `references/probe-playbook.md` 的「驱动器伪影清单」),会产出「⌘Z 坏了」这种假 finding、还稳定复现。凡涉及快捷键 / 焦点 / 中文输入法的现象,**先按伪影清单排除,再当 finding**。

---

## Phase 0 · 解析 feature 名

用户给的名字可能模糊。按次序解析:

1. `docs/features/*.md` —— 文件名 + 标题(每份带「文件映射」表,直接给出该 feature 的真 app 文件)。
2. `docs/*.md` 专项文档(`browser-feature-spec.md`、schema 相关…)。
3. 近期 PR / commit 标题:`git log --oneline origin/main -50`(中文动宾式,信息量大)。
4. 代码 grep(类名 / 函数名 / i18n key)。

- **唯一高置信候选** → 展示解析结果(「我理解要审的是 X,对应 `src/...`」)继续。
- **⚠ 问**:多候选 / 低置信 → `AskUserQuestion` 列候选让 Colin 挑。

⚠ **packaged-only feature 审计设备够不着**。所有 app 测试 seam 都锁 `!app.isPackaged`,审计打的是仓内 dev 构建。更新器(updater)、默认打开方式(protocols / open-url)这类**只在签名安装版才有行为**的 feature——解析到就直接问 Colin(只能真机手验),别硬跑。

## Phase 1 · Scope + 行为预期推导(**采证之前**做!)

1. **Scope**:读该 feature 的 spec(如有)+ 文件映射,列出关键状态和入口(怎么打开、有哪些交互面、空态/满态)。
2. **行为预期推导**(核心,优先级最高):**在采证之前**,读 `references/behavior-judge.md` 并执行它的**第一步(预期推导)**——判官只凭 feature 名 + spec(如有)+ 入口截图,**独立写出「行为预期清单」**:一个懂 Notion / 现代编辑器习惯的挑剔用户,对这个 feature 的行为预期(含空态、边界、连续操作、undo、键盘流、亮暗主题、与相邻 feature 的交界)。**先写预期,再看实况**——防「看到什么都觉得合理」的锚定偏差。
   - 预期清单**原文进最终报告**——判官的 taste 错了,Colin 要能看见、能纠。

## Phase 2 · 批式采证(唯一占机大段)

读 `references/probe-playbook.md`,按它执行:预先计划一批操作 → Playwright 脚本一口气跑完(LLM 不在环内)→ **关 app** → 看证据产物 → 计划下一批。默认 2~3 批。采集并落 scratchpad 证据目录:
- 截图(**亮 / 暗双主题**)、DOM + computed-style 快照、编辑动作后的**落盘字节**、主进程 stdout、console 报错。
- **标某状态「无法采证 / 盲区」之前,先查 e2e 有没有覆盖**(grep `e2e/<feature>*.spec.js`)——很多「难触发」的态其实早有确定性回归门,只是这轮探索没碰到(2026-07-24 下载补验实证:上轮标「盲区」的并发同名 / 重试 / 右键存图 / 重启读回,一查全有门)。别把「我这轮没采到」写成「没人测过」。**真盲区**(既无 e2e 门、又在沙盒里复现不了,如「真实网络失败态」)才进报告盲区列,并说清楚为什么测不了、建议怎么补门。

## Phase 3 · 三判官(按 Colin 定的优先级;可并行 agent)

1. **行为判官(主)** —— 读 `references/behavior-judge.md` 的**第二步(对照实测)**:拿 Phase 1 的预期清单逐条判五类:
   符合 / **违反 → finding** / 疑似有意设计 → 查 feature spec 的「有意分歧」清单(**spec 不存在或无此章节 = 查不到 → ⚠ 问 Colin**)/ 无法自动化采证(IME 等)→ 进「需真机手测」列 / 拿不准 → ⚠ 问 Colin。
2. **后端判官** —— 编辑动作后的落盘字节过 `node scripts/validate-schema.js <file>`(退出码 0 = 合规);扫主进程 stdout / console 有没有报错;核对文件系统副作用(建 / 删 / 改是否真落对地方、有没有写错文件——历史上出过「自动保存写进别的文件」的 P0)。
3. **视觉判官** —— 读 `references/rubric.md`,按 component 标签过滤出相关检查项判(computed-style 类用 DOM 快照、观感类用截图);pairwise 只做**同界面「亮 vs 暗」**对照,**不做绝对打分**(实证:pairwise 远好过绝对打分)。

## Phase 4 · 对抗验证(每个 finding 必过)

把所有 finding 的 repro **合并成单脚本、单实例**,由独立 skeptic agent 跑:

- **第一步先排伪影**:凡涉及快捷键 / 焦点 / 中文输入的 finding,按 `references/probe-playbook.md` 伪影清单**换 menu seam 路径重放一次**——seam 路径正常 = 伪影,杀掉。
- **复现标准**:连续 2 次均复现 → `verified`;任一次不复现 → 「未确认(复现不稳)」进附录。
- 验证段占机 ≤10 分钟。**开跑前告知 Colin**(要再开 app)。

## Phase 5 · 报告

写 `docs/qa/audits/YYYY-MM-DD-<slug>.md`,结构:

1. 审计范围 + 名字解析过程;
2. **行为预期清单(判官原文)**;
3. `verified` finding 分级列表——每条:现象 / repro 步骤 / 证据引用 / 哪个判官发现 / 验证结论;
4. **需真机手测**列(IME 等自动化够不着的);
5. **未确认**附录(复现不稳的);
6. ⚠ **待 Colin 拍板**项(疑似有意设计等);
7. 尾注:分段占机时长 / 误报数 / token 实耗(给下次当基线)。

**证据引用规则**:`verified` finding 的支撑截图**复制**进 `docs/qa/assets/<YYYY-MM-DD-slug>/`(每张压到 <200KB),报告用相对路径 `../assets/...` 引。未验 / 被杀的**不进 assets**,报告正文自足描述、**不引用 scratchpad 路径**(session 结束即失效)。`docs/qa/assets/` 只服务报告可读性,**不是截图库**(不做检索 / 跨版本比对);量大了由 Colin 拍清理。

报告走 **PR + auto-merge** 落 main(直推 main 会 403;docs-only 也跑全量 CI,零占机零 token)。push / PR 用 `TOKEN=$(gh auth token --user jizhoutang10thglobal)`(默认凭证无写权限)。

**外加:标注截图 HTML 报告(Colin 2026-07-24 定,每轮必出)**。上面那份 Markdown 是给开发存档的;Colin 要的是**能直接看图的可视化版**。收尾再产一份**自包含 HTML**(截图内嵌成 data URI、CSS 内联,不引任何外部资源),每个 finding / 通过项配**标注截图**——在截图上叠 CSS 定位的框 + 标签:**红框 = 真 bug、绿框 = 行为正确、蓝框 = 中性对照**。照 `references/report-template.html`(纸方墨圆、亮暗自适应、已固化进 skill),把 finding 内容填进卡片。写进 scratchpad 后 `open` 给 Colin 看。**这份是给 Colin review 的可视化版,不进仓**(session 结束即弃;要存档看 Markdown 报告的 PR)。

⚠ **P1 起修**:confirmed P1 问 Colin 一声,点头后起 fix worktree 走 PR(人审 + 变异自检,CLAUDE.md 铁律)。P2 / P3 进报告待拍板,**不自动修**。

---

## 明确不做(v1 边界,别夹带)

账本 / 截图库 / 像素哈希层 / 自动触发(合并后、发版前都不自动)/ CI 驱动 / `--deep` 逐步探索模式 / ui-demo 侧审计 / 真 app vs ui-demo 对照截图。想要这些**另立 plan**。
