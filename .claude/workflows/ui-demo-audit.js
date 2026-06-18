export const meta = {
  name: 'ui-demo-audit',
  description:
    'ui-demo 编辑器 persona AI 判官层：读取证 + 人写期望，逐场景判 make-sense → 对抗验证压误报 → 人话报告（v2 · U3/U4）',
  phases: [
    { title: 'Load', detail: '读 judge-input.json 列出待判 scenario' },
    { title: 'Judge', detail: '每 scenario persona 判 make-sense（读截图 + DOM + 期望）' },
    { title: 'Verify', detail: '每条「不符合」派独立 agent 对抗证伪' },
    { title: 'Report', detail: '汇总按严重度排序的人话报告' },
  ],
}

// 配置走「固定中性路径的 config 文件」而非 args —— 实测 Workflow 的 args 投递不稳（时有时无）；
// 且 agent cwd 是共享 worktree，会把含 'wordspace-next-ui-demo' 的绝对路径"规整"成 sibling worktree
// 'wordspace-next-demo'、读不到文件。所以跑前往 /tmp/ui-demo-audit/run-config.json 写
// {judgeInput, mode, report}（全是 /tmp 绝对路径，无 sibling 可混淆），loader agent 读它（最稳）
// → 流出 judgeInput/mode/report。screenshot 路径在 judge-input.json 内已是 /tmp 绝对路径。
const A = args || {}
const CONFIG = A.config || '/tmp/ui-demo-audit/run-config.json'
const VERIFIERS = 3 // 每条 fail 的对抗证伪票数；多数（≥2）驳回 → 降级 unsure
// 下面三个由 loader 从 config 读出后赋值（用 let：judge/verify 的 prompt 闭包在 pipeline 里调用时
// 已读到新值）；args 若有则作初值/覆盖。
let judgeInput = A.judgeInput || ''
let reportPath = A.report || ''
let mode = A.mode || ''

// ---- schemas ----
const LOAD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scenarios'],
  properties: {
    judgeInput: { type: 'string' },
    mode: { type: 'string' },
    report: { type: 'string' },
    scenarios: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          surface: { type: 'string' },
          severity: { type: ['string', 'null'] },
          hasExpectation: { type: 'boolean' },
        },
      },
    },
  },
}
const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'verdict', 'summary'],
  properties: {
    id: { type: 'string' },
    verdict: { enum: ['pass', 'fail', 'unsure'] },
    severity: { enum: ['high', 'medium', 'low', 'none'] },
    summary: { type: 'string' },
    observed: { type: 'string' },
    againstExpectation: { type: 'string' },
    reproduce: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason'],
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
}
const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['written'],
  properties: {
    written: { type: 'boolean' },
    path: { type: 'string' },
    counts: { type: 'object', additionalProperties: true },
  },
}

// ---- prompts ----
const judgePrompt = (s) => `你是「资深生产力工具用户 + 挑剔的 UX 设计师」。你在审计 Wordspace 编辑器（ui-demo 原型）的一个功能场景，判断它对**真实用户** make 不 make sense。

场景 id：${s.id}（${s.label || ''}）

步骤（所有路径都是**绝对路径，照抄逐字使用、不要替换目录或 worktree 名**——这台机器上有两个名字相似的 worktree 目录，混了就读不到文件）：
1. 用 Read 工具读 JSON 文件：${judgeInput}，找到 id === "${s.id}" 的那条记录。里面有：
   - expectation：人写验收期望（expect=应当怎样，failIf=满足哪些即算坏，severity）。若为 null，说明这条没有硬期望，你按常识判这个功能对用户合不合理。
   - evidence：drive 结果 + DOM 快照（块结构 / 可编辑性 / 弹窗 / toast 等）。
   - screenshot：截图的绝对路径。
2. 用 Read 工具打开那张 screenshot 图片（同样照抄路径），**亲眼看**功能执行后页面长什么样（make-sense 判定离不开视觉）。万一这张图读不到，就只凭上面 JSON 里的 evidence(DOM 证据) 判——**不要因为文件读不到就判 unsure**；unsure 只留给「证据本身不足以判断」。
3. 结合截图 + DOM 证据 + 期望判定：
   - verdict：pass（符合 / 对用户合理）｜ fail（不符合 / 会让用户懵或被误导）｜ unsure（证据不足或边界）。
   - severity：有期望就沿用；无期望你自己定（high/medium/low/none）。
   - summary：一句人话，这功能对用户 make 不 make sense。
   - observed：你从截图/DOM 实际看到什么。
   - againstExpectation：对应哪条期望、符不符（无期望就写「无硬期望，按常识」）。
   - reproduce：用户怎么重现。

原则：宁可保守。只有当你能**具体说出「用户会怎样被坑」**时才判 fail；模糊就 unsure。不要因为「能更好」就判 fail——期望是底线不是理想。只返回结构化结论。`

const verifyPrompt = (v, s) => `你是对抗验证者，任务是**尽力证伪**下面这条「不符合(fail)」判定。默认怀疑它是误报。

场景 id：${s.id}（${s.label || ''}）
被质疑的判定：${v.summary || ''}
实际观察：${v.observed || ''}
对应期望：${v.againstExpectation || ''}

步骤：
1. Read ${judgeInput}（绝对路径，照抄逐字、不要替换目录/worktree 名），找 id === "${s.id}" 的记录，看它的 expectation 与 evidence。
2. Read 它的 screenshot 图片，亲眼核对。
3. 判断这条「不符合」站不站得住：
   - 若证据其实显示功能 OK、或判定夸大/误读了证据 → refuted=true，指出错在哪。
   - 若证据确实显示功能对用户坏掉/误导 → refuted=false。
不确定时倾向 refuted=true（压误报）。只返回 {refuted, reason}。`

// ---- flow ----
phase('Load')
const loaded = await agent(
  `分两步，路径都是**绝对路径、照抄逐字、不要替换目录或 worktree 名**（这台机器有两个名字相似的 worktree，混了就读不到）：
1) 用 Read 工具读配置文件 ${CONFIG}，它是 JSON：{judgeInput, mode, report}。
2) 用 Read 工具读第 1 步里 judgeInput 指向的那个 JSON 数组文件（每元素是一个待审计场景）。
返回 {judgeInput, mode, report, scenarios:[每个场景 {id, label, surface, screenshot, severity（取 expectation.severity，没有则 null）, hasExpectation}]}。不要判定，只做清单。`,
  { label: 'load', phase: 'Load', schema: LOAD_SCHEMA },
)

judgeInput = (loaded && loaded.judgeInput) || judgeInput
mode = (loaded && loaded.mode) || mode || 'audit'
reportPath = (loaded && loaded.report) || reportPath || '/tmp/ui-demo-audit/report.md'
const scenarios = (loaded && loaded.scenarios) || []
if (!scenarios.length) {
  log('没有可判定的场景（judge-input.json 空或读不到）。先跑 npm run audit:capture && audit:prepare。')
  return { error: 'no-scenarios', judgeInput }
}
log(`待判 ${scenarios.length} 个场景（mode=${mode}）`)

// 逐场景：persona 判 → 若 fail 则并行对抗验证（多数驳回 → 降级 unsure）。pipeline 无屏障：
// 某场景在 Verify 时其它场景仍可在 Judge，省墙钟。
const results = await pipeline(
  scenarios,
  (s) =>
    agent(judgePrompt(s), {
      label: `judge:${s.id}`,
      phase: 'Judge',
      schema: JUDGE_SCHEMA,
    }),
  (verdict, s) => {
    if (!verdict) return null
    if (verdict.verdict !== 'fail')
      return { ...verdict, label: s.label, final: verdict.verdict, verification: null }
    return parallel(
      Array.from({ length: VERIFIERS }, (_, k) => () =>
        agent(verifyPrompt(verdict, s), {
          label: `verify:${s.id}:${k + 1}`,
          phase: 'Verify',
          schema: VERIFY_SCHEMA,
        }),
      ),
    ).then((votes) => {
      const valid = votes.filter(Boolean)
      const refutes = valid.filter((v) => v.refuted).length
      const downgraded = refutes >= Math.ceil(VERIFIERS / 2) // 多数驳回 → 降级
      return {
        ...verdict,
        label: s.label,
        final: downgraded ? 'unsure' : 'fail',
        verification: { refutes, total: valid.length, downgraded, votes: valid },
      }
    })
  },
)

const clean = results.filter(Boolean)
const counts = {
  pass: clean.filter((r) => r.final === 'pass').length,
  fail: clean.filter((r) => r.final === 'fail').length,
  unsure: clean.filter((r) => r.final === 'unsure').length,
}

// U4：变异自检模式 —— 喂的是「功能坏掉」的证据，判官**应当全判 fail**；该 fail 不 fail = 哑门。
if (mode === 'selfcheck') {
  const dumb = clean.filter((r) => r.final !== 'fail')
  log(
    `变异自检：${clean.length} 个被注坏的场景，判 fail ${counts.fail} 个；` +
      (dumb.length
        ? `哑门 ${dumb.length} 个（该 fail 没 fail）：${dumb.map((r) => r.id).join(', ')}`
        : '全部判 fail —— 门有牙 ✓'),
  )
  return {
    mode,
    counts,
    hasTeeth: dumb.length === 0,
    dumbGates: dumb.map((r) => ({ id: r.id, final: r.final, summary: r.summary })),
    results: clean,
  }
}

// 正常模式：写人话报告
phase('Report')
const compact = clean.map((r) => ({
  id: r.id,
  label: r.label,
  verdict: r.final,
  severity: r.severity || null,
  summary: r.summary,
  observed: r.observed,
  reproduce: r.reproduce,
  againstExpectation: r.againstExpectation,
  verification: r.verification
    ? { refutes: r.verification.refutes, downgraded: r.verification.downgraded }
    : null,
}))

const report = await agent(
  `下面是 ui-demo 编辑器验收审计的判定结果（已含对抗验证）。把它写成一份**给非工程同事（Wendi）也能看懂的人话报告**，用 Write 工具写到这个绝对路径：${reportPath}

结果 JSON：
${JSON.stringify(compact, null, 2)}

报告要求（Markdown，中文，少黑话）：
- 顶部总览一句：跑了几个场景、pass / fail(confirmed) / unsure 各几个。
- 「需要关注」：把 verdict=fail 的按 severity（high→medium→low）排序，每条写：功能名、用户会遇到什么问题（人话）、怎么重现、对应哪条期望。
- 「存疑 / 被对抗验证驳回」：verdict=unsure 的简列（注明哪些是被多数对抗验证降级的）。
- 「通过」：verdict=pass 的简列。
写完返回 {written:true, path:"${reportPath}", counts:{pass:${counts.pass},fail:${counts.fail},unsure:${counts.unsure}}}。`,
  { label: 'report', phase: 'Report', schema: REPORT_SCHEMA },
)

log(
  `审计完成：pass ${counts.pass} / fail ${counts.fail} / unsure ${counts.unsure}` +
    (report && report.written ? ` —— 报告：${reportPath}` : ' —— ⚠ 报告未写出'),
)

return { mode, counts, reportPath, report, results: compact }
