// 真 app 验收审计 · 变异注入（变异自检 / 门有没有牙）
// 「门存在 ≠ 门够强」（CLAUDE.md S4）。每个 mutation 在 scenario.drive 之后、capture 之前，把
// 「功能效果」破坏掉，产出一份**坏证据**喂判官。selfcheck 模式下：哑门 = 判官被骗把注坏场景判 pass。
// 判 fail（或诚实 unsure）= 门有牙。这把「断言够不够强」本身变成被测对象，不靠自觉。
//
// mutation(ctx, driveOut)：操作 iframe DOM（Playwright 经 CDP 注入，不受文档 sandbox 拦）。
// 破坏的是 capture 真正读的那个块（[data-ws2-editing] / [data-ws2-selected]），并保留编辑/选中标记，
// 让判官仍能定位它、但看到「类型/内容不对」。

const bodyEval = (ctx, fn) => ctx.frame.locator('body').evaluate(fn)

export const MUTATIONS = {
  // 插入「标题 1」后，把新标题块**原地降级成普通 <p>**（保留文字 + 编辑标记）→「插入标题却是正文」bug。
  'insert-heading': (ctx) =>
    bodyEval(ctx, () => {
      const el = document.querySelector('[data-ws2-editing]')
      if (el && /^h[123]$/i.test(el.tagName)) {
        const p = document.createElement('p')
        p.setAttribute('data-ws2-editing', '')
        p.innerHTML = el.innerHTML || '新标题'
        el.replaceWith(p)
      }
    }),

  // 插入「列表」后，清空新 <ul> 的项 →「空列表、无项目符号、打字蒸发」bug（liCount=0）。
  'insert-list': (ctx) =>
    bodyEval(ctx, () => {
      const el = document.querySelector('[data-ws2-editing]')
      if (el && (el.tagName === 'UL' || el.tagName === 'OL')) el.innerHTML = ''
    }),

  // 「转为标题」后，把 #p1 退回 <p>（保留编辑标记）→「转换没生效、仍是正文」bug。
  'turn-text-to-heading': (ctx) =>
    bodyEval(ctx, () => {
      const h = document.querySelector('#p1')
      if (h && /^h[123]$/i.test(h.tagName)) {
        const p = document.createElement('p')
        p.id = 'p1'
        if (h.hasAttribute('data-ws2-editing')) p.setAttribute('data-ws2-editing', '')
        p.innerHTML = h.innerHTML
        h.replaceWith(p)
      }
    }),
}
