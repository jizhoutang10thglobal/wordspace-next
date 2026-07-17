# [P3-01] 文档标签/起始页上出现死的收藏星标

**问题(2/2)**:激活的是文档标签(或起始页)时,地址栏区域仍显示收藏星标 ☆,点了无效(死按钮)。

**根因(已核实)**:JS 正确设了 `hidden = true`,但 `browser.css` ≈:48 给 `.sb-omni-star`(grep 确认类名)
写了 `display: inline-flex`,优先级压过 UA 的 `[hidden]{display:none}`;文件里 ≈:425 有一批
`[hidden]{display:none!important}` 防御清单,唯独漏了这个类。

**修法**:把该类加进那批 `!important` 防御清单(一行);顺手 grep browser.css 里所有
`display:(inline-)?flex` 的类,对照哪些还有同款隐患,一并补进清单(探索员只撞到这一个,可能有同伙)。

**门**:e2e 一条——激活文档标签断言星标 `toBeHidden()`;变异:从清单里删掉该类→翻红。

**spec 记账**:无行为变化,`docs/features/browser.md` 锚点一行即可。
