# wordspace-next-demo · Spec 模板

这套模板把 projectx 那套**给人类工程师**的 feature spec 模板，改造成**给 AI 无人值守执行**的版本。两边是亲兄弟：demo spec 读起来跟 board 上的 F46 / F06 / F15 同源，但下游不一样。

- **projectx 的下游**：AI 起草 → Colin 逐字审 → Wendi 周五评审 → 质量门 → 外部人类 dev 从零实现。spec 是给"未来某个人类 dev"的专业交付物。
- **本仓的下游**：同一条 unattended pipeline —— `run-spec.sh` → `/lfg` → ce-plan → ce-work → 测试门 → PR。spec 是直接喂给 AI agent 跑的。

下游变了，模板就得跟着变。

## 文件

| 文件 | 角色 |
|---|---|
| `spec-template.md` | 完整 spec 模板（6 段 body + frontmatter），对应 projectx `spec-template-feature.md` |
| `spec-intent-template.md` | 意图卡模板，在 demo 里升格成 **gate ①**（run-spec.sh 打印、人按 y 确认） |

每条 demo spec 落两件：`specs/<slug>.md` + `specs/<slug>.intent.md`。projectx 还有第三件 `.gate.md`（质量门判定记录）——在本仓，**门判定从"人写的记录文件"变成 run-spec.sh 的运行时报告**（权威门 PASS/FAIL + compound WROTE/MISSING + PR URL）。

## 相对人类版的 6 处调整

| # | 人类版 | demo 版（为什么改） |
|---|---|---|
| 1 | frontmatter 14+ 字段（layer/ui_component/priority/reviewers…） | 砍到只留身份与依赖（id/title/slug/status/owner/depends_on/narrowed_from/created）。board/周评/外部 dev 协作字段在 demo 无意义。 |
| 2 | §5.1 用户时刻 + 性能预算（≤100ms / 内存≤20MB） | 可见实物（PR / 容器内 `npm test` 绿 + CI e2e 绿 / macOS 能用）+ compound 实物。headless 量不到真窗口性能，性能/手感留人肉眼。 |
| 3 | §5.3 五维非功能验收（Scale/Time/Cross-OS/Concurrency/Failure） | 跨平台/长时间/大规模/并发砍进 §2 Out；客观项落到 §5.2 Vitest 或 §5.3 在 CI（xvfb）真跑的 E2E。 |
| 4 | §5 单一验收层 | 拆成 §5.2 Vitest 必过（容器内权威快门，纯逻辑）/ §5.3 Electron e2e（**CI 上 xvfb 真跑的 app 集成门**；容器装不了 xvfb 故不在容器跑，堵「vitest 绿但 app 坏」，**不用 test.skip 假绿**，见 CLAUDE.md S3）。 |
| 5 | "由 dev 决定 / 由设计稿决定"的留口 | 全部消掉——无人 agent 没有下游人接留口，会当场停下来问。收进 §3 既定约束或划进 §2 Out。 |
| 6 | compound 靠人工 Documentation Sync 清单 | 升级成 §5.4 MUST-produce 交付物：把本 run 教训写进 `CLAUDE.md`，git diff 可断言，下一条 spec 自动 load。 |

新增的 In-Scope 硬交付物：**§2 "可测的逻辑层（与 Electron/DOM 解耦）"**——headless Vitest 门要有东西可咬。

## 规则

起草和自审仍然走 projectx 的单一规则源 `projectx-board/pm/templates/spec-ruleset.md`：起草读 A 段（瘦），自审跑 B 段（grep 词表 + 语义判定）。

**一个 demo 例外**：ruleset A1/B5 的"零实现泄漏"对外部 dev 是红线，但本仓 §3 既定约束 + §5 验收里**允许**出现 `Vitest` / `Electron` / `npm test` / `CLAUDE.md` / `DISPLAY`——它们是 demo 的运行机制本身、是交付物的一部分，不是泄漏给外部 dev 的实现细节。§1 / §2 / §4 仍守零实现泄漏。
