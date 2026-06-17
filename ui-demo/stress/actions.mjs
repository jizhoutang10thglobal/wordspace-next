// 加权动作集。每个动作用 Playwright 真鼠标/键盘执行（KTD-3：走真实命中测试，不用合成事件）。
// run(page, rng) 返回一个可序列化的动作描述，进动作日志（KTD-5 可复现）。

const CHARS = 'abcdefg 你好世界 hello 123 测试'.split('')

function randText(rng, n = 3 + rng.int(6)) {
  let s = ''
  for (let i = 0; i < n; i++) s += rng.pick(CHARS)
  return s
}

// 读当前所有块的位置/类型（视口坐标），供真鼠标命中
async function getBlocks(page) {
  return page.evaluate(() => {
    const EDIT = /\bws-blk-(text|h[123]|list|quote|callout)\b/
    return [...document.querySelectorAll('.ws-block')].map((b, idx) => {
      const inner = b.querySelector('[data-block]')
      const r = (inner || b).getBoundingClientRect()
      return {
        idx, // 位置（确定性，供复现）；块 id 是随机串、不进日志
        x: r.x, y: r.y, w: r.width, h: r.height,
        editable: EDIT.test(b.className),
        cls: b.className,
      }
    })
  })
}

// 点块：真鼠标点到块首行附近（落点稳、像真人）
async function clickBlock(page, blk) {
  const x = blk.x + Math.min(blk.w / 2, 80)
  const y = blk.y + Math.min(blk.h / 2, 12)
  await page.mouse.click(x, y)
}

async function pickBlock(page, rng, { editableOnly = false } = {}) {
  const blocks = await getBlocks(page)
  const pool = editableOnly ? blocks.filter((b) => b.editable) : blocks
  if (!pool.length) return null
  return rng.pick(pool)
}

export const ACTIONS = [
  {
    name: 'type', w: 8,
    async run(page, rng) {
      const txt = randText(rng)
      await page.keyboard.type(txt, { delay: 0 })
      return { name: 'type', txt }
    },
  },
  {
    name: 'clickBlock', w: 5,
    async run(page, rng) {
      const blk = await pickBlock(page, rng)
      if (!blk) return { name: 'clickBlock', skip: 'no-blocks' }
      await clickBlock(page, blk)
      return { name: 'clickBlock', idx: blk.idx, editable: blk.editable }
    },
  },
  {
    name: 'enter', w: 4,
    async run(page) { await page.keyboard.press('Enter'); return { name: 'enter' } },
  },
  {
    name: 'shiftEnter', w: 1,
    async run(page) { await page.keyboard.press('Shift+Enter'); return { name: 'shiftEnter' } },
  },
  {
    name: 'backspace', w: 4,
    async run(page) { await page.keyboard.press('Backspace'); return { name: 'backspace' } },
  },
  {
    name: 'arrow', w: 4,
    async run(page, rng) {
      const k = rng.pick(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
      await page.keyboard.press(k)
      return { name: 'arrow', k }
    },
  },
  {
    name: 'escape', w: 1,
    async run(page) { await page.keyboard.press('Escape'); return { name: 'escape' } },
  },
  {
    name: 'slashInsert', w: 3,
    async run(page, rng) {
      // 在当前编辑块打 `/` 触发菜单，下移随机次再 Enter 选一项
      await page.keyboard.type('/', { delay: 0 })
      // 斜杠菜单是 setTimeout(0) 异步弹的，正经等它（KTD 竞态修复），等不到说明当前不在编辑态
      const menu = await page.waitForSelector('.ws-slashmenu', { timeout: 400 }).catch(() => null)
      if (!menu) { await page.keyboard.press('Backspace'); return { name: 'slashInsert', skip: 'no-menu' } }
      const down = rng.int(8)
      for (let i = 0; i < down; i++) await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      return { name: 'slashInsert', down }
    },
  },
  {
    name: 'blockMenu', w: 2,
    async run(page, rng) {
      const blk = await pickBlock(page, rng)
      if (!blk) return { name: 'blockMenu', skip: 'no-blocks' }
      // hover 块露出 gutter，再点 ⋮⋮
      await page.mouse.move(blk.x + 20, blk.y + Math.min(blk.h / 2, 12))
      const grip = await page.evaluate((idx) => {
        const b = document.querySelectorAll('.ws-block')[idx]
        const g = b && b.querySelector('.ws-block-grip')
        if (!g) return null
        const r = g.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }, blk.idx)
      if (!grip) return { name: 'blockMenu', skip: 'no-grip' }
      await page.mouse.click(grip.x, grip.y)
      await page.waitForSelector('.ws-blockmenu-item', { timeout: 400 }).catch(() => null)
      const items = await page.$$('.ws-blockmenu-item')
      if (!items.length) return { name: 'blockMenu', skip: 'no-menu' }
      const chosen = items[rng.int(items.length)]
      await chosen.click()
      return { name: 'blockMenu', idx: blk.idx }
    },
  },
  {
    name: 'tailClick', w: 1,
    async run(page) {
      const tail = await page.$('.ws-canvas-tail')
      if (!tail) return { name: 'tailClick', skip: 'no-tail' }
      const box = await tail.boundingBox()
      if (!box) return { name: 'tailClick', skip: 'no-box' }
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      return { name: 'tailClick' }
    },
  },
  {
    name: 'dragReorder', w: 1,
    async run(page, rng) {
      const blocks = await getBlocks(page)
      if (blocks.length < 2) return { name: 'dragReorder', skip: 'too-few' }
      const from = rng.pick(blocks)
      const to = rng.pick(blocks)
      // 抓 from 的 ⋮⋮ grip 拖到 to 的位置
      await page.mouse.move(from.x + 20, from.y + Math.min(from.h / 2, 12))
      const grip = await page.evaluate((idx) => {
        const b = document.querySelectorAll('.ws-block')[idx]
        const g = b && b.querySelector('.ws-block-grip')
        if (!g) return null
        const r = g.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }, from.idx)
      if (!grip) return { name: 'dragReorder', skip: 'no-grip' }
      await page.mouse.move(grip.x, grip.y)
      await page.mouse.down()
      await page.mouse.move(to.x + 40, to.y + to.h / 2, { steps: 6 })
      await page.mouse.up()
      return { name: 'dragReorder', from: from.idx, to: to.idx }
    },
  },
]

// 选一个加权动作并执行，返回动作描述
export async function step(page, rng) {
  const action = rng.weighted(ACTIONS)
  try {
    return await action.run(page, rng)
  } catch (e) {
    return { name: action.name, error: String(e) }
  }
}
