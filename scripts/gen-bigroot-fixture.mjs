#!/usr/bin/env node
// 合成大树生成器（P0b 压测/CI 复用；诊断 §1 的方法）。不需要填满磁盘：250 目录 × 100 文件 = 25000 条目
// 只占 ~250MB、35 秒，就能在任何机器上模拟「家目录/桌面级」负载曲线，指标 = 条目数（不是 GB）。
//
// 用法：
//   node scripts/gen-bigroot-fixture.mjs <输出目录> [--dirs N] [--files-per M] [--depth D] [--flat K]
// 例：
//   node scripts/gen-bigroot-fixture.mjs /tmp/bigroot --dirs 250 --files-per 100      # ~25k 条目（默认）
//   node scripts/gen-bigroot-fixture.mjs /tmp/bigroot --dirs 1500 --files-per 100     # ~150k（普通根上限）
//   node scripts/gen-bigroot-fixture.mjs /tmp/bigroot --flat 200000                   # 20 万文件全塞一个目录（单目录压力）
//
// 每个 .html 是最小合法 Wordspace 文档（能被编辑器打开），文件夹按 depth 分层，方便测 lazy 逐层展开。
import fs from 'fs/promises';
import path from 'path';

function parseArgs(argv) {
  const out = { dirs: 250, filesPer: 100, depth: 2, flat: 0 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dirs') out.dirs = parseInt(argv[++i], 10);
    else if (a === '--files-per') out.filesPer = parseInt(argv[++i], 10);
    else if (a === '--depth') out.depth = parseInt(argv[++i], 10);
    else if (a === '--flat') out.flat = parseInt(argv[++i], 10);
    else rest.push(a);
  }
  out.dest = rest[0];
  return out;
}

const HTML = (title) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>合成压测文档。</p></body></html>`;

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (!opt.dest) {
    console.error('用法：node scripts/gen-bigroot-fixture.mjs <输出目录> [--dirs N] [--files-per M] [--depth D] [--flat K]');
    process.exit(1);
  }
  const root = path.resolve(opt.dest);
  await fs.mkdir(root, { recursive: true });
  const t0 = Date.now();
  let files = 0;
  let dirs = 0;

  if (opt.flat > 0) {
    // 单目录压力：K 个文件全塞进一个目录（测单层预算 / 单次 readdir 内存峰值）。
    for (let i = 0; i < opt.flat; i++) {
      await fs.writeFile(path.join(root, `f${i}.html`), HTML('文件' + i), 'utf8');
      files++;
      if (i % 20000 === 0) process.stdout.write(`\r  单目录 ${i}/${opt.flat} 文件…`);
    }
  } else {
    // 分层：dirs 个叶目录，每个 depth 层深，每叶 filesPer 个文件。批量并发写快些。
    for (let d = 0; d < opt.dirs; d++) {
      const segs = [];
      for (let lvl = 0; lvl < opt.depth; lvl++) segs.push(`层${lvl}_${(d >> (lvl * 3)) % 50}`);
      segs.push(`项目${d}`);
      const leaf = path.join(root, ...segs);
      await fs.mkdir(leaf, { recursive: true });
      dirs++;
      const batch = [];
      for (let f = 0; f < opt.filesPer; f++) batch.push(fs.writeFile(path.join(leaf, `文件${f}.html`), HTML(`d${d}f${f}`), 'utf8'));
      await Promise.all(batch);
      files += opt.filesPer;
      if (d % 100 === 0) process.stdout.write(`\r  ${d}/${opt.dirs} 目录 · ${files} 文件…`);
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  console.log(`✔ 生成完毕：${root}`);
  console.log(`  条目 ≈ ${(files + dirs).toLocaleString()}（文件 ${files.toLocaleString()} + 目录 ${dirs.toLocaleString()}） · 用时 ${secs}s`);
  console.log(`  在 app 里「添加文件夹」指向它，配 WS2_TREE_BUDGET 小值可在小 fixture 上复现 lazy 模式。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
