// 文档标签 + 置顶的纯逻辑：同一批被跟踪文件，每条带两个标记——
//   open   = 开着（在「标签页」区，浏览器式打开记录）
//   pinned = 钉了（在「置顶」区，用户主动留的快速入口）
// 去重不变式（pinned 优先）：置顶区渲染 e.pinned；标签页区渲染 e.open && !e.pinned。
// 两者皆 false 的 entry 立即销毁（不留幽灵）。pin 不依赖 tab——可从文件树直接钉（建 open:false 的 entry）。
//
// 双模：node:test 走 module.exports；渲染层（classic script，无 require）走 window.WS2Tabs，
// 跟 editor 的 WS2Serialize/WS2BlockEdit 同款（IIFE + 双导出）。语义镜像 ui-demo/src/mock/store.ts。
//
// state = { entries: [{ rel, kind, title, open, pinned }], activeRel: string|null }
// rel = 工作区内相对路径，作 entry 身份（去重键）。activeRel = 当前编辑器/查看器里那个文件。
(function () {
  function pinnedEntries(entries) {
    return entries.filter((e) => e.pinned);
  }
  function tabEntries(entries) {
    return entries.filter((e) => e.open && !e.pinned);
  }
  // 视觉次序：置顶在上、标签页在下。
  function displayOrder(entries) {
    return [...pinnedEntries(entries), ...tabEntries(entries)];
  }
  // 激活态回落：activeRel 仍指向一个「开着」的 entry 就保留；否则取视觉序里最后一个开着的；都没有 → null。
  // 只认 open 的项——置顶里没开过的纯快捷方式不该被自动激活/载入。
  function resolveActive(entries, activeRel) {
    if (activeRel && entries.some((e) => e.rel === activeRel && e.open)) return activeRel;
    const open = displayOrder(entries).filter((e) => e.open);
    return open.length ? open[open.length - 1].rel : null;
  }
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const mkEntry = ({ rel, kind, title }, open, pinned) => ({
    rel,
    kind: kind || 'other',
    title: title != null ? title : rel,
    open,
    pinned,
  });

  // 打开文件：已跟踪 → open=true（钉的状态保持）+ 激活；未跟踪 → 新建 {open:true,pinned:false} 追加 + 激活。
  function openEntry(state, file) {
    const found = state.entries.find((e) => e.rel === file.rel);
    const entries = found
      ? state.entries.map((e) => (e.rel === file.rel ? { ...e, open: true } : e))
      : [...state.entries, mkEntry(file, true, false)];
    return { entries, activeRel: file.rel };
  }

  // 只激活已跟踪的项（防把 activeRel 指到不存在的 entry）。真正的「打开+激活」走 openEntry。
  function setActive(state, rel) {
    const has = state.entries.some((e) => e.rel === rel);
    return { entries: state.entries, activeRel: has ? rel : state.activeRel };
  }

  // 关标签（× 只在标签页区）：open=false；!pinned 则销毁；关的是激活项 → 回落激活。
  function closeEntry(state, rel) {
    const entries = state.entries
      .map((e) => (e.rel === rel ? { ...e, open: false } : e))
      .filter((e) => e.open || e.pinned); // 销毁 !open && !pinned
    const seed = rel === state.activeRel ? null : state.activeRel;
    return { entries, activeRel: resolveActive(entries, seed) };
  }

  // 钉：已跟踪 → pinned=true（从标签页移进置顶）；未跟踪（树里直接钉、没开）→ 新建 {open:false,pinned:true}。
  // 不改激活态（钉是安静的留存，不抢焦点）。
  function pinEntry(state, file) {
    const found = state.entries.find((e) => e.rel === file.rel);
    const entries = found
      ? state.entries.map((e) => (e.rel === file.rel ? { ...e, pinned: true } : e))
      : [...state.entries, mkEntry(file, false, true)];
    return { entries, activeRel: state.activeRel };
  }

  // 取消钉：pinned=false；!open 则销毁（没开过的纯置顶项）；还 open → 落回标签页。
  function unpinEntry(state, rel) {
    const entries = state.entries
      .map((e) => (e.rel === rel ? { ...e, pinned: false } : e))
      .filter((e) => e.open || e.pinned);
    return { entries, activeRel: resolveActive(entries, state.activeRel) };
  }

  // 拖拽：设 pinned=toPinned + 在目标区内重排到 toIndex（夹紧边界）。跨区即 pin/unpin。
  function dropEntry(state, rel, toPinned, toIndex) {
    const cur = state.entries.find((e) => e.rel === rel);
    if (!cur) return state;
    // 拖进标签页区(toPinned=false) = 把它变成一个开着的标签（哪怕原来是没开过的纯置顶快捷方式，
    // 也应在那一区出现而不是被销毁）；拖进置顶区则 open 保持原样。
    const moved = { ...cur, pinned: !!toPinned, open: toPinned ? cur.open : true };
    const inGroup = state.entries.filter((e) => e.rel !== rel && !!e.pinned === !!toPinned);
    const others = state.entries.filter((e) => e.rel !== rel && !!e.pinned !== !!toPinned);
    inGroup.splice(clamp(toIndex, 0, inGroup.length), 0, moved);
    const entries = [...others, ...inGroup].filter((e) => e.open || e.pinned);
    return { entries, activeRel: resolveActive(entries, state.activeRel) };
  }

  // 改名/移动被跟踪文件：换 rel/title/kind，open/pinned/激活保持（补 v0.4.0「置顶文件改名后丢失」遗留坑）。
  // 若 newRel 已被另一个 entry 占用（撞名）→ 合并成一个（open/pinned 取并集），守住 rel 唯一 = 去重不变式。
  function retargetEntry(state, oldRel, newRel, newTitle, newKind) {
    const old = state.entries.find((e) => e.rel === oldRel);
    if (!old) return state;
    let entries = state.entries.map((e) =>
      e.rel === oldRel
        ? { ...e, rel: newRel, title: newTitle != null ? newTitle : e.title, kind: newKind || e.kind }
        : e,
    );
    if (entries.filter((e) => e.rel === newRel).length > 1) {
      const dupes = entries.filter((e) => e.rel === newRel);
      const merged = {
        rel: newRel,
        kind: newKind || old.kind,
        title: newTitle != null ? newTitle : old.title,
        open: dupes.some((e) => e.open),
        pinned: dupes.some((e) => e.pinned),
      };
      let placed = false;
      entries = entries
        .map((e) => {
          if (e.rel !== newRel) return e;
          if (placed) return null;
          placed = true;
          return merged;
        })
        .filter(Boolean);
    }
    const activeRel = state.activeRel === oldRel ? newRel : state.activeRel;
    return { entries, activeRel };
  }

  // 删除被跟踪文件：销毁 entry + 激活项则回落。
  function removeEntry(state, rel) {
    const entries = state.entries.filter((e) => e.rel !== rel);
    const seed = rel === state.activeRel ? null : state.activeRel;
    return { entries, activeRel: resolveActive(entries, seed) };
  }

  const API = {
    openEntry,
    setActive,
    closeEntry,
    pinEntry,
    unpinEntry,
    dropEntry,
    retargetEntry,
    removeEntry,
    pinnedEntries,
    tabEntries,
    displayOrder,
    resolveActive,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.WS2Tabs = API;
})();
