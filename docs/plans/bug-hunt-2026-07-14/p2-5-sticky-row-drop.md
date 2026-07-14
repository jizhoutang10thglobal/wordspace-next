# [P2-5] 树滚动后,吸顶的祖先行是拖放死区

## 问题与复现(4/4)

树滚下去、根标题/祖先文件夹被「吸顶」显示(`#sb-sticky` 浮层)后,把文件拖到**你看见的那行**上 →
静默无效(移入文件夹/跨根移动都中招);同一次拖放到树里的「真行」则成功。绕法=滚回去让真行可见。

## 根因(已核实,src/renderer/sidebar.js `renderSticky` ≈:690)

吸顶行 = `el.cloneNode(true)`。cloneNode 不复制 property 事件——代码**知道**这一点,补回了
`clone.onclick`(滚到真行)和 `clone.oncontextmenu`(转发给真行),但**漏了 `ondragover`/`ondrop`**。
`.sb-sticky-row` 是 `pointer-events: auto`(shell.css ≈:283),于是拖拽事件被克隆行截获,死在那里。

## 修法

照 `oncontextmenu` 的转发模式,把拖拽三件也接上(转发给真行 `el`,复用真行的既有 handler,零新逻辑):

```js
clone.ondragover = (e) => { e.preventDefault(); /* 视觉反馈照真行的 class 切换,若真行 handler 自带,转发即可 */ };
clone.ondrop = (e) => {
  e.preventDefault();
  el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: e.dataTransfer }));
};
```

注意:① 真行的 dragover 可能维护 hover 高亮 class——克隆行要有同款视觉反馈(加同一个 class 到 clone),
否则用户不知道能放;② `DragEvent` 带 dataTransfer 的合成派发在 Electron/Chromium 下可用,但如果真行 handler
读的是模块级 `dragNode` 变量(sidebar.js 拖拽区通常这么写)而不是 dataTransfer,那直接在 clone handler 里
调真行 drop 的同一个函数更稳——**先读真行 drop handler 的实现再选转发方式**;③ dragleave 清理反馈别漏。

## 门

- e2e(树拖拽 spec 追加):造长树滚到出吸顶 → 合成拖放到吸顶行 → 文件真的移进该文件夹(树+盘断言);
  对照:拖放到真行仍好。
- 变异自检:去掉 ondrop 挂接 → 翻红。

## 影响面/回归

与 p2-1(文件夹拖拽)同区,**两条计划建议同一个执行者接**(或后接者 rebase 时对齐 renderSticky 的改动)。
sidebar.js 共享核心 → 本地全量 e2e:dot。

## spec 记账

`docs/features/workspace-file-tree.md`(compact/吸顶属它)补「吸顶行接受拖放,行为等同真行」。
