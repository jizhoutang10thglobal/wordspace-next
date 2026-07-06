import type { Block } from '../types'
import { resolve } from './browser'

// 「存为文档」的剪藏内核（对齐真 app：真 app 用 Mozilla Readability 在网页里抽正文）。
// demo 里网页是我们手搓的 MockSite（React 组件，没有可跑 Readability 的真 DOM），所以这里
// 用「每个站点预置一份可读正文」来模拟同一件事：抽出标题 + 段落 → 一份可编辑的本地文档。
// 没有正文的页面（搜索页 / 真外链 iframe）判 empty → 降级成链接收藏卡片，跟真 app 口径一致。

export interface ClipResult {
  title: string
  blocks: Block[] // id 占位空串，clipToDoc 会重新发 id（同 createFromTemplate）
  empty: boolean
  note: string // toast 前缀
}

const h = (html: string, level: 1 | 2 | 3 = 1): Block => ({ id: '', type: 'heading', level, html })
const p = (html: string): Block => ({ id: '', type: 'text', html })
const callout = (html: string): Block => ({ id: '', type: 'callout', html })

const sourceLine = (url: string): Block =>
  callout(`来源：<a href="${url}">${url}</a>`)

// 每个 mock 站点预置的「正文」——模拟 Readability 抽出的干净可读文章。
const ARTICLES: Record<string, { title: string; paras: string[] }> = {
  company: {
    title: 'Tenth Global — 关于我们',
    paras: [
      'Tenth Global 是一家专注本地优先软件的团队，相信数据应该先属于用户、再谈同步。我们把编辑器、文件与发布放在同一处，不让工具把创作切成碎片。',
      '过去一年里，团队把重心放在「一份 HTML 既是文档也是网页」这件事上：你在本地写，签名公证后一键发布，中间没有导出、没有格式转换的损耗。',
      '我们是一支远程优先的小团队，横跨三个时区。招聘长期开放，尤其欢迎在意手感和细节的工程师与设计师。',
    ],
  },
  saas: {
    title: 'FlowDesk — 把团队的上下文收进一处',
    paras: [
      'FlowDesk 想解决的问题很具体：信息散落在文档、聊天和看板之间，切换成本吞掉了本该用来思考的时间。',
      'FlowDesk 把这些收进一个可搜索、可引用的工作台。每条内容都有稳定链接，AI 助手在需要时才出现，不打断你的心流。',
      '定价对小团队友好，核心功能永久免费。你可以在几分钟内导入现有文档，不需要迁移整个工作流。',
    ],
  },
  news: {
    title: '为什么「本地优先」重新流行了',
    paras: [
      '云端协作赢下了过去十年，但代价也逐渐显现：离线不可用、数据被锁在别人的服务器、每一次编辑都要往返网络。',
      '本地优先（local-first）是一组设计原则：数据先存在你的设备上，同步是增强而非前提。它把「快」和「拥有」还给用户。',
      '越来越多工具开始采纳这套思路——从笔记到设计软件。它不反对协作，只是把顺序调对了：先本地可用，再谈多人。',
      '这不是怀旧。它是对「一切都得联网」这个默认设定的一次修正。',
    ],
  },
}

/** 把当前网页地址「剪藏」成一份文档内容（标题 + 块）。有正文走文章、无正文走链接卡片。 */
export function clipPage(url: string): ClipResult {
  const r = resolve(url)
  if (r.kind === 'mock' && r.siteKey && r.siteKey !== 'search') {
    const art = ARTICLES[r.siteKey]
    if (art) {
      return {
        title: art.title,
        empty: false,
        note: '已把网页存成文档：',
        blocks: [h(art.title), sourceLine(url), ...art.paras.map((t) => p(t))],
      }
    }
  }
  // 搜索页 / 真外链 iframe / 新标签页 —— 没有可提取的正文 → 降级成链接收藏（对齐真 app 的 empty 分支）
  const title = (r.title && r.title !== '新标签页' ? r.title : url) || url
  return {
    title,
    empty: true,
    note: '这页没有正文，已存为链接收藏：',
    blocks: [
      h(title),
      callout('这个页面没有可提取的正文，已存为链接收藏。'),
      p(`来源：<a href="${url}">${url}</a>`),
    ],
  }
}
