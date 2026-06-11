#!/usr/bin/env bash
#
# run-spec.sh — Wordspace Next 全自动 feature shipping 的无人编排驱动
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

  # headless（无 TTY）下 gh 缺参数会弹交互 prompt 直接挂死整条无人值守链；禁掉它，
  # 让 gh 缺参时变成非零退出而不是卡住（push/PR 兜底依赖这点，见文末兜底段）。
  export GH_PROMPT_DISABLED=1

  echo "▶ [container] 准备 git / gh 身份…"
  git config user.email  >/dev/null 2>&1 || git config user.email "bot@wordspace-next.local"
  git config user.name   >/dev/null 2>&1 || git config user.name  "wordspace-next bot"
  gh auth setup-git 2>/dev/null || true   # 让 git 走 GH_TOKEN

  # 不在 default 分支上直接干活：开一条 feat 分支供 lfg/ce-work push + 开 PR
  CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  if [[ "$CUR_BRANCH" == "main" || "$CUR_BRANCH" == "master" ]]; then
    NEW_BRANCH="feat/${SLUG}-$(date +%Y%m%d-%H%M%S)"
    echo "▶ [container] 从 $CUR_BRANCH 切到新分支 $NEW_BRANCH"
    git switch -c "$NEW_BRANCH" 2>/dev/null || git checkout -b "$NEW_BRANCH"
  fi

  # 把本次 spec 的输入文件（spec.md / intent.md / va.json，都是人写、实现 AI 不该改）前置
  # commit 进分支，确保进最终 PR——尤其 requires_va 的 spec，va.json 必须跟着，否则 va-coverage
  # 门红、va-runner 没 VA 可跑。做完这步 lfg 只管写 feature 代码。
  if git status --porcelain -- "specs/${SLUG}".* 2>/dev/null | grep -q .; then
    git add "specs/${SLUG}".*
    git commit -m "chore(${SLUG}): spec + intent + VA 输入（人写，实现前置）" >/dev/null 2>&1 || true
    echo "▶ [container] 已前置 commit 本次 spec 输入（specs/${SLUG}.*）"
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

  # ── VA 状态报告：有可见效果的 spec（front-matter requires_va: true）必须带
  #    specs/<slug>.va.json（验收门强度锚，人写、实现不许改）。真正的硬门是 vitest 里的
  #    va-coverage.test.js（requires_va 缺 va.json 直接判红 → 上面 GATE 已 FAIL），这里只把状态
  #    显式打进报告，免得"绿但缺 VA"被忽略。纯逻辑无 UI 的 spec（requires_va 非 true）没有也正常。
  VA_FILE="${SPEC%.md}.va.json"
  if [[ -f "$VA_FILE" ]]; then
    VA="HAS"
  elif grep -qiE '^requires_va:[[:space:]]*true' "$SPEC" 2>/dev/null; then
    VA="MISSING（必需！va-coverage 已判红）"
  else
    VA="N/A（本 spec 不需要）"
  fi

  # ── push/PR 兜底：lfg 的 push/开 PR 步骤被网络中断 / API 529 掐断时不报错、照常输出 DONE
  #    （见 lfg-push-silent-fail 教训）。失败现场实测：本地有 commit、远端无分支、无 open PR，
  #    三者齐缺，且 lfg 日志里压根没有 push 输出——所以这里不靠 grep 日志，而是直接查真实
  #    git / 远端状态，缺什么补什么。恢复顺序固定不可颠倒：先保证远端分支在（ls-remote→缺则 push）
  #    → 再保证 PR 在（gh pr list 探测→缺则 create）。只覆盖"远端无分支 / 无 PR"两态；
  #    "PR 已开但本地领先远端"不在本 demo 一次性分支的场景里，不处理。
  BR="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
  AHEAD="$(git rev-list --count "${BASE}..HEAD" 2>/dev/null || echo 0)"
  RESCUE="无需兜底"

  # 硬守卫：绝不在 main/master/detached 上 push+开 PR；lfg 没产出 commit（AHEAD=0）也不硬开空 PR。
  if [[ "$BR" != "main" && "$BR" != "master" && "$BR" != "HEAD" && -n "$BASE" && "$AHEAD" -gt 0 ]]; then
    PUSHED_NEW=""
    # 步骤 1：远端没有该分支 → lfg push 疑似被掐断，补 push（带一次瞬时重试，但权限/分叉类不重试）
    if ! git ls-remote --exit-code --heads origin "$BR" >/dev/null 2>&1; then
      echo "▶ [container] 远端无分支 $BR（本地领先 $AHEAD commit）—— lfg push 疑似被掐断，兜底补 push"
      PUSH_ERR="$(git push -u origin "$BR" 2>&1)"; PUSH_RC=$?
      printf '%s\n' "$PUSH_ERR"
      if [[ "$PUSH_RC" -ne 0 ]]; then
        if printf '%s' "$PUSH_ERR" | grep -qiE 'non-fast-forward|\[rejected\]|\[remote rejected\]|protected|rule violation|workflow'; then
          echo "✗ [container] push 被拒（权限/分叉，非瞬时网络）—— 不重试、不强推（见 gh-token-workflow-scope）" >&2
        else
          echo "▶ [container] push 疑似瞬时失败（网络/529），5s 后重试一次…" >&2; sleep 5
          PUSH_ERR="$(git push -u origin "$BR" 2>&1)"; PUSH_RC=$?; printf '%s\n' "$PUSH_ERR"
        fi
      fi
      if git ls-remote --exit-code --heads origin "$BR" >/dev/null 2>&1; then
        PUSHED_NEW=1
      else
        RESCUE="兜底失败（push 未成，远端仍无分支）"
      fi
    fi
    # 步骤 2：远端分支确认在场后，缺 open PR 就补开（用 gh pr list 探测，不用裸 gh pr view——
    #         后者对 closed/merged 分支假阴性会误判重复创建）
    if git ls-remote --exit-code --heads origin "$BR" >/dev/null 2>&1; then
      PR_EXIST="$(gh pr list --head "$BR" --base main --state open --json url --jq '.[0].url // empty' 2>/dev/null || true)"
      if [[ -z "$PR_EXIST" ]]; then
        echo "▶ [container] 远端有分支但无 open PR —— 兜底补开 PR"
        PR_TITLE="feat(${SLUG}): $(git log -1 --pretty=%s 2>/dev/null || echo "$SLUG")"
        CREATE_ERR="$(gh pr create --base main --head "$BR" --title "$PR_TITLE" \
          --body "由 run-spec.sh push/PR 兜底自动补开（lfg 已 commit，但 push/开 PR 步骤被网络掐断，见 lfg-push-silent-fail 教训）。spec: ${SPEC}" 2>&1)"; CREATE_RC=$?
        printf '%s\n' "$CREATE_ERR"
        # 竞态：别处刚好开了同分支 PR，gh 报 already exists，按成功处理
        if [[ "$CREATE_RC" -ne 0 ]] && printf '%s' "$CREATE_ERR" | grep -qi 'already exists'; then CREATE_RC=0; fi
        if [[ "$CREATE_RC" -eq 0 ]]; then
          RESCUE="兜底补开 PR${PUSHED_NEW:+（含 push）}"
        else
          RESCUE="兜底失败（gh pr create）"
        fi
      elif [[ -n "$PUSHED_NEW" ]]; then
        RESCUE="兜底补 push（PR 原已存在）"
      fi
      # else：分支在 + PR 在 + 没补过 push = lfg 自己跑通了，RESCUE 保持"无需兜底"
    fi
  fi

  # 统一（重新）求 PR_URL：无论 lfg 自己开的、兜底补开的、还是 main 守卫分支，都以此为准；
  # 用 list 而非裸 gh pr view，对 closed/merged 不假阴性。红门 comment 依赖这个值，必须在它之后。
  PR_URL="$(gh pr list --head "$BR" --base main --state open --json url --jq '.[0].url // empty' 2>/dev/null || true)"

  # 红门有后果：给已开出的 PR 打 comment 警示，别让红门变成纯摆设。
  if [[ "$GATE" == "FAIL" && -n "$PR_URL" ]]; then
    gh pr comment "$PR_URL" --body "⚠ 容器内权威复核门 \`npm test\` 失败（退出码 ${GATE_RC}）。这条 PR 由 lfg 在测试门之前就已开出，请勿合并直到门转绿。" 2>/dev/null || true
  fi

  echo ""
  echo "════════════════════════════════════════════"
  echo "  spec       : ${SPEC}"
  echo "  权威门     : ${GATE}（npm test 退出码 $GATE_RC）"
  echo "  compound   : ${COMPOUND}（CLAUDE.md 是否被本 run 写入教训）"
  echo "  可见验收VA : ${VA}（specs/<slug>.va.json 是否就位，验收门强度锚）"
  echo "  补救       : ${RESCUE}"
  echo "  PR         : ${PR_URL:-<未检测到 PR>}"
  echo "════════════════════════════════════════════"

  # 退出码：权威门红（GATE_RC=1）优先；门绿但本应有 PR 却最终没有 → 标记未交付（7，避开已用的 2-6）。
  # 这正是为了不重蹈"看起来 DONE 实际没产出"——无人值守的调用方靠非零退出就能发现这次没交付。
  FINAL_RC="$GATE_RC"
  if [[ "$GATE_RC" -eq 0 && "$AHEAD" -gt 0 && -z "$PR_URL" ]]; then
    echo "⚠ [container] 本 run 有 commit 但最终无 PR（兜底未能补开）—— 标记未交付（exit 7）" >&2
    FINAL_RC=7
  fi
  exit "$FINAL_RC"
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
INNER_RC=$?

# ── 宿主对抗验收（可选第二道门）：容器里打不开 app（无显示器），所以"真打开看效果"
#    放宿主、人触发。真启动 app、按 specs/<slug>.va.json 验真实可见效果 + 变异探针证门
#    有牙 + 截图存证。带 PR 号还会用宿主 token 确认 CI e2e 真绿（破容器读不到 CI 的约束）。
echo ""
read -r -p "在宿主真打开 app 跑对抗验收（看效果是否符合 VA）？[y/N] " va_ans
if [[ "$va_ans" == "y" || "$va_ans" == "Y" ]]; then
  if [[ -d node_modules/electron/dist/Electron.app ]]; then
    node scripts/host-verify.js \
      || echo "⚠ 对抗验收否决（见上）——别合这条 PR，直到可见效果真符合 VA。"
  else
    echo "⚠ 宿主 node_modules 不是 darwin electron（容器跑完常把它装成 Linux 版）。"
    echo "  先重装宿主依赖再手动跑：node scripts/host-verify.js [PR号]（见 node-modules-platform 教训）"
  fi
fi
exit "$INNER_RC"
