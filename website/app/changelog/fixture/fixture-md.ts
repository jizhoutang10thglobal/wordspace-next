/**
 * 配图渲染门的固定夹具（正本片段）。
 *
 * 为什么要一份假正本：真 CHANGELOG.md 里现在一张图都没有（图由发版时按需加），
 * 拿它当渲染门等于门是空的。而 /changelog 页是构建时读死正本的静态页，e2e 没法
 * 在运行时塞数据——所以把这段夹具喂给同一个 parser + 同一个 ChangelogView，
 * 渲染在 /changelog/fixture（noindex，不进 sitemap、站内零链接）。
 *
 * 副作用是它跟着生产一起构建：**这也是好事**——生产构建本身就成了「配图管线还活着」
 * 的冒烟证据（图丢了 / 路径映射坏了，那一页当场就是裂图）。
 *
 * 单测和 e2e 都从这里取同一份文本，别在测试里另抄一份（抄两份就会漂）。
 */
export const FIXTURE_CHANGELOG_MD = `## v9.9.9 — 2026-01-01

这是配图渲染门的夹具页，不是真的版本说明。

![版本级配图：写在任何分组之前，归这个版本（这行文字同时是图注）](website/public/changelog/fixture-render-check.png)

### 新增

- **夹具**：一条普通条目，用来对照图注与正文的排版
- **夹具**：第二条普通条目，带 \`行内代码\` 和 [链接](https://wordspace.ai)

![分组级配图：写在 ### 之下，归这个分组（这行文字同时是图注）](website/public/changelog/fixture-render-check.png)
`;
