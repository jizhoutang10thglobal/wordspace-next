# [P2-2] 连删多个文件,只能撤销最后一个

## 问题与复现(2/2)

删文件 A(toast「已删除,撤销」出现)→ 紧接着删文件 B → A 的 toast 被顶掉,只剩 B 的撤销。
A 其实还在 24h 备份区(`userData/.ws2-trash`),但**没有任何 UI 能取回** = 用户视角等同丢失。

## 根因(已核实,src/renderer/sidebar.js)

`showToast(message, actionLabel, onAction)`(≈:1913)开头 `host.innerHTML = ''`(≈:1921)——
每条新 toast 清空容器,上一条的撤销按钮(闭包着 undo token)随 DOM 一起销毁。

## 修法(取甲,乙备选)

**甲(推荐,改动小):toast 栈式堆叠。**
- `showToast` 不再清容器,新 toast append,容器改纵向 flex(底部往上摞),每条自己带超时消失(现有超时逻辑挪到条目级)。
- 上限 3-4 条,超出挤掉最旧的**非带撤销**条;带撤销的条超时放宽(如 15s)。
- 删除撤销的 onAction 闭包已经是逐条独立的(undo token 一删一个),堆叠后天然各撤各的,不用动删除逻辑。

**乙(更彻底,改动大):撤销栈 + ⌘Z 连撤**——需要把删除撤销并进全局 undo 体系,超出本计划范围,不做。

## 门

- e2e(删除相关 spec,grep「撤销」找现有文件追加):连删 A、B → 两条 toast 并存 → 分别点撤销 → A、B 都回来
  (盘上 + 树上);再验超时自动消失不误伤另一条。
- 变异自检:把 append 改回 `innerHTML=''` → e2e 翻红。

## 影响面/回归

toast 是全局组件(改名冲突提示等也用它)——回归跑一遍用到 showToast 的场景(grep showToast 调用点逐个看),
样式动 shell.css 的 toast 区。sidebar.js 共享核心 → 本地全量 e2e:dot。

## spec 记账

`docs/features/workspace-file-tree.md` 行为契约「删除可撤销」处补「多条删除各自可撤销(toast 堆叠)」。
