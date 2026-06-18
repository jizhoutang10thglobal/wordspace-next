// ui-demo 验收审计 · MVP 场景集（v2 · U1）
// 每个 scenario = { id, label, surface, drive(page), capture(page, driveOut) }。
// drive 用真鼠标/键盘走真实命中（KTD-3：不合成事件）；capture 返回可序列化证据，
// capture.mjs 再叠 captureCommon + 截图。判定层（Workflow）读这些证据按人写期望判 make-sense。
//
// surface: 该 scenario 对应的产品期望适用面。'both' = ui-demo 与真 app 同理；
// 'ui-demo' = 仅 demo 态（如 AI「开发中」占位、导出是 mock）。判定只喂 surface∈{ui-demo,both}。

// ---- settle：受控 contentEditable / 异步浮层落定（双 rAF + 一拍），复用 v1 教训 ----
export async function settle(page) {
  await page
    .evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r(null))),
        ),
    )
    .catch(() => {})
  await page.waitForTimeout(40)
}

// ---- drive 原语 ----------------------------------------------------------

const EDIT_RE = String.raw`\bws-blk-(text|h[123]|list|quote|callout)\b`

// 当前所有块（视口坐标 + 类型 + 可编辑/空），供真鼠标命中与定位。idx = 位置（确定性）。
async function getBlocks(page) {
  return page.evaluate(
    (reSrc) => {
      const EDIT = new RegExp(reSrc)
      return [...document.querySelectorAll('.ws-block')].map((b, idx) => {
        const inner =
          b.querySelector('[data-block]') ||
          b.querySelector('.ws-hr,.ws-image,.ws-embed')
        const r = (inner || b).getBoundingClientRect()
        const text = (inner?.textContent || '').trim()
        const m = b.className.match(/ws-blk-([a-z0-9]+)/)
        return {
          idx,
          type: m ? m[1] : '?',
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          editable: EDIT.test(b.className),
          empty: text === '',
          textPreview: text.slice(0, 40),
        }
      })
    },
    EDIT_RE,
  )
}

// 点 .ws-canvas-tail → 文末进一个空可编辑正文块（编辑态），作为「插入」类场景的干净起点。
async function focusTail(page) {
  const tail = await page.$('.ws-canvas-tail')
  if (!tail) return false
  const box = await tail.boundingBox()
  if (!box) return false
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await settle(page)
  return true
}

// 在当前编辑块打 `/` 触发斜杠菜单（异步 setTimeout(0) 弹），用**键盘导航**选 label 那项。
// 不点 DOM：菜单是 fixed 定位在光标下方，文末光标会把菜单顶到视口外，.click() 会等元素进
// 视口直到超时（实测 list/quote 等低位项栽在这）。键盘 ArrowDown×idx + Enter 不受视口约束。
async function slashPick(page, label) {
  await page.keyboard.type('/', { delay: 0 })
  const menu = await page
    .waitForSelector('.ws-slashmenu', { timeout: 1500 })
    .catch(() => null)
  if (!menu) return { ok: false, reason: 'no-menu' }
  const labels = await page.$$eval('.ws-slashmenu-item', (els) =>
    els.map((e) => e.textContent.trim()),
  )
  const idx = labels.indexOf(label) // active 初始 0，ArrowDown idx 次正好落到目标
  if (idx < 0) return { ok: false, reason: 'item-not-found:' + label, labels }
  for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await settle(page)
  return { ok: true, idx }
}

// hover 第 idx 块露出 gutter，点 ⋮⋮ grip 打开块操作菜单。
async function openBlockMenu(page, idx) {
  const blks = await getBlocks(page)
  const b = blks[idx]
  if (!b) return { ok: false, reason: 'no-block' }
  await page.mouse.move(b.x + 20, b.y + Math.min(b.h / 2, 12))
  const grip = await page.evaluate((i) => {
    const el = document
      .querySelectorAll('.ws-block')
      [i]?.querySelector('.ws-block-grip')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, idx)
  if (!grip) return { ok: false, reason: 'no-grip' }
  await page.mouse.click(grip.x, grip.y)
  await page.waitForSelector('.ws-blockmenu', { timeout: 1200 }).catch(() => null)
  return { ok: true }
}

// 打开文档「···」更多菜单（DocHeader 的 .ws-doc-more .ws-icon-btn）。
async function openDocMenu(page) {
  const btn = await page.$('.ws-doc-more .ws-icon-btn')
  if (!btn) return { ok: false, reason: 'no-more-btn' }
  await btn.click()
  await page.waitForSelector('.ws-docmenu', { timeout: 1200 }).catch(() => null)
  return { ok: true }
}

// 点菜单里文本包含 text 的项（svg 图标不计入 textContent）。
async function clickMenuItem(page, sel, text) {
  const items = await page.$$(sel)
  for (const it of items) {
    const t = (await it.textContent())?.trim()
    if (t && t.includes(text)) {
      await it.click()
      await settle(page)
      return true
    }
  }
  return false
}

// ---- captureCommon：每个 scenario 都采的公共快照（块结构 / 浮层 / toast / 焦点） ----
export async function captureCommon(page) {
  return page.evaluate((reSrc) => {
    const EDIT = new RegExp(reSrc)
    const blocks = [...document.querySelectorAll('.ws-block')].map((b) => {
      const inner = b.querySelector('[data-block]')
      const m = b.className.match(/ws-blk-([a-z0-9]+)/)
      return {
        type: m ? m[1] : '?',
        editable: EDIT.test(b.className),
        editing: b.classList.contains('ws-block-editing'),
        contentEditable: !!b.querySelector('[contenteditable="true"]'),
        text: (inner?.textContent || b.textContent || '').trim().slice(0, 60),
      }
    })
    const aisoon = document.querySelector('.ws-aisoon')
    const editingEl = document.querySelector('.ws-block-editing [data-block]')
    const sel = window.getSelection()
    const caretInEditing = !!(
      editingEl &&
      sel &&
      sel.rangeCount &&
      editingEl.contains(sel.getRangeAt(0).startContainer)
    )
    return {
      blockCount: blocks.length,
      blocks,
      slashItems: [...document.querySelectorAll('.ws-slashmenu-item')].map((e) =>
        e.textContent.trim(),
      ),
      aiModal: aisoon
        ? {
            title: aisoon.querySelector('.ws-aisoon-title')?.textContent?.trim(),
            desc: aisoon.querySelector('.ws-aisoon-desc')?.textContent?.trim(),
          }
        : null,
      toasts: [...document.querySelectorAll('.ws-toast')].map((t) => ({
        tone: (t.className.match(/ws-toast-(\w+)/) || [])[1] || null,
        text: t.textContent.trim(),
      })),
      editingId: editingEl ? editingEl.getAttribute('data-block') : null,
      caretInEditing,
    }
  }, EDIT_RE)
}

// 末尾 N 块的细节（插入类场景看新块对不对）。
async function lastBlocks(page, n = 2) {
  return page.evaluate(
    ({ n, reSrc }) => {
      const EDIT = new RegExp(reSrc)
      return [...document.querySelectorAll('.ws-block')].slice(-n).map((b) => {
        const m = b.className.match(/ws-blk-([a-z0-9]+)/)
        const inner = b.querySelector('[data-block]')
        const ul = b.querySelector('.ws-ul')
        return {
          type: m ? m[1] : '?',
          editable: EDIT.test(b.className),
          editing: b.classList.contains('ws-block-editing'),
          contentEditable: !!b.querySelector('[contenteditable="true"]'),
          hasPlaceholder: !!b.querySelector('[data-placeholder]'),
          hasVisibleHr: !!b.querySelector('hr'),
          // 列表显式记 li 数：插入「列表」却得到 liCount=0 = 空列表无项目符号 bug，让判官无法漏判
          liCount: ul ? ul.querySelectorAll(':scope > li').length : null,
          html: (inner?.innerHTML ?? b.innerHTML).slice(0, 120),
          text: (inner?.textContent || b.textContent || '').trim().slice(0, 60),
        }
      })
    },
    { n, reSrc: EDIT_RE },
  )
}

// 插入类场景工厂：文末进空块 → 斜杠选 slashLabel → 看新块。
function insertScenario(id, label, slashLabel, surface = 'both') {
  return {
    id,
    surface,
    label,
    async drive(page) {
      const tail = await focusTail(page)
      const before = (await getBlocks(page)).length
      const res = await slashPick(page, slashLabel)
      return { tail, before, ...res }
    },
    async capture(page) {
      return { lastBlocks: await lastBlocks(page, 2) }
    },
  }
}

// AI 占位捕获（slash / toolbar 共用）：弹窗内容 + 文档块数是否未变。
async function captureAiModal(page, driveOut) {
  const data = await page.evaluate(() => {
    const m = document.querySelector('.ws-aisoon')
    return {
      aiModal: m
        ? {
            title: m.querySelector('.ws-aisoon-title')?.textContent?.trim(),
            desc: m.querySelector('.ws-aisoon-desc')?.textContent?.trim(),
          }
        : null,
      blockCount: document.querySelectorAll('.ws-block').length,
    }
  })
  const before = driveOut?.before ?? null
  return {
    ...data,
    blockCountBefore: before,
    docUnchanged: before != null ? data.blockCount === before : null,
  }
}

// ---- MVP 场景集 ----------------------------------------------------------

export const SCENARIOS = [
  // ① 单击即编辑手感
  {
    id: 'click-to-edit',
    surface: 'both',
    label: '单击段落中部即进入编辑，光标落在点击处附近（不被顶到块末）',
    async drive(page) {
      const blks = await getBlocks(page)
      // 选长正文段（会换行、文字铺满），点首行中部 30% 处——落点测试才有意义
      const t = blks.find((b) => b.editable && !b.empty && b.type === 'text' && b.w > 200)
      if (!t) return { reason: 'no-target' }
      const clickX = t.x + Math.min(t.w * 0.3, 120)
      const clickY = t.y + Math.min(t.h / 2, 12)
      await page.mouse.click(clickX, clickY)
      await settle(page)
      return { clickX, clickY, targetType: t.type }
    },
    async capture(page, driveOut) {
      return page.evaluate((clickX) => {
        const sel = window.getSelection()
        const editing = document.querySelector('.ws-block-editing [data-block]')
        let caretX = null
        if (sel && sel.rangeCount) {
          const r = sel.getRangeAt(0).cloneRange()
          const rects = r.getClientRects()
          const rect = rects.length
            ? rects[0]
            : r.startContainer.parentElement?.getBoundingClientRect()
          if (rect) caretX = Math.round(rect.left)
        }
        const caretInEditing = !!(
          editing &&
          sel &&
          sel.rangeCount &&
          editing.contains(sel.getRangeAt(0).startContainer)
        )
        return {
          entered: !!editing,
          contentEditable: !!document.querySelector(
            '.ws-block-editing [contenteditable="true"]',
          ),
          caretInEditing,
          clickX: clickX != null ? Math.round(clickX) : null,
          caretX,
          caretClickDeltaPx:
            clickX != null && caretX != null
              ? Math.round(Math.abs(caretX - clickX))
              : null,
        }
      }, driveOut?.clickX ?? null)
    },
  },

  // ② 插入各块类型
  insertScenario('insert-heading', '插入「标题 1」后是可编辑的一级标题', '标题 1'),
  insertScenario('insert-list', '插入「列表」后是可编辑、能加项的列表', '列表'),
  insertScenario('insert-quote', '插入「引用」后是可编辑、视觉可辨的引用块', '引用'),
  insertScenario('insert-callout', '插入「提示」后是用途清晰的提示框', '提示'),
  insertScenario('insert-divider', '插入「分隔线」后是一条可见的水平线、不可编辑', '分隔线'),

  // 斜杠菜单覆盖度（命名清楚、无误导、常用块齐）
  {
    id: 'slash-menu-coverage',
    surface: 'both',
    label: '斜杠插入菜单覆盖常用块、命名清楚、不误导（如有缺项应可解释）',
    async drive(page) {
      await focusTail(page)
      await page.keyboard.type('/', { delay: 0 })
      await page
        .waitForSelector('.ws-slashmenu', { timeout: 1200 })
        .catch(() => null)
      return {}
    },
    async capture(page) {
      return page.evaluate(() => ({
        slashItems: [...document.querySelectorAll('.ws-slashmenu-item')].map((e) =>
          e.textContent.trim(),
        ),
      }))
    },
  },

  // ③ 转块
  {
    id: 'turn-text-to-heading',
    surface: 'both',
    label: '正文块经 ⋮⋮ 菜单「转为标题」后内容保留、渲染成标题',
    async drive(page) {
      const blks = await getBlocks(page)
      const idx = blks.findIndex((b) => b.type === 'text' && !b.empty)
      if (idx < 0) return { reason: 'no-text-block' }
      const before = blks[idx].textPreview
      await openBlockMenu(page, idx)
      const ok = await clickMenuItem(page, '.ws-blockmenu-item', '转为标题')
      return { idx, before, ok }
    },
    async capture(page, driveOut) {
      return page.evaluate((idx) => {
        const b = document.querySelectorAll('.ws-block')[idx]
        if (!b) return {}
        const m = b.className.match(/ws-blk-([a-z0-9]+)/)
        const inner = b.querySelector('[data-block]')
        return {
          idx,
          nowType: m ? m[1] : '?',
          text: (inner?.textContent || '').trim().slice(0, 60),
          isHeadingTag: !!b.querySelector('h1,h2,h3'),
        }
      }, driveOut?.idx ?? -1)
    },
  },

  // ④ AI 入口（slash）
  {
    id: 'ai-entry-slash',
    surface: 'ui-demo',
    label: 'AI 入口（/AI）弹出「开发中」提示、不改文档',
    async drive(page) {
      await focusTail(page)
      const before = (await getBlocks(page)).length
      const res = await slashPick(page, '✦ AI 生成（开发中）')
      return { before, ...res }
    },
    capture: captureAiModal,
  },

  // ④ AI 入口（气泡工具栏）
  {
    id: 'ai-entry-toolbar',
    surface: 'ui-demo',
    label: 'AI 入口（选中文字后气泡 AI 按钮）弹「开发中」、不改文档',
    async drive(page) {
      const blks = await getBlocks(page)
      const t = blks.find((b) => b.editable && !b.empty && b.type === 'text' && b.w > 200)
      if (!t) return { reason: 'no-block' }
      // 先单击进编辑（contentEditable 下一帧才生效），settle 后再用键盘做选区——
      // 直接三击/双击会在「块还没可编辑」时选到非 contentEditable 元素，工具栏判不到。
      await page.mouse.click(t.x + Math.min(t.w * 0.3, 120), t.y + Math.min(t.h / 2, 12))
      await settle(page)
      await page.keyboard.press('Home')
      await page.keyboard.down('Shift')
      for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight')
      await page.keyboard.up('Shift')
      await settle(page)
      const bar = await page
        .waitForSelector('.ws-fmtbar', { timeout: 1500 })
        .catch(() => null)
      if (!bar) return { reason: 'no-toolbar' }
      const ai = await page.$('.ws-fmtbar-ai')
      if (!ai) return { reason: 'no-ai-btn' }
      const before = (await getBlocks(page)).length
      await ai.click()
      await settle(page)
      return { before }
    },
    capture: captureAiModal,
  },

  // ⑤ 导出入口
  {
    id: 'export-pdf',
    surface: 'ui-demo',
    label: '从「···」菜单导出 PDF：有进度反馈，并给出完成提示',
    async drive(page) {
      const m = await openDocMenu(page)
      if (!m.ok) return m
      const ok = await clickMenuItem(page, '.ws-docmenu-item', '导出为 PDF')
      await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll('.ws-toast')].some((t) =>
              /已导出/.test(t.textContent || ''),
            ),
          { timeout: 5000 },
        )
        .catch(() => null)
      return { ok }
    },
    async capture(page) {
      return page.evaluate(() => ({
        toasts: [...document.querySelectorAll('.ws-toast')].map((t) => ({
          tone: (t.className.match(/ws-toast-(\w+)/) || [])[1] || null,
          text: t.textContent.trim(),
        })),
      }))
    },
  },
]
