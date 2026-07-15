// 文本×背景配对清单（U1 交付物，外观 dark palette 的对比度门遍历依据）。
// 每条 = 某个文本/语义 token 坐在哪个背景 token 上 + 等级；门按等级取阈值：
//   body  → ≥ 4.5:1（正文可读）
//   large → ≥ 3:1（大字/次要/语义标记）
//   exempt→ 不校验（placeholder 级 --c-text-3，亮色态本就 ~2.5:1，暗态同定位）
// 值本身不在这里：门从 rendered dark mode 的 getComputedStyle 读实际 hex，
// 这份清单只编码「谁坐在谁上面」——避免 CSS/JS 双源漂移（CSS 永远是值的正本）。
// 别做全叉积：token 表是平铺清单，哪个文本坐哪个背景没有机器可读来源，
// 全叉积必误伤（placeholder on tint 之类根本不存在的组合）。改配对先改这里。
module.exports = [
  { text: '--c-text', bg: '--c-bg', level: 'body' },
  { text: '--c-text', bg: '--c-surface', level: 'body' },
  { text: '--c-text', bg: '--c-bg-chrome', level: 'body' },
  { text: '--c-text', bg: '--c-bg-sunken', level: 'body' },
  { text: '--c-text-2', bg: '--c-bg', level: 'body' },
  { text: '--c-text-2', bg: '--c-bg-sunken', level: 'large' },
  { text: '--c-text-3', bg: '--c-bg', level: 'exempt' },
  { text: '--c-accent', bg: '--c-bg', level: 'body' }, // 链接文字
  { text: '--c-accent', bg: '--c-bg-sunken', level: 'body' },
  { text: '--c-danger', bg: '--c-bg', level: 'large' },
  { text: '--c-success', bg: '--c-bg', level: 'large' },
  { text: '--c-warning', bg: '--c-bg', level: 'large' },
  { text: '--c-text-invert', bg: '--c-ink', level: 'body' }, // 亮墨控件上的文字
];
