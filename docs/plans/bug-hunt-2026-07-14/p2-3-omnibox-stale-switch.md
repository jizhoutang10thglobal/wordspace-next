# [P2-3] 地址栏打字到一半切标签,残留文字会在新标签上误导航

## 问题与复现(2/2)

网页标签 A 的地址栏里打了半截字(不回车)→ `Ctrl+Tab` / `⌘1-9` 键盘切到标签 B →
地址栏**还显示 A 上打的半截字**(应重置为 B 的 url,spec §4.1「切标签时同步重置」)。
此时回车 → 半截字在 **B** 上导航/搜索出去。鼠标点标签切换因为触发 blur,没这个问题。

## 根因(已核实,src/renderer/browser.js)

- `syncOmni()` 开头有守卫 `if (omniTyping) return;`(≈:356,「打字中不抢输入」——本意对,防的是
  后台标签的 title 更新事件把正在打的字冲掉)。
- `omniTyping` 置 true 在 focus/input(≈:469),置 false 只在 blur 后 150ms 宽限(≈:496,点建议的时间窗)。
- 键盘切标签**不触发 omnibox blur** → omniTyping 一直 true → 切标签后的 syncOmni 被守卫吞掉 → 残留。

## 修法

切标签是「用户明确离开当前输入上下文」,应强制结束打字态。在**标签激活切换的漏斗**(sidebar.js 的
`cycleTab`/`tabByIndex` 会走 `openTabRow` → 激活变更,browser.js 侧有对应的激活同步点,grep `syncOmni` 的
调用点找到「激活标签变了」那个)加:

```js
// 切标签 = 明确离开输入上下文:强制结束打字态再同步,残留输入丢弃(spec §4.1)
omniTyping = false;
if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; }
hideSug();
syncOmni();
```

注意:只在「激活 entry 的 key 真变了」时做,别在同标签的状态更新里做(否则守卫白设,打字被 title 事件冲掉的
老 bug 会回来——**这就是那个守卫存在的原因,别一刀切删守卫**)。

## 门

- e2e(`e2e/browser.spec.js` 追加):A 打半截字 → 模拟 Ctrl+Tab → 断言 omnibox 值 = B 的 url;
  回车 → 导航的是 B 的 url 不是残词。对照组:打字中收到后台 title 更新 → 输入不被冲掉(守住原守卫)。
- 变异自检:去掉强制复位 → 第一条翻红;删守卫 → 对照组翻红。

## 影响面/回归

browser.js 输入态机;回归重点 = 点建议的 150ms 宽限窗(鼠标点补全项)别被 clearTimeout 误伤——
只在**切标签**路径清,blur 路径不动。

## spec 记账

`docs/browser-feature-spec.md` §4.1/§4.2 补一句「切标签强制结束编辑态,未提交输入丢弃」。
