// 种子 PRNG（mulberry32）+ 取随机助手。harness 全程只用它，不用 Math.random（KTD-5）。
// 同 seed → 同序列 → 可复现。
export function makeRng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // items: [{ w: number, ... }] → 按权重 w 选一项
    weighted: (items) => {
      const total = items.reduce((s, it) => s + it.w, 0)
      let r = next() * total
      for (const it of items) {
        r -= it.w
        if (r < 0) return it
      }
      return items[items.length - 1]
    },
  }
}

// 没传 --seed 时随机生成一个并打印，便于复现
export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}
