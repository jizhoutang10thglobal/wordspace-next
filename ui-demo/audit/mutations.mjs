// ui-demo 验收审计 · 变异注入（v2 · U4）
// 每个键 = scenario id；值 = async (page, driveOut) => void：在 drive 成功**之后**把该功能的
// 「效果」破坏掉，产出一份「功能坏掉」的证据。变异自检拿这份坏证据喂判官，断言判官**必须判
// fail**；该 fail 不 fail = 哑门。注入点在取证层（capture.mjs --mutate），测的是「判官能否判出
// 功能失效」，不是改 app（沿用 v1/CLAUDE.md 变异自检哲学，但测的是判官而非不变量）。

export const MUTATIONS = {
  // 插入列表后把刚插的块删掉 → 「插了没反应」。违反 E:insert-list（应得到可编辑带项目符号的列表）。
  'insert-list': async (page) => {
    await page.evaluate(() => {
      const blocks = document.querySelectorAll('.ws-block')
      blocks[blocks.length - 1]?.remove()
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
