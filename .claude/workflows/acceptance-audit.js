export const meta = {
  name: 'acceptance-audit',
  description:
    '真 app 编辑器 persona AI 判官层：读取证 + 同一份人写期望（surface∈{app,both}），逐场景判 make-sense → 对抗验证压误报 → 人话报告。planned 功能判 pending。',
  phases: [
    { title: 'Load', detail: '读 run-config → index.json 列出待判场景 + pending' },
    { title: 'Judge', detail: '每场景 persona 判 make-sense（读截图 + DOM + 期望）' },
    { title: 'Verify', detail: '每条「不符合」派独立 agent 对抗证伪' },
    { title: 'Report', detail: '汇总按严重度排序的人话报告（含 pending 计划项）' },
  ],
}

// 配置走「固定中性路径的 config 文件」而非 args（实测 args 投递不稳；agent cwd 是共享 worktree，
// 含 worktree 名的绝对路径会被"规整"成 sibling、读不到）。跑前往 /tmp/acceptance-audit/run-config.json
// 写 {judgeInput, mode, report, pending}（全 /tmp 绝对路径），loader 读它。截图路径在 index/rec 内已是 /tmp 绝对路径。
const A = args || {}
const CONFIG = A.config || '/tmp/acceptance-audit/run-config.json'
const VERIFIERS = 3 // 每条 fail 的对抗证伪票数；严格多数（≥过半）驳回 → 降级 unsure
let judgeInput = A.judgeInput || ''
let reportPath = A.report || ''
let mode = A.mode || ''

const LOAD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scenarios'],
  properties: {
    judgeInput: { type: 'string' },
    mode: { type: 'string' },
    report: { type: 'string' },
    pending: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: { id: { type: 'string' }, title: { type: 'string' }, severity: { type: 'string' } },
      },
    },
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
          screenshot: { type: 'string' },
          recPath: { type: 'string' },
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
  properties: { written: { type: 'boolean' }, path: { type: 'string' }, counts: { type: 'object', additionalProperties: true } },
}

const judgePrompt = (s) => `你是「资深生产力工具用户 + 挑剔的 UX 设计师」。你在审计 Wordspace 编辑器（**真 app**，Electron 本地 HTML 编辑器）的一个功能场景，判断它对**真实用户** make 不 make sense。

场景 id：${s.id}（${s.label || ''}）

步骤（所有路径都是**绝对路径，照抄逐字使用、不要替换目录或 worktree 名**——这台机器上有名字相似的 worktree 目录，混了就读不到文件）：
1. 用 Read 工具读这条场景自己的记录文件（只有它一条）：${s.recPath}。里面有：
   - expectation：人写验收期望（expect=应当怎样，failIf=满足哪些即算坏，severity）。若为 null，按常识判这功能对用户合不合理。
   - evidence：drive 结果（driveOut）+ DOM 快照（块结构 / 编辑态 / 气泡 / 斜杠项 / 存盘检查等）。
   - screenshot：截图绝对路径。
2. 用 Read 工具打开截图 ${s.screenshot}（照抄路径），**亲眼看**功能执行后 app 长什么样。万一图读不到，就只凭 evidence(DOM 证据) 判——**不要因为文件读不到就判 unsure**；unsure 只留给「证据本身不足以判断」。
3. 结合截图 + DOM 证据 + 期望判定：
   - verdict：pass（符合 / 对用户合理）｜ fail（不符合 / 会让用户懵或被误导）｜ unsure（证据不足或边界）。
   - severity：有期望就沿用；无期望自己定（high/medium/low/none）。
   - summary：一句人话，这功能对用户 make 不 make sense。
   - observed：你从截图/DOM 实际看到什么。
   - againstExpectation：对应哪条期望、符不符（无期望写「无硬期望，按常识」）。
   - reproduce：用户怎么重现。

原则：
- **判定锚定在「这次操作产生/影响的那个块」**——看 driveOut（这次干了什么）和末块/受影响块（dom.last / dom.editingTag / 存盘检查字段如 boldInSaved / linkInSaved / jsInSaved / hasMarkerLeak / keepsStructure / restored）。**绝不能拿文档里本来就预置的同类内容当这次操作的成功证据**。
- 安全/保真红线（safety-*）：只要证据显示危险链接进了文档/磁盘、或存盘泄漏了 data-ws2-* 痕迹/结构被塌平，就是 fail，无论页面看起来多正常。
- 宁可保守。只有当你能**具体说出「用户会怎样被坑」**时才判 fail；模糊就 unsure。不要因为「能更好」判 fail——期望是底线不是理想。
只返回结构化结论。`

const verifyPrompt = (v, s) => `你是对抗验证者，任务是**尽力证伪**下面这条「不符合(fail)」判定。默认怀疑它是误报。

场景 id：${s.id}（${s.label || ''}）
被质疑的判定：${v.summary || ''}
实际观察：${v.observed || ''}
对应期望：${v.againstExpectation || ''}

步骤（路径照抄逐字、不要替换目录/worktree 名）：
1. Read 这条场景自己的记录文件 ${s.recPath}，看 expectation 与 evidence。
2. Read 截图 ${s.screenshot}，亲眼核对。
3. 判断这条「不符合」站不站得住：
   - 若证据其实显示功能 OK、或判定夸大/误读了证据 → refuted=true，指出错在哪。
   - 若证据确实显示功能对用户坏掉/误导（尤其安全/保真红线）→ refuted=false。
不确定时倾向 refuted=true（压误报）。只返回 {refuted, reason}。`

// ---- flow ----
phase('Load')
const loaded = await agent(
  `分两步，路径都是**绝对路径、照抄逐字、不要替换目录或 worktree 名**：
1) 用 Read 工具读配置文件 ${CONFIG}，它是 JSON：{judgeInput, mode, report, pending}。
2) 用 Read 工具读第 1 步里 judgeInput 指向的 JSON 数组文件（轻量 index，每元素一个待审计场景，含 screenshot 与 recPath）。若 pending 是个路径字符串，也 Read 它（planned 功能清单数组）；若已是数组就直接用。
原样返回 {judgeInput, mode, report, pending:[{id,title,severity}], scenarios:[每个照抄 {id,label,surface,severity,hasExpectation,screenshot,recPath}]}。不要判定、不要读 recPath/screenshot 指向的文件，只做清单。`,
  { label: 'load', phase: 'Load', schema: LOAD_SCHEMA },
)

judgeInput = (loaded && loaded.judgeInput) || judgeInput
mode = (loaded && loaded.mode) || mode || 'audit'
reportPath = (loaded && loaded.report) || reportPath || '/tmp/acceptance-audit/report.md'
const scenarios = (loaded && loaded.scenarios) || []
const pending = (loaded && loaded.pending) || []
if (!scenarios.length) {
  log('没有可判定的场景（index.json 空或读不到）。先跑 npm run audit:capture && audit:prepare。')
  return { error: 'no-scenarios', judgeInput }
}
log(`待判 ${scenarios.length} 个场景（mode=${mode}）；pending（planned 未做）${pending.length} 条`)

const results = await pipeline(
  scenarios,
  (s) => agent(judgePrompt(s), { label: `judge:${s.id}`, phase: 'Judge', schema: JUDGE_SCHEMA }),
  (verdict, s) => {
    if (!verdict) return null
    if (verdict.verdict !== 'fail') return { ...verdict, label: s.label, final: verdict.verdict, verification: null }
    // 分级对抗验证：high 派 3 票、medium 2 票、low/none 1 票；严格多数驳回 → 降级 unsure。
    const sev = verdict.severity || s.severity || 'medium'
    const n = sev === 'high' ? VERIFIERS : sev === 'low' || sev === 'none' ? 1 : 2
    const need = Math.floor(n / 2) + 1
    return parallel(
      Array.from({ length: n }, (_, k) => () =>
        agent(verifyPrompt(verdict, s), { label: `verify:${s.id}:${k + 1}`, phase: 'Verify', schema: VERIFY_SCHEMA }),
      ),
    ).then((votes) => {
      const valid = votes.filter(Boolean)
      const refutes = valid.filter((v) => v.refuted).length
      const downgraded = refutes >= need
      return {
        ...verdict,
        label: s.label,
        final: downgraded ? 'unsure' : 'fail',
        verification: { verifiers: n, refutes, total: valid.length, downgraded, votes: valid },
      }
    })
  },
)

const clean = results.filter(Boolean)
const counts = {
  pass: clean.filter((r) => r.final === 'pass').length,
  fail: clean.filter((r) => r.final === 'fail').length,
  unsure: clean.filter((r) => r.final === 'unsure').length,
  pending: pending.length,
}

// 变异自检：喂「功能坏掉」的证据。哑门 = 判官被骗把注坏场景判 pass（rubber stamp）。判 unsure 不算
// 哑门（没被骗、单帧证据不足，诚实存疑，可接受）。hasTeeth = 没有任何注坏场景被判 pass。
if (mode === 'selfcheck') {
  const expected = scenarios.length
  const judged = clean.length
  const fooled = clean.filter((r) => r.final === 'pass')
  const unsureOnBroken = clean.filter((r) => r.final === 'unsure')
  const inconclusive = judged < expected || judged === 0
  const hasTeeth = !inconclusive && fooled.length === 0
  log(
    `变异自检：注坏 ${expected} / 实判 ${judged}（fail ${counts.fail}、unsure ${counts.unsure}、pass ${counts.pass}）；` +
      (inconclusive
        ? `⚠ 不足结论（${expected - judged} 个判官未返回/出错）——请重跑`
        : fooled.length
          ? `❌ 哑门：${fooled.length} 个注坏场景被骗判 pass：${fooled.map((r) => r.id).join(', ')}`
          : unsureOnBroken.length
            ? `✓ 门有牙（无被骗放行）；其中 ${unsureOnBroken.length} 个只给 unsure（诚实存疑）：${unsureOnBroken.map((r) => r.id).join(', ')}`
            : '✓ 门有牙 —— 注坏的全判 fail'),
  )
  return { mode, counts, expected, judged, inconclusive, hasTeeth, fooled: fooled.map((r) => ({ id: r.id, summary: r.summary })), unsureOnBroken: unsureOnBroken.map((r) => r.id), results: clean }
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
  verification: r.verification ? { refutes: r.verification.refutes, downgraded: r.verification.downgraded } : null,
}))

const report = await agent(
  `下面是 Wordspace **真 app** 编辑器验收审计的判定结果（已含对抗验证）。把它写成一份**给非工程同事（Wendi）也能看懂的人话报告**，用 Write 工具写到这个绝对路径：${reportPath}

判定结果 JSON：
${JSON.stringify(compact, null, 2)}

planned（功能还没做、判 pending、不算坏）清单 JSON：
${JSON.stringify(pending, null, 2)}

报告要求（Markdown，中文，少黑话）：
- 顶部总览一句：跑了几个场景、pass / fail(confirmed) / unsure 各几个，外加 pending 几个。
- 「需要关注」：verdict=fail 的按 severity（high→medium→low）排序，每条写：功能名、用户会遇到什么问题（人话）、怎么重现、对应哪条期望。
- 「存疑 / 被对抗验证驳回」：verdict=unsure 的简列（注明哪些是被多数对抗验证降级的）。
- 「通过」：verdict=pass 的简列。
- 「计划中（pending）」：把 planned 清单列出，说明这些是契约里描述的目标功能、app 还没做，本次不判坏。
写完返回 {written:true, path:"${reportPath}", counts:{pass:${counts.pass},fail:${counts.fail},unsure:${counts.unsure},pending:${counts.pending}}}。`,
  { label: 'report', phase: 'Report', schema: REPORT_SCHEMA },
)

log(
  `审计完成：pass ${counts.pass} / fail ${counts.fail} / unsure ${counts.unsure} / pending ${counts.pending}` +
    (report && report.written ? ` —— 报告：${reportPath}` : ' —— ⚠ 报告未写出'),
)

return { mode, counts, reportPath, report, results: compact }
