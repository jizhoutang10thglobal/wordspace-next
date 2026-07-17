# [P1] 错误页是死胡同:出错后输入好网址,页面加载成功但 UI 永远停在错误占位

## 问题与复现(3/3)

1. 新建网页标签,导航到打不开的地址(如 `http://127.0.0.1:1/`)→ 错误占位 `#web-error` 出现(正确)。
2. 不切标签,直接在地址栏输入一个能打开的网址回车。
3. 主进程侧其实加载成功(`web-tab-updated` 的 registry 状态、历史都对),但 renderer:`#web-error` 不消失、
   view 不重挂(attach 数 0)——用户看到的还是错误页。切走标签再切回才恢复。

## 根因(已核实,src/renderer/browser.js)

- `showError(key, err)`(≈:213)在出错时摘掉 view:`if (attachedKey === key) { webHideAll(); attachedKey = null; }`。
- 后续成功导航到来时,清占位的分支(≈:250)是 `else if (!s.error && attachedKey === s.key) errEl.hidden = true;`
  ——它要求「view 还挂着」,但上一步刚把 `attachedKey` 置了 null,**永不命中**。
- 唯一的重挂分支(≈:245,`everCommitted`)只处理「起始页 → 真网页」(`!newtabEl.hidden` 守卫),错误页态不进。

## 修法

在 `web-tab-updated` 的渲染分派里给「错误已清除但 view 没挂」补一条独立分支(放 everCommitted 分支旁边):

```js
// 错误页 → 成功导航:错误清了、该标签是激活的网页标签、但 view 没挂(showError 摘掉的)→ 重挂 + 收占位
if (!s.error && !errEl.hidden && isWebActive() && keyOf(activeEntry()) === s.key && attachedKey !== s.key) {
  errEl.hidden = true;
  showWebView(s.key); // 用现有的 attach 函数(grep 现名,可能叫 attachWeb/showWeb)
}
```

注意:① 只对**激活标签**做(后台标签出错后成功,等切回时走既有激活漏斗);② 别动 showError 摘 view 的行为
(那是对的——错误占位是 DOM,view 不摘会盖住它);③ `errEl` 是全局占位还是每标签,先读清 `showError`/`syncSurfaces`
一带的结构再下手,别想当然。

## 门

- e2e(放 `e2e/browser.spec.js`):本地 server 造「坏地址 → 错误页 → 好地址」流,断言 `#web-error` hidden
  且 view attach 回来(像素或 bounds 断言,照该文件既有三件套写法);再加「后台标签出错→切回→好地址」变体。
- 变异自检:把新分支条件改错(如 `attachedKey === s.key`)→ e2e 必翻红。

## 影响面/回归

只动 browser.js 渲染分派,影响半径=网页标签渲染。回归重点:起始页↔网页切换、慢页加载中切标签(everCommitted
分支别被误伤)。跑全量 `e2e/browser.spec.js`。

## spec 记账

`docs/browser-feature-spec.md` §错误页(grep「错误页」)补一句「错误态→成功导航必须原地恢复」;
`docs/features/browser.md` 锚点加一行。
