import { resetPage } from './setup.mjs'
import { runInvariants } from './invariants.mjs'

// 变异自检（KTD-7 / origin R6）：逐个注入「已知坏状态」，断言对应不变量**必翻红**。
// 该红不红 = 哑门 = 退出码非 0。证明门有牙、不是摆设。
// 每个用例前 resetPage 复位（干净实例，避免串扰）。

const MUTATIONS = [
  {
    target: 2,
    label: '删光所有块 → #2 应翻红',
    async inject(page) {
      await page.evaluate(() => document.querySelectorAll('.ws-block').forEach((b) => b.remove()))
    },
  },
  {
    target: 3,
    label: '两块同 id → #3 应翻红',
    async inject(page) {
      await page.evaluate(() => {
        const els = document.querySelectorAll('[data-block]')
        if (els.length >= 2) els[1].setAttribute('data-block', els[0].getAttribute('data-block'))
      })
    },
  },
  {
    target: 4,
    label: 'editing 块与焦点块不一致 → #4 应翻红',
    async inject(page) {
      await page.evaluate(() => {
        const blocks = [...document.querySelectorAll('.ws-block')].filter((b) =>
          /ws-blk-(text|h[123]|list|quote|callout)/.test(b.className),
        )
        if (blocks.length < 2) return
        blocks[0].classList.add('ws-block-editing') // editingId = A
        const innerB = blocks[1].querySelector('[data-block]')
        innerB.setAttribute('contenteditable', 'true')
        innerB.focus() // 焦点 = B ≠ A
      })
    },
  },
  {
    target: 7,
    label: '块内容混入编辑器 chrome → #7 应翻红',
    async inject(page) {
      await page.evaluate(() => {
        const el = document.querySelector('[data-block]')
        if (el) el.innerHTML = '<span class="ws-block-controls">脏</span>污染'
      })
    },
  },
  {
    target: 8,
    label: '把某块 ⋮⋮ 挪偏 60px → #8 应翻红',
    async inject(page) {
      await page.evaluate(() => {
        // 找第一个非空非编辑块的 controls，强行下移
        for (const b of document.querySelectorAll('.ws-block')) {
          const inner = b.querySelector('.ws-p,.ws-h,.ws-ul,.ws-quote,.ws-callout')
          const ctrl = b.querySelector('.ws-block-controls')
          if (ctrl && inner && (inner.textContent || '').trim() !== '' && !b.classList.contains('ws-block-editing')) {
            ctrl.style.top = '60px'
            return
          }
        }
      })
    },
  },
  {
    target: 9,
    label: 'designed/embed 块被设 contentEditable → #9 应翻红',
    async inject(page) {
      await page.evaluate(() => {
        const fake = document.createElement('div')
        fake.className = 'ws-block ws-blk-embed'
        fake.innerHTML = '<div data-block="mut-embed" contenteditable="true">x</div>'
        const blocks = document.querySelector('.ws-blocks')
        if (blocks) blocks.appendChild(fake)
      })
    },
  },
]

export async function runSelfcheck(page) {
  const results = []
  for (const m of MUTATIONS) {
    await resetPage(page)
    await m.inject(page)
    await page
      .evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))
      .catch(() => {})
    const inv = await runInvariants(page, { errors: [] })
    const targeted = inv.find((v) => v.id === m.target)
    const fired = targeted ? !targeted.ok : false
    results.push({ target: m.target, label: m.label, fired })
  }
  const dumb = results.filter((r) => !r.fired)
  return { results, allHaveTeeth: dumb.length === 0, dumb }
}
