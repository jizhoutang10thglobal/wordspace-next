// ui-demo 验收审计 · 变异注入（v2 · U4）
// 每个键 = scenario id；值 = async (page, driveOut) => void：在 drive 成功**之后**把该功能的
// 「效果」破坏掉，产出一份「功能坏掉」的证据。变异自检拿这份坏证据喂判官，断言判官**必须判
// fail**；该 fail 不 fail = 哑门。注入点在取证层（capture.mjs --mutate），测的是「判官能否判出
// 功能失效」，不是改 app（沿用 v1/CLAUDE.md 变异自检哲学，但测的是判官而非不变量）。

export const MUTATIONS = {
  // 把刚插入的（末尾）列表块就地清空成无 <li> 的空壳、留在原位 → 「插入的列表空无项目符号」。
  // 不删块：删块会让 blockCount 下降，判官分不清是「插入失败」还是「drive 复用/移走了别处列表」，
  // 证据有歧义 → 判官诚实给 unsure 而非 fail，是个弱 mutation。就地清空则明确制造「这次插入的列表
  // 就在末尾、但空无 bullet」的坏状态，归因清晰，判官能稳定判 fail。违反 E:insert-list。
  'insert-list': async (page) => {
    await page.evaluate(() => {
      const blocks = document.querySelectorAll('.ws-block')
      const inner = blocks[blocks.length - 1]?.querySelector('[data-block]')
      if (inner) inner.innerHTML = '' // 空 ul：无 li、无 bullet，仍留在末尾
    })
  },

  // 导出后抹掉所有 toast → 「点了没有任何反馈」。违反 E:export-pdf（应有进度 + 完成提示）。
  'export-pdf': async (page) => {
    await page.evaluate(() => {
      document.querySelectorAll('.ws-toast').forEach((t) => t.remove())
    })
  },

  // AI 入口「偷偷改了文档」并撤掉诚实的「开发中」弹窗 → 假装 AI 工作了。
  // 违反 E:ai-entry-slash（demo 态应只给开发中提示、绝不改文档）。
  'ai-entry-slash': async (page) => {
    await page.evaluate(() => {
      document.querySelector('.ws-aisoon-backdrop')?.remove() // 撤掉「开发中」弹窗
      const host = document.querySelector('.ws-blocks')
      if (host) {
        const fake = document.createElement('div')
        fake.className = 'ws-block ws-blk-text'
        fake.innerHTML =
          '<p class="ws-p" data-block="mut-ai">（AI 自动生成并插入的一段内容）</p>'
        host.appendChild(fake)
      }
    })
  },
}
