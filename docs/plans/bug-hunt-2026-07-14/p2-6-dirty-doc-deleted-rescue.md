# [P2-6] 外部删除「打开中且未保存」的文档 → 给挽救提示(Colin 已条件同意:好实现就做;实查=好实现)

## 问题与复现(2/2)

文档开着、编辑器里有未保存修改(dirty 点亮)→ 在 Finder/终端删掉这个文件 →
树和标签正确消失,但**内存里的未保存改动被静默丢弃**,不给用户任何挽救机会。与丢数据一线之隔。

## 为什么好实现(已核实,三块料全是现成的)

- 删除检测:`doTreeScan` 的 `activeRelGone` 分支已精确命中「激活文档被外部删且 ino 找不到新址」
  (sidebar.js ≈:2355 `else if (window.__shellCloseDoc) window.__shellCloseDoc();`)。
- dirty 判定:`window.__shellIsDirty()` 现成(多处在用,如关 dirty 标签的确认流 ≈:1473)。
- 挽救 UI:`openSaveModal(closeAfter)`(≈:1485,「保存到哪里」modal)现成——临时文档关闭时就是这么救的,
  底下走 `ws-save-doc-as`(主进程原生另存框,e2e 有 `WS2_SAVE_AS_OUT` seam)。

## 修法

`activeRelGone` 的「没得回落」分支改为:

```js
else if (window.__shellIsDirty && window.__shellIsDirty()) {
  // 外部删除 + 有未保存修改:别静默丢——转成临时文档语义,弹「保存到哪里」给一次挽救(取消=丢弃,同临时文档口径)
  openSaveModal(true);
} else if (window.__shellCloseDoc) window.__shellCloseDoc();
```

细节要盯:① openSaveModal 走的是「临时文档」state(tempDoc/tempStore)——被删文档要先把 shell 当前内容
转挂成 temp 语义(grep 临时文档的建法,把编辑器 iframe 里的当前 HTML 取出来喂进去),别直接调就完事;
② 「回落到别的标签」分支(有 fallback entry 时)同样要先过 dirty 检查——回落也会换掉编辑器内容;
③ 用户点「取消」= 明确丢弃,走 closeDoc,不纠缠;④ 同文件被外部**改内容**(doc-watcher 的 doc-changed 重载)
是另一条路径,本计划不动它。

## 门

- e2e(live-tree.spec.js 追加):开文档→打字(dirty)→外部 rm →断言 SaveModal 出现;走 `WS2_SAVE_AS_OUT` seam
  存下→字节含刚打的字;对照:非 dirty 外部删→无 modal 直接空态(现行为不变)。
- 变异自检:把 dirty 检查去掉 → 翻红。

## 影响面/回归

只改一个分支+复用临时文档机器;回归重点=临时文档自身的关闭/保存流别被弄坏(跑 temp-doc 相关 spec)。
sidebar.js 共享核心 → 本地全量 e2e:dot。

## spec 记账

`docs/features/workspace-file-tree.md` 行为契约补「外部删除 dirty 文档 → 挽救式另存提示(取消=丢弃)」。
