# wordspace-next-demo

一次性 demo 仓，用于「全自动 feature shipping」演示：在隔离 dev container 里，让 Claude Code 无人值守把一条 spec 开发成测试通过、PR 开好的成品。

- **隔离运行**：`.devcontainer/`（非 root `node` 用户 + 默认拒绝出站 + 白名单），AI 在此随意改动不影响主项目，也连不了白名单外的网。
- **认证**：走 Claude 订阅（Pro/Max），用 `claude setup-token` 生成一年期 token，写进 `.devcontainer/devcontainer.local.env`（gitignored，不入仓），不需要 API key。
- **这是一次性演示仓**：`src/`、测试等由 spec 的 autonomous run 自己产出，初始只有裸脚手架。

上层计划见 `wl1390/projectx` 仓 `docs/plans/2026-06-02-001-feat-demo-repo-devcontainer-plan.md`。
