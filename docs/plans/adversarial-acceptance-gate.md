---
title: 对抗性验收门 — 让视觉/集成 bug 不能绿着进 main
status: active
created: 2026-06-05
origin: specs/f46-theme-demo.md（spec2 §5.3 的"断言外壳背景变了"被实现成只查 class）
related:
  - CLAUDE.md（S1/S3 教训）
  - scripts/run-spec.sh
  - .github/workflows/ci.yml
---

# 对抗性验收门

## 1. 问题框定

自动流程产出过三次"绿但坏"的 app（sandbox 雷 / renderer 没 require / CSP 拦 inline style）。
共同点：**全是"app 真打开后可见效果不符合 spec"，而纯逻辑测试和弱 e2e 断言都碰不到。**

当前 spec2 的活样本：`src/renderer/index.html` 的 CSP `default-src 'self'` 拦掉了同文件 inline
`<style>`，**所有主题 CSS 失效**（CDP 实测：亮/暗两态 `body`/`#status-bar`/`#doc-container` 的
computed background 全是 `rgba(0,0,0,0)`，主题视觉零生效）。但 e2e（`e2e/app.spec.js:51`）只断言
`document.body.className` 含 `'dark-theme'`——`className` 是 JS 直接设的、不过 CSS，所以
CSP 把样式全拦了它照样过。14 vitest 绿 + e2e 2 passed，app 视觉上没有任何主题。

**根因不是某个 bug，是验收方式的结构性漏洞：裁判=运动员。** 实现代码、e2e、断言强度
都是同一个 AI 写的，它会写"恰好能过"的代理断言（assert class 变了），而不是"验真实可见
效果"的强断言（assert computed background 真的从浅变深）。spec2 的 §5.3 本来写了"断言外壳
**背景**变了"，但实现的 AI 写成了只查 class——强度在转录时被悄悄削掉，没人挡得住。

## 2. 范围与目标

**目标**：让"CSS 没生效 / app 空白 / 主题不可见"这一类视觉·集成 bug **永远不可能绿着进
main**，且机制对**所有未来 spec 通用**（不是给 spec2 hardcode、不是给 Wendi 看的表演）。

**明确不做**：通用"好不好看 / 布局美学"判定（主观、agent 会卡死）；像素基线截图对比
（跨平台 + xvfb 字体渲染漂移，无人值守下维护成本 >> 收益，见研究结论）。本门只判**客观、
可证伪的 computed-style / 像素事实**。

**诚实边界（必须先讲清，不夸口）**：没有任何机制保证"一次就过"。本门给的不是"保证 AI 一次
写对"，是两条更可兑现的承诺——① 这一类 bug（可见效果不符 spec）从"合并后才发现"挪到"进
main 前必被自动挡"；② 门自己用变异自检证明"我不是哑的"。残余漏洞诚实标注在 §7。

## 3. 机制设计（两份独立设计收敛出的核心）

四个部件，从"定义对错"到"自动挡住"层层咬合：

### 3.1 VA 契约：把"什么算视觉上对"从实现 AI 手里拿走

每条有可见效果的 spec 旁放一个机器可读的 **Visual Acceptance** 契约
`specs/<slug>.va.json`：人/PM 在**实现之前**写死的、可证伪的 computed-style 阈值。

spec2 的 VA 示意（directional，最终 schema 实现时定）：

```json
{
  "spec": "f46-theme-demo",
  "checks": [
    { "id": "shell-darkens",
      "desc": "点开关后外壳背景从亮变暗",
      "selector": "body", "metric": "bgLuminance",
      "initial": { "min": 0.7 },
      "afterToggle": { "max": 0.2 },
      "relation": "afterToggle < initial" },
    { "id": "doc-stays-white",
      "desc": "文档纸面两态恒白、不被主题染色",
      "selector": "#doc-container", "metric": "bgLuminance",
      "initial": { "min": 0.95 }, "invariantAcrossToggle": true }
  ]
}
```

破解裁判=运动员靠**强度来源与实现物理分离**：实现 AI 写 app 代码，但 **不写断言、不许碰
`*.va.json`**（`.github/CODEOWNERS` 把 VA 文件锁给 Colin，PR 改到它强制人 review；git diff
里一眼可见任何放水）。

### 3.2 通用 runner：spec-agnostic，断言不由实现 AI 转录

一个**仓库自带、所有 spec 共用、不随 spec 改**的 runner `e2e/va-runner.spec.js`：读
`specs/<slug>.va.json` → 启动真 Electron（`--no-sandbox`）→ 按 selector 读 computed
background、算 WCAG 相对亮度 → 与阈值比。AI 想放水只能去改 runner 或 VA 文件，两者都在
CODEOWNERS 保护下、diff 可见。

亮度断言用研究确认的写法（不是 class 代理）——只有 `.dark-theme` 真命中且 background 真生效，
`getComputedStyle(body).backgroundColor` 才会变深；CSS 全废时暗态亮度掉不到阈值下，**必 fail**：

```js
// rgb/rgba 字符串 → WCAG 相对亮度(0~1)，在 Node 侧算
function luminance(str) {
  const m = str.match(/rgba?\(([^)]+)\)/i);
  if (!m) throw new Error('无法解析颜色: ' + str);
  const [r, g, b, a] = m[1].split(',').map(parseFloat);
  if (a === 0) throw new Error('alpha=0（transparent），别当黑色误判: ' + str); // 见研究 pitfall 2
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4); };
  return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
}
```

### 3.3 变异自检：把"断言够不够强"变成被测对象（最关键的一层）

`e2e/va-selftest.spec.js`：runner 在相信自己的绿之前，**先对每条 VA 注入一个已知坏状态**
（如强制给 `body` 注入 light 背景却断言它该 dark / 临时移除主题 class / 抽掉 stylesheet），
断言此时该 VA **必须翻红**。任一坏状态仍绿 = 这条断言是哑的 = 整个 e2e job 直接 fail。

这是对"门存在 ≠ 门够强"的正面回答：即使实现 AI 写出恰好能过的弱判定，变异自检会因为
"坏状态也过"而当场暴露它。**断言强度不再靠自觉，是被测出来的。**

判定标准（写进教训）：只要能想出一种"CSS 全废但断言还过"的情形，这断言就还是弱的——
class 断言就栽在这（JS 设的 class 不过 CSS），所以它过不了变异自检。

### 3.4 required check：让人触发的 merge 也挡得住

现状实测：`main` 没有任何 branch protection（`branches/main/protection` 返回 404），CI 红了
merge 按钮照样能点——**这是比"e2e 写多强"更大的洞**。把 CI 的 `e2e` job 设成 main 的
**required status check**：红/未跑时 GitHub 服务端直接灰掉 merge 按钮，Colin 想合也合不了。
这一步 agent 没权限设（token 缺 Administration，403），是 Colin 一次性手动配（§6）。

### 3.5（可选增强）宿主对抗 agent：把"真打开看"自动化

把手动的 `/tmp/cdp-*.mjs` 固化成 committed 的 `scripts/host-verify.mjs`：在宿主 macOS（有真
显示器，能开 app）`npm start` + CDP 读 VA 指定的 computed style 自动判定 + 跑变异探针 + 截图存证。
由一个**独立于实现的 agent**（全新上下文，任务是"证伪"不是"确认"）在 PR 开出后、人 merge 前跑。
关键：它用**宿主 token**（有 repo scope，能读 Actions）`gh pr checks` 确认 CI e2e 真绿——
**绕过"容器内 token 读不到 CI"那条硬约束**。这是对你"你不用打开检查吗"的自动化回答。

## 4. 实施单元（按 Tier 分，可选深度见 §5）

### Tier 0 — 修好 spec2 + 让门当场能抓这类 bug（非选）

| 单元 | 文件 | 改动 | 测试场景 |
|---|---|---|---|
| T0.1 CSP 修复 | `src/renderer/index.html`, `src/renderer/theme.css`(新) | 删 `index.html:8-63` 整段 `<style>`，新建同目录 `theme.css` 原样搬入，`<head>` 加 `<link rel="stylesheet" href="theme.css">`（CSP meta 一字不改，`default-src 'self'` 保持最严，同源外链受 default-src 放行）| 人/CDP：暗态 `body` bg = `#1a1a1a`、`#doc-container` 恒白 |
| T0.2 强 e2e 亮度断言 | `e2e/app.spec.js` 或新 `e2e/theme-visual.spec.js` | 把"theme toggle"测试的 class 断言**升级/补**为亮度断言：暗态 `body` 亮度 `<0.2`、`<` 亮态、文档恒白且两态相等（用 §3.2 的 `luminance`）| 故意注释掉 `.dark-theme{background}` 后重跑，**必须 fail**（这就是对 T0.2 自身的手动变异验证）|

`theme.css` 路径用相对 `"theme.css"`（同 `renderer.js` 的写法），别用 `/theme.css`（file:// 下
`/` 是磁盘根，404）。无 bundler，`loadFile` 直读源码目录，`theme.css` 作兄弟文件天然就位。

### Tier 1 — 通用机制（让所有未来 spec 复用；这是你要的"可靠 workflow"主体）

| 单元 | 文件 | 改动 | 测试场景 |
|---|---|---|---|
| T1.1 VA schema + spec2 实例 | `specs/f46-theme-demo.va.json`(新) | 按 §3.1 写 spec2 的 VA（人 own）| runner 能解析、跑出预期判定 |
| T1.2 通用 runner | `e2e/va-runner.spec.js`(新) | 读 `specs/*.va.json`、启动 Electron、按 selector 算亮度比阈值；**找不到当前 spec 的 .va.json 就 fail**（不许"没阈值=跳过"）| spec2 VA 全过；把 CSP 打回 inline → runner 红 |
| T1.3 变异自检 | `e2e/va-selftest.spec.js`(新) | 对每条 VA 注入坏状态，断言 VA 必翻红；任一坏状态仍绿 → fail | 删/弱化任一断言 → selftest 红 |
| T1.4 CI 接线 | `.github/workflows/ci.yml` | e2e job 一并跑 va-selftest + va-runner（现有 `xvfb-run npm run test:e2e` 已覆盖 testDir，主要确保 SPEC/slug 能传入）| PR 上 e2e job 真跑这三层 |
| T1.5 锁文件 | `.github/CODEOWNERS`(新) | `specs/*.va.json`、`e2e/va-runner.spec.js`、`e2e/va-selftest.spec.js` owner=Colin | 实现 AI 的 PR 动到它们强制 review |

### Tier 2 — 宿主对抗 agent + 流程/教训固化（深度可选）

| 单元 | 文件 | 改动 |
|---|---|---|
| T2.1 宿主验收脚本 | `scripts/host-verify.mjs`(新) | 固化升级 `/tmp/cdp-verify.mjs`：CDP 读 VA 自动判 + 变异探针 + 截图 + 用宿主 token `gh pr checks` 等 CI e2e 真绿 |
| T2.2 run-spec 接线 | `scripts/run-spec.sh` | 容器收尾查 `<slug>.va.json` 缺失（告警 `MISSING_VA`，仿现有 compound `MISSING`）；宿主分支末尾可选第二道 `y` 触发 `host-verify.mjs` |
| T2.3 模板去假绿 | `pm/templates/spec-template.md`, `README.md` | 新增"§5.0 可见验收(VA)"必填段；删 §5.3 里"写好但容器内 skip / 靠肉眼验"这类给弱断言留后门的话术（见 template-false-green 教训）|
| T2.4 教训 | `CLAUDE.md` | 写 S4：代理断言(class)≠视觉验证；强断言判定标准；门必须有变异自检；required check 是服务端配置、写多强 e2e 都白搭如果 merge 不被 gate |

### Tier 3 — 闭环验证

重跑 spec2（rerun #4）从干净 main 切分支：强化后的门 + 变异自检应当**逼出 CSP-正确的 app，
或在它仍坏时当场红**。这同时（a）修好 spec2、（b）证明机制真能自我兜底。

## 5. 关键决策点：建多深？（需要你定）

两份设计都诚实给 catchPower 只打 6–7 分，残余漏洞是"VA 由人写、人写弱了门就对那维度瞎"
（§7）。对一个 demo 项目，全套有过度工程风险。三档：

- **只 Tier 0**：修好 spec2 + 这一条强 e2e。最省，但不通用——下个 spec 又得现写强断言，裁判=运动员的病没根治。
- **Tier 0+1**（我的推荐）：加 VA 契约 + 通用 runner + 变异自检 + required check。**这是"可靠 workflow"的最小完整体**：对所有未来 spec 通用，且"视觉 bug 不能绿着进 main"+"门自证不哑"两个承诺都兑现。不含最重的宿主 agent 机器。
- **Tier 0+1+2**：再加宿主对抗 agent（"真打开看"自动化）+ 流程/模板/教训固化。最全，最贴合你"宣布完成前必须真打开看"的诉求，但机器最多。

## 6. 人工一次性步骤（agent 没权限，记给 Colin）

- 在 GitHub 给 `main` 开 branch protection，把 CI 的 `e2e` job 设 required status check（agent token 缺 Administration，403）。**没这步，门写得再强 merge 也挡不住。**
- rotate 两个 token（demo 后，安全收尾，见 [[gh-token-workflow-scope]]）。

## 7. 风险 / 诚实的残余漏洞

- **VA 写弱 = 门对那维度瞎**：强度锚从实现 AI 挪到了写 VA 的人，没消灭只是挪位（但挪对了——人写阈值 + 实现 AI 不许碰，比实现 AI 自评强得多）。变异自检只能证明"门对它注入的坏状态有反应"，证不了"VA 列得够全"。
- **VA 是白名单**：没写进 VA 的元素（如某 spec 新增面板）白屏照样绿。缓解：VA 里放一条"目标元素截图非纯色/非全白"兜 app 空白。
- **CI 异步**：容器内当场仍拦不住坏 app，坏 PR 会先开出来几分钟后才红；靠 required check（而非"PR 不存在"）兜住合并。
- **required check 是运维状态不是代码**：有 admin 权限手滑关掉 branch protection 就裸奔，git 里看不出。对 Colin 自己只能靠纪律。可加轻量 `gate-integrity` job 调 `gh api` 断言 e2e 仍在 required 列表 + VA 文件没被本 PR 改弱。
- **亮度阈值脆性**：xvfb/Linux 与 macOS 有色差/抗锯齿，阈值贴边写会 flaky 误红——取 0.2/0.7 这种中间地带、留够 margin、采面积均值而非单像素。

## 8. 并行性 / 依赖

- T0.1（CSP）与 T0.2（强 e2e）可并行，但 T0.2 的变异验证依赖 T0.1 先修好（否则 app 本就坏）。
- T1.1（VA 实例）→ T1.2（runner）→ T1.3（自检）有依赖链；T1.5（CODEOWNERS）、T2.4（教训）独立可并行。
- Tier 3 重跑必须在 Tier 0/1 进 main 之后、从干净 main 切。
