# [P2-4] `note:hello` 这类带冒号的搜索词被误当危险协议拦截

## 问题与复现(2/2,两实例四词)

地址栏输 `note:hello` / `todo:fix` / `re:报价` 回车 → 弹「已拦截」toast,什么都不发生。
用户预期(spec §5 判定意图):不是网址就搜索。

## 根因(已核实,src/lib/url-input.js)

`OPAQUE_SCHEME_RE = /^([a-z][a-z0-9+.-]*):(?=[^0-9])/i`(≈:18)把一切「词:非数字开头」都判成 scheme →
blocked。lookahead `[^0-9]` 只豁免了 `localhost:8080` 这种端口写法。代码注释表明本意是拦
`javascript:` / `file:` / `data:` 等危险协议——正则把普通含冒号的**搜索词**全误伤了。

## 修法

把「拦截」从「一切像 scheme 的」收窄到「真 scheme」,其余落搜索:

```js
// 只拦真实注册过的危险/不支持协议;`note:hello` 这类日常词组落搜索(spec §5:非网址即搜索)
var BLOCKED_SCHEMES = { javascript: 1, data: 1, file: 1, vbscript: 1, blob: 1, chrome: 1,
  about: 1, ws: 1, wss: 1, ftp: 1, mailto: 1, tel: 1, intent: 1 };
```

判定顺序改为:AUTHORITY_SCHEME_RE(带 `//` 的)不动;OPAQUE 匹配后**查名单**——在名单里才 blocked,
不在名单里当搜索词。风险点:自定义 scheme(`myapp:xxx`)从 blocked 变搜索——可接受,搜索无害且有明确
结果页;真要开 deep-link 是另一个 feature。`mailto:`/`tel:` 保持 blocked(v1 不外呼,维持现状)。

**同 PR 把口径写进 spec §5**(现在 spec 与实现两边表述有缝,这次对齐:列出 blocked 名单 + 「名单外含冒号
输入 = 搜索」)。

## 门

- 单测(`test/url-input.test.js` 已存在,追加):`note:hello`→search、`todo:fix`→search、
  `javascript:alert(1)`→blocked、`file:///etc`→blocked、`localhost:8080`→url、`myapp:token`→search。
- 变异自检:名单删掉 `javascript` → 单测翻红。
- e2e 一条:地址栏输 `note:hello` 回车 → 出搜索结果页(url 含引擎域)。

## 影响面/回归

纯逻辑模块,影响半径小;跑 url-input 全部单测 + browser.spec.js。

## spec 记账

`docs/browser-feature-spec.md` §5(如上);`docs/features/browser.md` 欠账里那条「tld-set 假 TLD」不动(另一件事)。
