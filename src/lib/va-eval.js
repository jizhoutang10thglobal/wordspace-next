// VA 判定的纯逻辑（不依赖 Electron / DOM / Playwright）。
// 把"采集"和"判定"分离：采集（真开 app 读 computed 颜色）在 e2e 层做，
// 判定是这里的纯函数。好处：① vitest 能单测判定逻辑；② 变异自检能给判定函数喂
// "伪造的坏快照"、断言它必判红，从而证明这道门不是恒真的哑门（裁判=运动员的元层防线）。

function normalize(str) {
  return String(str).replace(/\s+/g, '').toLowerCase();
}

// rgb/rgba 字符串 → WCAG 相对亮度(0~1)。
// 守卫两类"假上色"，都 fail-closed（抛错→判红）：
//  ① 非不透明（alpha<0.99）：CSS 全失效时 computed 背景是 rgba(0,0,0,0)，近透明 rgba(0,0,0,.004)
//     肉眼也等于没上色——别当纯黑误判成"很暗"。验收语义就是"背景真上了不透明的色"。
//  ② 解析不出数字：同时吃逗号语法 rgb(0,0,0) 和空格/斜杠语法 rgb(0 0 0 / 50%)
//     （防 Chromium 某次升级改 computed 序列化格式后整条门变 NaN）。分量 NaN 显式抛错，不静默。
function luminance(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/i);
  if (!m) throw new Error('无法解析颜色: ' + str);
  const parts = m[1].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
  const [r, g, b] = parts.slice(0, 3).map((n) => parseFloat(n));
  let a = 1;
  if (parts.length >= 4) {
    a = parseFloat(parts[3]);
    if (String(parts[3]).includes('%')) a /= 100;
  }
  if ([r, g, b].some((n) => Number.isNaN(n))) throw new Error('颜色分量解析失败（不认的语法？）: ' + str);
  if (Number.isNaN(a) || a < 0.99) throw new Error('背景非不透明（alpha<0.99，可能根本没上色）: ' + str);
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function rawAt(snapshots, state, selector) {
  const snap = snapshots[state];
  if (!snap) throw new Error(`缺状态快照: ${state}`);
  const raw = snap[selector];
  if (raw == null) throw new Error(`快照 ${state} 缺 selector ${selector}`);
  return raw;
}

// 判定一条 check。返回 { id, desc, pass, reasons:[] }。reasons 非空 = 该项红。
function evaluateCheck(snapshots, check) {
  const reasons = [];
  const { selector, metric } = check;

  for (const [state, cond] of Object.entries(check.states || {})) {
    try {
      const raw = rawAt(snapshots, state, selector);
      if (metric === 'bgLuminance') {
        const lum = luminance(raw);
        if (cond.min != null && !(lum >= cond.min)) reasons.push(`${state} 亮度 ${lum.toFixed(3)} 低于 min ${cond.min}（${raw}）`);
        if (cond.max != null && !(lum <= cond.max)) reasons.push(`${state} 亮度 ${lum.toFixed(3)} 高于 max ${cond.max}（${raw}）`);
      } else if (metric === 'bgColor') {
        if (cond.equals != null && normalize(raw) !== normalize(cond.equals)) reasons.push(`${state} 颜色 ${raw} ≠ ${cond.equals}`);
      } else {
        reasons.push(`未知 metric: ${metric}`);
      }
    } catch (e) {
      reasons.push(`${state}: ${e.message}`);
    }
  }

  for (const rel of check.relations || []) {
    const m = String(rel).match(/^(\w+)\s*([<>])\s*(\w+)$/);
    if (!m) { reasons.push(`无法解析 relation: ${rel}`); continue; }
    const [, a, op, b] = m;
    try {
      const la = luminance(rawAt(snapshots, a, selector));
      const lb = luminance(rawAt(snapshots, b, selector));
      const ok = op === '<' ? la < lb : la > lb;
      if (!ok) reasons.push(`relation 「${rel}」不成立（${a}=${la.toFixed(3)} ${b}=${lb.toFixed(3)}）`);
    } catch (e) {
      reasons.push(`relation 「${rel}」: ${e.message}`);
    }
  }

  if (Array.isArray(check.invariantAcross) && check.invariantAcross.length > 1) {
    try {
      const vals = check.invariantAcross.map((st) => normalize(rawAt(snapshots, st, selector)));
      if (!vals.every((v) => v === vals[0])) {
        reasons.push(`invariant 不成立: ${check.invariantAcross.join(' / ')} = ${check.invariantAcross.map((st) => rawAt(snapshots, st, selector)).join(' / ')}`);
      }
    } catch (e) {
      reasons.push(`invariant: ${e.message}`);
    }
  }

  return { id: check.id, desc: check.desc, pass: reasons.length === 0, reasons };
}

// 判定整份 VA。返回 { passed, results:[...] }。
function evaluateChecks(snapshots, checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    return { passed: false, results: [{ id: '(no-checks)', pass: false, reasons: ['VA 没有任何 check'] }] };
  }
  const results = checks.map((c) => evaluateCheck(snapshots, c));
  return { passed: results.every((r) => r.pass), results };
}

// 收集一份 VA 里所有 check 引用到的 selector（runner 采集时要读哪些元素）。
function selectorsOf(va) {
  return [...new Set((va.checks || []).map((c) => c.selector))];
}

// 收集所有出现过的 state 名（steps 里 snapshot 的命名）。
function statesOf(va) {
  return (va.steps || []).filter((s) => s.snapshot).map((s) => s.snapshot);
}

module.exports = { normalize, luminance, evaluateCheck, evaluateChecks, selectorsOf, statesOf };
