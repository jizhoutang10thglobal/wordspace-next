// 真 app 验收审计 · 场景集（驱动真 Electron app 的 iframe 块编辑器）
// 每个 scenario = { id, surface, label, fixture?, drive(ctx), capture(ctx, driveOut) }。
// ctx = { app, page, frame }。drive 用真鼠标/键盘走真实命中（不合成事件），capture 返回可序列化证据。
// 判定层（.claude/workflows/acceptance-audit.js）读这些证据 + 同一份人写期望（specs/acceptance/
// editor.expect.md）判 make-sense。场景 id 对应 expect.md 的 E:<id>。
//
// 与 ui-demo/audit/scenarios.mjs 同构（同一份契约的两个 consumer），但 DOM 完全不同：真 app 的编辑器
// 跑在 sandbox iframe 里，块=blockRoot 顶层子元素，编辑态=[data-ws2-editing]，气泡=.ws-fmtbar，
// 斜杠=.ws-slashmenu，块菜单=.ws-blockmenu。样张 fixture 的块直接挂 body，所以外部用 body.children 枚举即可。

// 验收样张：几段可编辑块（直接挂 body），给点击/插入/转换/格式/链接/撤销场景当锚点。
export const DOC = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>验收样张</title>
<style>body{font:16px/1.75 -apple-system,"PingFang SC",system-ui,sans-serif;color:#222;max-width:760px;margin:40px auto;padding:0 24px}</style></head>
<body>
<h1 id="t">验收样张</h1>
<p id="lead">这是一段足够长的正文，用来测试单击进入编辑、光标落点、选中文字加粗、加链接等手感；文字写长一点，落点测试才有意义，换行也才正常。</p>
<p id="p1">第二段正文，作为插入、转换、撤销等场景的锚点块。</p>
<ul><li id="li1">一条已有的列表项</li></ul>
</body></html>`

// 保真专用样张：div/table/section 等结构，打开不编辑直接存盘，验证结构与零编辑器痕迹。
export const DOC_COMPLEX = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>复杂结构</title><style>.card{padding:10px;border:1px solid #ddd}</style></head>
<body><h1 id="h">复杂结构样张</h1><div id="card" class="card"><h3>卡片标题</h3><p>卡片内文</p></div>
<table id="tb"><tbody><tr><td>单元格 A</td><td>单元格 B</td></tr></tbody></table><section id="sec"><p>区块段落</p></section></body></html>`

// ---- settle：contentEditable / 浮层落定 ----
export async function settle(page) {
  await page.waitForTimeout(120)
}

const bodyEval = (frame, fn, arg) => frame.locator('body').evaluate(fn, arg)
const serialize = (page) =>
  page.evaluate(() => WS2Serialize.serializeDocument(document.getElementById('doc-frame').contentDocument))

// 当前块（样张块直接挂 body）：tag / 编辑态 / 文本 / 视口盒，供真鼠标命中与判定。
async function getBlocks(frame) {
  return bodyEval(frame, (b) => {
    const isUI = (el) => el.hasAttribute && el.hasAttribute('data-ws2-ui')
    return [...b.children]
      .filter((el) => el.nodeType === 1 && !isUI(el))
      .map((el, idx) => {
        const r = el.getBoundingClientRect()
        return {
          idx,
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          editing: el.hasAttribute('data-ws2-editing'),
          text: (el.textContent || '').trim().slice(0, 40),
          x: r.x, y: r.y, w: r.width, h: r.height,
        }
      })
  })
}

// 点编辑块进编辑态：click(id 中部) → settle。返回点击坐标供落点判定。
async function clickInto(ctx, sel) {
  const box = await ctx.frame.locator(sel).boundingBox()
  if (!box) return null
  const x = box.x + Math.min(box.width * 0.3, 120)
  const y = box.y + Math.min(box.height / 2, 12)
  await ctx.page.mouse.click(x, y)
  await settle(ctx.page)
  return { x, y }
}

// 在当前编辑块打 `/` 触发斜杠菜单，键盘导航选 label 项（菜单 fixed 可能在视口外，不点 DOM、用键盘）。
async function slashPick(ctx, label) {
  await ctx.page.keyboard.type('/', { delay: 0 })
  await ctx.frame.locator('.ws-slashmenu').waitFor({ state: 'visible', timeout: 1500 }).catch(() => {})
  const items = await ctx.frame.locator('.ws-slashmenu-item').allTextContents().catch(() => [])
  if (!items.length) return { ok: false, reason: 'no-menu' }
  const idx = items.findIndex((t) => t.trim() === label)
  if (idx < 0) return { ok: false, reason: 'item-not-found:' + label, items }
  for (let i = 0; i < idx; i++) await ctx.page.keyboard.press('ArrowDown')
  await ctx.page.keyboard.press('Enter')
  await settle(ctx.page)
  return { ok: true, idx }
}

// 选中某块全部文字 → 气泡浮现（先 click 进编辑，再 selectText 造选区，对齐 e2e 既有套路）。
async function selectBlockText(ctx, sel) {
  await ctx.frame.locator(sel).click()
  await settle(ctx.page)
  await ctx.frame.locator(sel).selectText()
  await settle(ctx.page)
}

async function fmtbarClick(ctx, title) {
  await ctx.frame.locator(`.ws-fmtbar [title="${title}"]`).click()
  await settle(ctx.page)
}

// ---- captureCommon：每个场景都采的公共快照 ----
export async function captureCommon(ctx) {
  return bodyEval(ctx.frame, (b) => {
    const doc = b.ownerDocument
    const win = doc.defaultView
    const isUI = (el) => el.hasAttribute && el.hasAttribute('data-ws2-ui')
    const blocks = [...b.children]
      .filter((el) => el.nodeType === 1 && !isUI(el))
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        editing: el.hasAttribute('data-ws2-editing'),
        selected: el.hasAttribute('data-ws2-selected'),
        isCallout: el.classList && el.classList.contains('ws-callout'),
        text: (el.textContent || '').trim().slice(0, 50),
      }))
    const fmtbar = doc.querySelector('.ws-fmtbar')
    const slash = doc.querySelector('.ws-slashmenu')
    const editing = doc.querySelector('[data-ws2-editing]')
    const sel = doc.getSelection()
    return {
      blockCount: blocks.length,
      blocks,
      fmtbarVisible: !!fmtbar && win.getComputedStyle(fmtbar).display !== 'none',
      slashItems:
        slash && win.getComputedStyle(slash).display !== 'none'
          ? [...slash.querySelectorAll('.ws-slashmenu-item')].map((e) => e.textContent.trim())
          : [],
      editingTag: editing ? editing.tagName.toLowerCase() : null,
      editingText: editing ? (editing.textContent || '').trim().slice(0, 50) : null,
      caretInEditing: !!(
        editing && sel && sel.rangeCount && editing.contains(sel.getRangeAt(0).startContainer)
      ),
    }
  })
}

// 「这次操作产生的那个块」：插入后新块是编辑态（[data-ws2-editing]），分隔线则是选中态
// （[data-ws2-selected]）。判定必须锚在它身上——不能拿文档里预置的同类块（如样张里本就有的 <ul>）当成功证据。
async function activeBlock(frame) {
  return bodyEval(frame, () => {
    const el =
      document.querySelector('[data-ws2-editing]') || document.querySelector('[data-ws2-selected]')
    if (!el) return { none: true }
    return {
      tag: el.tagName.toLowerCase(),
      editing: el.hasAttribute('data-ws2-editing'),
      selected: el.hasAttribute('data-ws2-selected'),
      isCallout: el.classList && el.classList.contains('ws-callout'),
      liCount: el.tagName === 'UL' || el.tagName === 'OL' ? el.querySelectorAll(':scope > li').length : null,
      hasHr: el.tagName === 'HR',
      text: (el.textContent || '').trim().slice(0, 40),
      html: el.outerHTML.slice(0, 160),
    }
  })
}

// 末块细节（informational）。
async function lastBlock(frame) {
  return bodyEval(frame, (b) => {
    const isUI = (el) => el.hasAttribute && el.hasAttribute('data-ws2-ui')
    const kids = [...b.children].filter((el) => el.nodeType === 1 && !isUI(el))
    const el = kids[kids.length - 1]
    if (!el) return null
    return {
      tag: el.tagName.toLowerCase(),
      editing: el.hasAttribute('data-ws2-editing'),
      isCallout: el.classList && el.classList.contains('ws-callout'),
      liCount: el.tagName === 'UL' || el.tagName === 'OL' ? el.querySelectorAll(':scope > li').length : null,
      hasHr: el.tagName === 'HR',
      text: (el.textContent || '').trim().slice(0, 40),
      html: el.outerHTML.slice(0, 140),
    }
  })
}

// 插入类场景工厂：click 锚块进编辑 → 移到末尾 → 斜杠选 slashLabel → 看新块。
function insertScenario(id, label, slashLabel) {
  return {
    id,
    surface: 'both',
    label,
    async drive(ctx) {
      await clickInto(ctx, '#p1')
      await ctx.page.keyboard.press('End')
      const before = (await getBlocks(ctx.frame)).length
      const res = await slashPick(ctx, slashLabel)
      return { before, ...res }
    },
    async capture(ctx) {
      // inserted = 这次插入产生的块（编辑态/选中态），是判定的锚；last 仅作旁证。
      return { inserted: await activeBlock(ctx.frame), last: await lastBlock(ctx.frame) }
    },
  }
}

// ---- 场景集（surface ∈ {both} 的已建功能；planned 的 app 专属项不在此跑，判 pending）----
export const SCENARIOS = [
  // ① 单击即编辑 + 落点
  {
    id: 'click-to-edit',
    surface: 'both',
    label: '单击长正文中部即进入编辑，光标落在点击处附近（不被甩到段末、不整段框选）',
    async drive(ctx) {
      const click = await clickInto(ctx, '#lead')
      return { ...click }
    },
    async capture(ctx, driveOut) {
      return bodyEval(
        ctx.frame,
        (clickX) => {
          const doc = document
          const editing = doc.querySelector('[data-ws2-editing]')
          const sel = doc.getSelection()
          let caretX = null
          if (sel && sel.rangeCount) {
            const r = sel.getRangeAt(0).cloneRange()
            const rects = r.getClientRects()
            const rect = rects.length ? rects[0] : r.startContainer.parentElement?.getBoundingClientRect()
            if (rect) caretX = Math.round(rect.left)
          }
          return {
            entered: !!editing,
            editingTag: editing ? editing.tagName.toLowerCase() : null,
            caretInEditing: !!(editing && sel && sel.rangeCount && editing.contains(sel.getRangeAt(0).startContainer)),
            clickX: clickX != null ? Math.round(clickX) : null,
            caretX,
            caretClickDeltaPx: clickX != null && caretX != null ? Math.round(Math.abs(caretX - clickX)) : null,
          }
        },
        driveOut?.x ?? null,
      )
    },
  },

  // ② 插入各块类型
  insertScenario('insert-heading', '插入「标题 1」后是可编辑的一级标题、能立即输入', '标题 1'),
  insertScenario('insert-list', '插入「列表」后是可编辑、带项目符号、回车能分项的列表', '列表'),
  insertScenario('insert-quote', '插入「引用」后是可编辑、视觉可辨的引用块', '引用'),
  insertScenario('insert-callout', '插入「提示」后是用途清晰、视觉成框的提示块', '提示'),
  insertScenario('insert-divider', '插入「分隔线」后是一条可见水平线、本身不被当文字编辑', '分隔线'),

  // 斜杠菜单覆盖度
  {
    id: 'slash-menu-coverage',
    surface: 'both',
    label: '斜杠插入菜单覆盖常用块、命名清楚、不误导（缺常用项应可解释）',
    async drive(ctx) {
      await clickInto(ctx, '#p1')
      await ctx.page.keyboard.press('End')
      await ctx.page.keyboard.type('/', { delay: 0 })
      await settle(ctx.page)
      return {}
    },
    async capture(ctx) {
      return {
        slashItems: await ctx.frame.locator('.ws-slashmenu-item').allTextContents().catch(() => []),
      }
    },
  },

  // ③ 转块保内容
  {
    id: 'turn-text-to-heading',
    surface: 'both',
    label: '正文块「转为标题」后内容完整保留、渲染成标题、仍可编辑',
    async drive(ctx) {
      const before = await ctx.frame.locator('#p1').textContent()
      await selectBlockText(ctx, '#p1')
      await fmtbarClick(ctx, '转为')
      await ctx.frame.locator('.ws-fmtbar-menu-item', { hasText: '标题 1' }).click()
      await settle(ctx.page)
      return { before: (before || '').trim().slice(0, 40) }
    },
    async capture(ctx) {
      return bodyEval(ctx.frame, () => {
        const h = document.querySelector('#p1') // 转换原地 retag、保留 id
        return h
          ? { nowTag: h.tagName.toLowerCase(), text: (h.textContent || '').trim().slice(0, 40), isHeading: /^h[123]$/i.test(h.tagName) }
          : { gone: true }
      })
    },
  },

  // ④ 加粗（存盘保留）
  {
    id: 'format-bold',
    surface: 'both',
    label: '选中文字加粗，视觉变粗且存盘后粗体仍在内容里',
    async drive(ctx) {
      await selectBlockText(ctx, '#lead')
      await fmtbarClick(ctx, '加粗')
      const html = await serialize(ctx.page)
      return { boldInSaved: /<(b|strong)\b/i.test(html) }
    },
    async capture(ctx, driveOut) {
      const live = await bodyEval(ctx.frame, () => {
        const lead = document.querySelector('#lead')
        return { hasBoldTag: !!lead?.querySelector('b,strong'), html: lead?.innerHTML.slice(0, 140) }
      })
      return { ...live, boldInSaved: driveOut?.boldInSaved ?? null }
    },
  },

  // ⑤ 加链接（合法地址）
  {
    id: 'link-add',
    surface: 'both',
    label: '选中文字加链接、填合法地址，生成可点链接且存盘保留',
    async drive(ctx) {
      await ctx.page.evaluate(() => { window.prompt = () => 'https://example.com' })
      await selectBlockText(ctx, '#lead')
      await fmtbarClick(ctx, '链接')
      const html = await serialize(ctx.page)
      return { linkInSaved: /href=["']https:\/\/example\.com/i.test(html) }
    },
    async capture(ctx, driveOut) {
      const live = await bodyEval(ctx.frame, () => {
        const a = document.querySelector('#lead a')
        return { hasLink: !!a, href: a ? a.getAttribute('href') : null }
      })
      return { ...live, linkInSaved: driveOut?.linkInSaved ?? null }
    },
  },

  // ⑥ 危险链接被拒（安全红线）
  {
    id: 'safety-dangerous-link',
    surface: 'both',
    label: 'javascript: 等危险 scheme 链接必须被拒：不进文档、不写盘',
    async drive(ctx) {
      await ctx.page.evaluate(() => { window.prompt = () => 'javascript:alert(document.cookie)' })
      await selectBlockText(ctx, '#lead')
      await fmtbarClick(ctx, '链接')
      const html = await serialize(ctx.page)
      return { jsInSaved: /javascript:/i.test(html) }
    },
    async capture(ctx, driveOut) {
      const live = await bodyEval(ctx.frame, () => ({
        linkCount: document.querySelectorAll('#lead a').length,
      }))
      return { ...live, jsInSaved: driveOut?.jsInSaved ?? null }
    },
  },

  // ⑦ 存盘保真、零编辑器痕迹（红线）
  {
    id: 'safety-fidelity',
    surface: 'both',
    label: '打开不编辑就存盘，结构与原文一致、无 data-ws2-* 等编辑器痕迹',
    fixture: DOC_COMPLEX,
    async drive(ctx) {
      // 仅点一个不可编辑结构块（触发 attach/选中路径），不做任何文字修改，再存盘看保真。
      await ctx.frame.locator('#card').click().catch(() => {})
      await settle(ctx.page)
      const html = await serialize(ctx.page)
      return {
        hasMarkerLeak: /data-ws2-|contenteditable|ws-grip|ws-fmtbar|ws-slashmenu|ws-blockmenu/i.test(html),
        keepsStructure: /<table/i.test(html) && /class="card"/i.test(html) && /<section/i.test(html),
        savedLen: html.length,
      }
    },
    async capture(ctx, driveOut) {
      return { ...driveOut }
    },
  },

  // ⑧ 撤销干净回退
  {
    id: 'undo-restores',
    surface: 'both',
    label: '插入一个块后按一次撤销，干净回到插入前（不残留半个、不破坏其余）',
    async drive(ctx) {
      await clickInto(ctx, '#p1')
      await ctx.page.keyboard.press('End')
      const before = (await getBlocks(ctx.frame)).length
      await slashPick(ctx, '标题 1')
      const afterInsert = (await getBlocks(ctx.frame)).length
      // 撤销：Cmd/Ctrl+Z（mac/linux 通吃）
      const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
      await ctx.page.keyboard.press(`${mod}+z`)
      await settle(ctx.page)
      const afterUndo = (await getBlocks(ctx.frame)).length
      return { before, afterInsert, afterUndo, restored: afterUndo === before }
    },
    async capture(ctx, driveOut) {
      return { ...driveOut, last: await lastBlock(ctx.frame) }
    },
  },
]
