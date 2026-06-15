# Wordspace Next

**Wordspace Next 官方仓**：HTML-native 文档编辑器，spec 驱动开发，带对抗性验收门禁；macOS 构建自动签名、公证并经 GitHub Releases 自动更新分发。

开发方式：spec → AI 实现过全部门禁（vitest 快门 + 真 Electron e2e + 人锁 VA 可见验收 + 变异自检）→ PR → 合并自动发版。

- **隔离运行**：`.devcontainer/`（非 root `node` 用户 + 默认拒绝出站 + 白名单），无人值守 run 在容器内进行。
- **认证**：走 Claude 订阅（Pro/Max），`claude setup-token` 生成 token 写进 `.devcontainer/devcontainer.local.env`（gitignored）。
- **产品愿景**：canonical 产品文档见 `docs/product-vision.md`（作者 Wendi）。

> 本仓前身为 `wordspace-next-demo`（全自动 feature shipping 演示仓，2026-06 转正）。演示期的历史文档保留在 `docs/`，按当时语境阅读。
