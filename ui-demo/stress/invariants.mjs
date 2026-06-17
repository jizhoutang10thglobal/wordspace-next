// 9 条「永真不变量」（origin / 计划 KTD-2）。每条每步后跑，返回 {id, label, ok, detail}。
// 原则：保守判、宁可漏报不误报（噪门没用）；有牙与否由 U5 变异自检证明。
// 单一 page.evaluate 取一份 DOM/persist 快照，9 条都基于它判，省往返也更一致。

const GUTTER_THRESHOLD = 8 // px：⋮⋮ 中心 vs 块首行中心允许偏差（静态属性，留点行高余量）
const EMPTY_RUN_LIMIT = 8 // 连续空可编辑块上限（超了 = 疑似删不掉的空行堆积）

// 在页面里采一份快照（纯数据，可序列化）
async function snapshot(page) {
  return page.evaluate(
    ({ GT }) => {
      const EDIT = /\bws-blk-(text|h[123]|list|quote|callout)\b/
      const overlayOpen = !!document.querySelector('.ws-slashmenu, .ws-blockmenu, .ws-fmtbar, .ws-addmenu')
      const blocks = [...document.querySelectorAll('.ws-block')].map((b) => {
        const inner = b.querySelector('[data-block]')
        return {
          id: inner ? inner.getAttribute('data-block') : null,
          cls: b.className,
          editable: EDIT.test(b.className),
          empty: inner ? (inner.textContent || '').trim() === '' : false,
          editing: b.classList.contains('ws-block-editing'),
          // designed/embed 块是否被错误置为可编辑
          embedEditable:
            (b.className.includes('ws-blk-embed') || b.className.includes('ws-blk-image') || b.className.includes('ws-blk-divider')) &&
            !!b.querySelector('[contenteditable="true"]'),
        }
      })
      // 类型 class 合法性
      const KNOWN = /\bws-blk-(text|h[123]|list|quote|callout|divider|image|embed)\b/
      const unknownType = blocks.filter((b) => !KNOWN.test(b.cls)).length

      // 焦点 ↔ editing
      const editingId = (() => {
        const e = document.querySelector('.ws-block-editing [data-block]')
        return e ? e.getAttribute('data-block') : null
      })()
      const ae = document.activeElement
      const focusedId = ae ? (ae.getAttribute && ae.getAttribute('data-block')) || (ae.closest && ae.closest('[data-block]') ? ae.closest('[data-block]').getAttribute('data-block') : null) : null
      const focusedIsBlock = !!(ae && ae.closest && ae.closest('[data-block]'))

      // 光标是否在 editing 块内
      let caretInEditing = true
      if (editingId) {
        const sel = window.getSelection()
        const editingEl = document.querySelector('.ws-block-editing [data-block]')
        caretInEditing = !!(sel && sel.rangeCount && editingEl && editingEl.contains(sel.getRangeAt(0).startContainer))
      }

      // 连续空可编辑块最长 run
      let maxEmptyRun = 0, cur = 0
      for (const b of blocks) {
        if (b.editable && b.empty) { cur++; maxEmptyRun = Math.max(maxEmptyRun, cur) } else cur = 0
      }

      // gutter 对齐：每块 ⋮⋮ 中心 vs 首行中心
      // gutter 对齐是静态属性：只量非编辑、非空的稳定块（空块/编辑态首行测量不稳，会噪）
      const misaligned = []
      for (const b of document.querySelectorAll('.ws-block')) {
        if (b.classList.contains('ws-block-editing')) continue
        const grip = b.querySelector('.ws-block-grip')
        const inner = b.querySelector('.ws-p,.ws-h,.ws-ul,.ws-quote,.ws-callout,.ws-hr,.ws-image,.ws-embed')
        if (!grip || !inner) continue
        if ((inner.textContent || '').trim() === '' && !inner.querySelector('img,hr')) continue
        const gr = grip.getBoundingClientRect()
        let top = null, h = null
        try { const r = document.createRange(); r.selectNodeContents(inner); const rs = r.getClientRects(); if (rs.length) { top = rs[0].top; h = rs[0].height } } catch (e) {}
        if (top == null) { const ir = inner.getBoundingClientRect(); top = ir.top; h = ir.height }
        // 有符号：>0 = 首行中心在 ⋮⋮ 下方（gutter 偏高，需把该类型 top 调大该数值）
        const signed = Math.round((top + (h || 0) / 2) - (gr.top + gr.height / 2))
        if (Math.abs(signed) > GT) misaligned.push({ cls: b.className.match(/ws-blk-\S+/)?.[0], diff: signed })
      }

      // faithful-save：读每个块 contentEditable 的 innerHTML（= updateBlockHtml 实际存盘的东西，可靠来源）。
      // 只查「编辑器 chrome 漏进存盘内容」——ui-demo 流式编辑器不写定位/尺寸样式，
      // 而 designed/seed 块合法地带 background/width/font-size 等内容样式，不能误判。
      const saveOffenders = []
      const bad = /ws-block-controls|ws-block-grip|contenteditable\s*=|data-block\s*=/i
      for (const el of document.querySelectorAll('[data-block]')) {
        const html = el.innerHTML
        if (bad.test(html)) saveOffenders.push({ id: el.getAttribute('data-block'), snippet: html.slice(0, 80) })
      }

      return {
        count: blocks.length,
        ids: blocks.map((b) => b.id).filter(Boolean),
        unknownType,
        overlayOpen,
        editingId, focusedId, focusedIsBlock, caretInEditing,
        embedEditable: blocks.some((b) => b.embedEditable),
        maxEmptyRun,
        misaligned,
        saveOffenders,
      }
    },
    { GT: GUTTER_THRESHOLD },
  )
}

export async function runInvariants(page, ctx) {
  const s = await snapshot(page)
  const dupIds = s.ids.length - new Set(s.ids).size
  const out = []
  const add = (id, label, ok, detail) => out.push({ id, label, ok, detail })

  add(1, '无未捕获 JS 错 / console.error', ctx.errors.length === 0, ctx.errors.slice(-3))
  add(2, '块数不归零', s.count >= 1, { count: s.count })
  add(3, '无重复 block id + 类型合法', dupIds === 0 && s.unknownType === 0, { dupIds, unknownType: s.unknownType })
  // ④ 仅在有 editing 块、无浮层、且焦点明确落在「另一个块」时判 desync（保守，避开过渡态/浮层夺焦）
  add(
    4,
    'editingId ↔ DOM 焦点同步',
    !(s.editingId && !s.overlayOpen && s.focusedIsBlock && s.focusedId !== s.editingId),
    { editingId: s.editingId, focusedId: s.focusedId, overlayOpen: s.overlayOpen },
  )
  // ⑤ 块被聚焦(focusedId===editingId)却光标不在其中 = genuine caret-loss（焦点落别处由 ④ 管）
  add(
    5,
    '光标在编辑块内',
    !(s.editingId && !s.overlayOpen && s.focusedId === s.editingId && !s.caretInEditing),
    { editingId: s.editingId, focusedId: s.focusedId, caretInEditing: s.caretInEditing },
  )
  add(6, '无删不掉的空行堆积', s.maxEmptyRun <= EMPTY_RUN_LIMIT, { maxEmptyRun: s.maxEmptyRun, limit: EMPTY_RUN_LIMIT })
  add(7, 'faithful-save：存盘无 UI-DOM/定位样式', s.saveOffenders.length === 0, s.saveOffenders.slice(0, 3))
  add(8, 'gutter ⋮⋮ 与首行对齐', s.misaligned.length === 0, s.misaligned.slice(0, 5))
  add(9, 'designed/不可编辑块不可 contentEditable', !s.embedEditable, { embedEditable: s.embedEditable })

  return out
}
