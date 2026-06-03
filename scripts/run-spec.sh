#!/usr/bin/env bash
#
# run-spec.sh — 全自动 feature shipping demo 的无人编排驱动
#
#   一条命令把： 意图确认(gate ①) → 起隔离容器 → 容器内 /lfg 无人值守
#   (plan→work→review→commit→push→PR) → 权威测试门(npm test) → 报告 PR
#   串起来。确认意图后人就可以走开。
#
# 用法（在 macOS 宿主、仓根目录跑）：
#
#     scripts/run-spec.sh specs/skeleton.md
#
# 它会：
#   1) 打印 specs/skeleton.intent.md 这张意图卡片，等你按 y 确认（gate ①）
#   2) source 本地 token（gitignored 的 .devcontainer/devcontainer.local.env）
#   3) devcontainer up 起容器（幂等）
#   4) 在容器内重新调用本脚本的 --inner 分支，跑 /lfg + npm test + 取 PR
#
# 前提：本机已装 @devcontainers/cli；token 文件已就位（CLAUDE_CODE_OAUTH_TOKEN
# + 只锁本仓的 GH_TOKEN）。容器内 git push / PR 用 GH_TOKEN，无需宿主 gh 切号。
#
set -uo pipefail

# ── 容器内分支（由宿主分支通过 devcontainer exec 调起，非交互）─────────────
if [[ "${1:-}" == "--inner" ]]; then
  SPEC="${2:?--inner 需要 spec 路径}"
  SLUG="$(basename "${SPEC%.md}")"

  # Electron 预编译二进制在本容器下不下来（防火墙未放行 GitHub release 资源域名），
  # 且路 1 不在容器里启动 Electron，所以跳过它的下载，让 npm install 干净通过。
  export ELECTRON_SKIP_BINARY_DOWNLOAD=1

  echo "▶ [container] 准备 git / gh 身份…"
  git config user.email  >/dev/null 2>&1 || git config user.email "demo-bot@wordspace.local"
  git config user.name   >/dev/null 2>&1 || git config user.name  "wordspace demo bot"
  gh auth setup-git 2>/dev/null || true   # 让 git 走 GH_TOKEN

  # 不在 default 分支上直接干活：开一条 demo 分支供 lfg/ce-work push + 开 PR
  CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  if [[ "$CUR_BRANCH" == "main" || "$CUR_BRANCH" == "master" ]]; then
    NEW_BRANCH="demo/${SLUG}-$(date +%Y%m%d-%H%M%S)"
    echo "▶ [container] 从 $CUR_BRANCH 切到新分支 $NEW_BRANCH"
    git switch -c "$NEW_BRANCH" 2>/dev/null || git checkout -b "$NEW_BRANCH"
  fi

  # 确保 vitest 等基础依赖在位（node_modules 在 bind mount 上，通常已装）
  if ! npx --no-install vitest --version >/dev/null 2>&1; then
    echo "▶ [container] npm install（首次 / 依赖缺失）…"
    npm install || { echo "✗ [container] npm install 失败（whitelist/网络？）" >&2; exit 6; }
  fi

  LOG="$(mktemp -t lfg-${SLUG}.XXXXXX.log)"
  echo "▶ [container] 启动 /lfg 无人值守跑 ${SPEC} （日志：$LOG）"
  echo "  —— 这一段全自动，可以走开了 ——"

  # 关键：普通 claude -p（不带 --bare，否则不读 OAuth token）；skip-permissions 仅容器内安全。
  # /lfg 会把 ce-plan/ce-work 等带入 pipeline 模式，跳过交互 gate，最后输出 <promise>DONE</promise>。
  # timeout 兜底：ce-work 的"继续/新建分支"AskUserQuestion 在 headless -p 下无人回答，
  # 且 --dangerously-skip-permissions 压不住 AskUserQuestion；任何卡住的 gate 都用墙钟封顶。
  # 超时(退出码 124)会走下面"没看到 DONE"的告警分支，权威门照跑。
  timeout 3600 claude -p "/lfg ${SPEC}" \
    --dangerously-skip-permissions \
    --output-format stream-json --verbose \
    2>&1 | tee "$LOG"
  LFG_RC="${PIPESTATUS[0]}"

  echo ""
  if grep -q '<promise>DONE</promise>' "$LOG"; then
    echo "✓ [container] lfg 报告 DONE"
  else
    echo "⚠ [container] 没在输出里看到 <promise>DONE</promise>（lfg 退出码 $LFG_RC）——下面仍跑权威门确认。"
  fi

  # ── 权威复核门：容器内 npm test（Vitest）。注意 lfg 已在链里 commit/push/开 PR，
  #    所以这道门是 PR 开出"之后"的最终复核：红了就给 PR 打 comment 警示（见下），不自动合并。──
  echo ""
  echo "▶ [container] 权威复核门：npm test"
  if npm test; then
    GATE="PASS"; GATE_RC=0
  else
    GATE="FAIL"; GATE_RC=1
  fi

  # ── compound 兜底检查：本 run 是否往 CLAUDE.md 写了教训（spec 1 的明确交付物，见 spec §5.4）。──
  #    只报告、不改判：compound 缺失不该让权威测试门判红，但要让人看见。committed 或工作区改动都算。
  BASE="$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null || true)"
  if { [[ -n "$BASE" ]] && git diff --name-only "$BASE" HEAD -- CLAUDE.md 2>/dev/null | grep -q .; } \
     || [[ -n "$(git status --porcelain -- CLAUDE.md 2>/dev/null)" ]]; then
    COMPOUND="WROTE"
  else
    COMPOUND="MISSING"
  fi

  PR_URL="$(gh pr view --json url -q .url 2>/dev/null || true)"

  # 红门有后果：给已开出的 PR 打 comment 警示，别让红门变成纯摆设。
  if [[ "$GATE" == "FAIL" && -n "$PR_URL" ]]; then
    gh pr comment --body "⚠ 容器内权威复核门 \`npm test\` 失败（退出码 ${GATE_RC}）。这条 PR 由 lfg 在测试门之前就已开出，请勿合并直到门转绿。" 2>/dev/null || true
  fi

  echo ""
  echo "════════════════════════════════════════════"
  echo "  spec       : ${SPEC}"
  echo "  权威门     : ${GATE}（npm test 退出码 $GATE_RC）"
  echo "  compound   : ${COMPOUND}（CLAUDE.md 是否被本 run 写入教训）"
  echo "  PR         : ${PR_URL:-<未检测到 PR>}"
  echo "════════════════════════════════════════════"
  exit "$GATE_RC"
fi

# ── 宿主分支（默认，交互）──────────────────────────────────────────────────
SPEC="${1:?用法: scripts/run-spec.sh <spec路径>，如 specs/skeleton.md}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

[[ -f "$SPEC" ]] || { echo "✗ 找不到 spec: $SPEC" >&2; exit 2; }
INTENT="${SPEC%.md}.intent.md"
[[ -f "$INTENT" ]] || { echo "✗ 找不到意图卡片: $INTENT" >&2; exit 2; }

# gate ①：打印意图卡片，等人确认
echo "────────────────────────────────────────────"
cat "$INTENT"
echo "────────────────────────────────────────────"
read -r -p "确认意图、开始无人值守跑？[y/N] " ans
[[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "已取消。"; exit 0; }

# 加载 token（不落 shell 历史；devcontainer.json 用 ${localEnv:...} 读它们）
ENV_FILE=".devcontainer/devcontainer.local.env"
[[ -f "$ENV_FILE" ]] || { echo "✗ 缺 $ENV_FILE（需含 CLAUDE_CODE_OAUTH_TOKEN + GH_TOKEN）" >&2; exit 3; }
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a
[[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]] || { echo "✗ CLAUDE_CODE_OAUTH_TOKEN 为空" >&2; exit 3; }
[[ -n "${GH_TOKEN:-}" ]] || { echo "✗ GH_TOKEN 为空" >&2; exit 3; }

command -v devcontainer >/dev/null 2>&1 || {
  echo "✗ 没装 devcontainer CLI。装：npm i -g @devcontainers/cli" >&2; exit 4; }

echo "▶ [host] devcontainer up（幂等，起/复用容器）…"
devcontainer up --workspace-folder . || { echo "✗ devcontainer up 失败" >&2; exit 5; }

echo "▶ [host] 进容器跑无人链路（显式带入 token，避免复用旧容器时拿到空 token）…"
devcontainer exec --workspace-folder . -- \
  env GH_TOKEN="$GH_TOKEN" CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  bash scripts/run-spec.sh --inner "$SPEC"
exit $?
