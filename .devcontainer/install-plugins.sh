#!/usr/bin/env bash
#
# install-plugins.sh — 把 compound-engineering 插件（提供 /lfg 等）固化进容器。
# 由 devcontainer.json 的 postCreateCommand 调用。
#
# 为什么放 postCreateCommand 而不是烤进 Dockerfile：
#   插件装进 user scope /home/node/.claude，而这个路径在 devcontainer.json 里是
#   named volume（claude-code-config-${devcontainerId}）。Dockerfile 烤进镜像的
#   /home/node/.claude 会被运行时挂上来的 volume 盖住 —— 只有「全新空 volume」首次
#   创建时 Docker 才把镜像内容拷进去；「volume 已存在但没插件」的情形拷不到，照样栽。
#   postCreateCommand 在 volume 挂好之后、对实时 volume 命令式安装，两种情形都覆盖。
#
# 幂等：已装就跳过 —— 重建容器 / volume 持久时不重复装、不报错。
# 网络：postCreate 跑在 firewall（postStartCommand）之前、网络开放；且 github 在白名单内。
#
set -euo pipefail

if claude plugin list 2>/dev/null | grep -q 'compound-engineering'; then
  echo "▶ [postCreate] compound-engineering 插件已在，跳过安装"
else
  echo "▶ [postCreate] 安装 compound-engineering 插件（/lfg 等依赖它）…"
  claude plugin marketplace add EveryInc/compound-engineering-plugin
  claude plugin install compound-engineering@compound-engineering-plugin
fi

echo "▶ [postCreate] 当前插件列表："
claude plugin list
