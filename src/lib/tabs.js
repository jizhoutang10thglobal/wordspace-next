// 文档标签 + 置顶的纯逻辑：同一批被跟踪文件，每条带两个标记——
//   open   = 开着（在「标签页」区，浏览器式打开记录）
//   pinned = 钉了（在「置顶」区，用户主动留的快速入口）
// 去重不变式（pinned 优先）：置顶区渲染 e.pinned；标签页区渲染 e.open && !e.pinned。
// 两者皆 false 的 entry 立即销毁（不留幽灵）。pin 不依赖 tab——可从文件树直接钉（建 open:false 的 entry）。
//
// 双模：node:test 走 module.exports；渲染层（classic script，无 require）走 window.WS2Tabs，
// 跟 editor 的 WS2Serialize/WS2BlockEdit 同款（IIFE + 双导出）。语义镜像 ui-demo/src/mock/store.ts。
//
// state = { entries: [{ rootId, rel, abs, kind, title, open, pinned }], activeRel: string|null }
// 身份键 keyOf（多根版）：工作区内文件 = `rootId:rel`（多个根里可以有相同 rel，必须带根限定才唯一）；
// 工作区外文件（「打开」按钮选的、不在任何根内）没有 rel，用绝对路径 abs 作身份。
// rootId 形如 r1/r2（见 workspace-store），abs 是绝对路径（mac 以 / 开头、win 形如 C:\…），
// 两种格式永不相等 → 单字段 keyOf 不跨类型撞键。无 rootId 的 rel entry 只在迁移途中短暂存在，
// keyOf 回落成裸 rel（迁移完成后不会出现）。
// activeRel = 当前编辑器/查看器里那个文件的 keyOf（内部=rootId:rel、外部=abs）。
(function () {
  function keyOf(e) {
    return e.rel ? (e.rootId ? e.rootId + ':' + e.rel : e.rel) : e.abs;
  }
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
    if (activeRel && entries.some((e) => keyOf(e) === activeRel && e.open)) return activeRel;
    const open = displayOrder(entries).filter((e) => e.open);
    return open.length ? keyOf(open[open.length - 1]) : null;
  }
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const mkEntry = ({ rootId, rel, abs, kind, title }, open, pinned) => ({
    rootId,
    rel,
    abs,
    kind: kind || 'other',
    title: title != null ? title : rel || abs,
    open,
    pinned,
  });

  // 打开文件：已跟踪 → open=true（钉的状态保持）+ 激活；未跟踪 → 新建 {open:true,pinned:false} 追加 + 激活。
  function openEntry(state, file) {
    const key = keyOf(file);
    const found = state.entries.find((e) => keyOf(e) === key);
    const entries = found
      ? state.entries.map((e) => (keyOf(e) === key ? { ...e, open: true } : e))
      : [...state.entries, mkEntry(file, true, false)];
    return { entries, activeRel: key };
  }

  // 只激活已跟踪的项（防把 activeRel 指到不存在的 entry）。真正的「打开+激活」走 openEntry。
  function setActive(state, key) {
    const has = state.entries.some((e) => keyOf(e) === key);
    return { entries: state.entries, activeRel: has ? key : state.activeRel };
  }

  // 关标签（× 只在标签页区）：open=false；!pinned 则销毁；关的是激活项 → 回落激活。
  function closeEntry(state, key) {
    const entries = state.entries
      .map((e) => (keyOf(e) === key ? { ...e, open: false } : e))
      .filter((e) => e.open || e.pinned); // 销毁 !open && !pinned
    const seed = key === state.activeRel ? null : state.activeRel;
    return { entries, activeRel: resolveActive(entries, seed) };
  }

  // 钉：已跟踪 → pinned=true（从标签页移进置顶）；未跟踪（树里直接钉、没开）→ 新建 {open:false,pinned:true}。
  // 不改激活态（钉是安静的留存，不抢焦点）。
  function pinEntry(state, file) {
    const key = keyOf(file);
    const found = state.entries.find((e) => keyOf(e) === key);
    const entries = found
      ? state.entries.map((e) => (keyOf(e) === key ? { ...e, pinned: true } : e))
      : [...state.entries, mkEntry(file, false, true)];
    return { entries, activeRel: state.activeRel };
  }

  // 取消钉：pinned=false；!open 则销毁（没开过的纯置顶项）；还 open → 落回标签页。
  function unpinEntry(state, key) {
    const entries = state.entries
      .map((e) => (keyOf(e) === key ? { ...e, pinned: false } : e))
      .filter((e) => e.open || e.pinned);
    return { entries, activeRel: resolveActive(entries, state.activeRel) };
  }

  // 拖拽：设 pinned=toPinned + 在目标区内重排到 toIndex（夹紧边界）。跨区即 pin/unpin。
  function dropEntry(state, key, toPinned, toIndex) {
    const cur = state.entries.find((e) => keyOf(e) === key);
    if (!cur) return state;
    // 拖进标签页区(toPinned=false) = 把它变成一个开着的标签（哪怕原来是没开过的纯置顶快捷方式，
    // 也应在那一区出现而不是被销毁）；拖进置顶区则 open 保持原样。
    const moved = { ...cur, pinned: !!toPinned, open: toPinned ? cur.open : true };
    const inGroup = state.entries.filter((e) => keyOf(e) !== key && !!e.pinned === !!toPinned);
    const others = state.entries.filter((e) => keyOf(e) !== key && !!e.pinned !== !!toPinned);
    inGroup.splice(clamp(toIndex, 0, inGroup.length), 0, moved);
    const entries = [...others, ...inGroup].filter((e) => e.open || e.pinned);
    return { entries, activeRel: resolveActive(entries, state.activeRel) };
  }

  // 改名/移动被跟踪文件：换 rel/title/kind，open/pinned/激活保持（补 v0.4.0「置顶文件改名后丢失」遗留坑）。
  // 多根版：匹配限定在 rootId 内（别的根里同 rel 的文件是不同文件，不许误伤）。外部 entry（key=abs）
  // 的 rel=undefined，永不命中，天然不被波及。若 newRel 在同根内撞名 → 合并（open/pinned 取并集）守去重不变式。
  function retargetEntry(state, rootId, oldRel, newRel, newTitle, newKind) {
    const hit = (e) => e.rootId === rootId && e.rel === oldRel;
    const old = state.entries.find(hit);
    if (!old) return state;
    const oldKey = keyOf(old);
    let entries = state.entries.map((e) =>
      hit(e)
        ? { ...e, rel: newRel, title: newTitle != null ? newTitle : e.title, kind: newKind || e.kind }
        : e,
    );
    const atNew = (e) => e.rootId === rootId && e.rel === newRel;
    if (entries.filter(atNew).length > 1) {
      const dupes = entries.filter(atNew);
      const merged = {
        rootId,
        rel: newRel,
        kind: newKind || old.kind,
        title: newTitle != null ? newTitle : old.title,
        open: dupes.some((e) => e.open),
        pinned: dupes.some((e) => e.pinned),
      };
      let placed = false;
      entries = entries
        .map((e) => {
          if (!atNew(e)) return e;
          if (placed) return null;
          placed = true;
          return merged;
        })
        .filter(Boolean);
    }
    const newKey = keyOf({ rootId, rel: newRel });
    const activeRel = state.activeRel === oldKey ? newKey : state.activeRel;
    return { entries, activeRel };
  }

  // 销毁一条 entry（按身份键 keyOf）+ 激活项则回落。按 key 删：内部传 rel、外部传 abs 都能删
  // （置顶区的 × 直接关闭就靠它）。工作区内文件删除/移动仍传 rel，外部 entry 的 key=abs≠rel、不会被误删。
  function removeEntry(state, key) {
    const entries = state.entries.filter((e) => keyOf(e) !== key);
    const seed = key === state.activeRel ? null : state.activeRel;
    return { entries, activeRel: resolveActive(entries, seed) };
  }

  // 外部磁盘变化对账（workspace 监听到增删改后调）：内部标签的文件若从新树消失，按 inode 找它的新位置——
  // 找到 = 改名/移动 → retargetEntry 跟随；找不到 = 真删了 → removeEntry。外部标签（无 rel、不在工作区树里）
  // 不处理。多根版：一次只对账一个根（watcher 事件带 rootId、树也按根读），别的根的 entries 原样跳过。
  // relSet = 该根新树所有文件 rel 的集合；inoToRel = 该根新树 inode(字符串)→rel 的映射。
  // 安全性：撞名（renamed-to 的路径已有标签）由 retargetEntry 的合并逻辑兜住，不会留重复项。
  function reconcileTree(state, rootId, relSet, inoToRel) {
    let s = state;
    for (const e of state.entries.filter((x) => x.rel && x.rootId === rootId)) {
      if (relSet.has(e.rel)) continue; // 文件还在原位
      const newRel = e.ino != null ? inoToRel.get(String(e.ino)) : undefined;
      s = newRel
        ? retargetEntry(s, rootId, e.rel, newRel, newRel.split('/').pop())
        : removeEntry(s, keyOf(e));
    }
    return s;
  }

  // 移除一个根：撤走它的全部 entries（磁盘不动），返回 { state, removed }——removed 原序保留，
  // 供「撤销移除」原样放回（undoDropRoot）。激活项若被撤走 → 回落。
  function dropRootEntries(state, rootId) {
    const removed = state.entries.filter((e) => e.rootId === rootId);
    const entries = state.entries.filter((e) => e.rootId !== rootId);
    const seed = removed.some((e) => keyOf(e) === state.activeRel) ? null : state.activeRel;
    return { state: { entries, activeRel: resolveActive(entries, seed) }, removed };
  }

  // 撤销移除根：把 dropRootEntries 撤走的 entries 追加回来（去重：期间若同 key 又被打开则保留现有），
  // activeRel 恢复为撤销前的激活项（若它已回来）。
  function undoDropRoot(state, removed, prevActive) {
    const have = new Set(state.entries.map(keyOf));
    const entries = [...state.entries, ...removed.filter((e) => !have.has(keyOf(e)))];
    const active = prevActive && entries.some((e) => keyOf(e) === prevActive && e.open) ? prevActive : state.activeRel;
    return { entries, activeRel: resolveActive(entries, active) };
  }

  // 吸收：fromRootId 的根被并入 toRootId 的根（新根是它的父目录），entries 不关闭、整体 rebase——
  // 文件还在磁盘原处，只是归属换了根、rel 前面多了父到子的前缀（prefix 形如 '子/孙'，'' 表同目录）。
  // 撞 key（新根里已有同 rel 的 entry）→ open/pinned 取并集合并。激活项跟随换 key。
  function rebaseRoot(state, fromRootId, toRootId, prefix) {
    let s = state;
    for (const e of state.entries.filter((x) => x.rel && x.rootId === fromRootId)) {
      const newRel = prefix ? prefix + '/' + e.rel : e.rel;
      const oldKey = keyOf(e);
      const target = { rootId: toRootId, rel: newRel };
      const existing = s.entries.find((x) => keyOf(x) === keyOf(target));
      let entries;
      if (existing) {
        entries = s.entries
          .map((x) => {
            if (keyOf(x) === keyOf(target)) return { ...x, open: x.open || e.open, pinned: x.pinned || e.pinned };
            if (keyOf(x) === oldKey) return null;
            return x;
          })
          .filter(Boolean);
      } else {
        entries = s.entries.map((x) => (keyOf(x) === oldKey ? { ...x, rootId: toRootId, rel: newRel } : x));
      }
      const activeRel = s.activeRel === oldKey ? keyOf(target) : s.activeRel;
      s = { entries, activeRel };
    }
    return s;
  }

  const API = {
    keyOf,
    reconcileTree,
    openEntry,
    setActive,
    closeEntry,
    pinEntry,
    unpinEntry,
    dropEntry,
    retargetEntry,
    removeEntry,
    dropRootEntries,
    undoDropRoot,
    rebaseRoot,
    pinnedEntries,
    tabEntries,
    displayOrder,
    resolveActive,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.WS2Tabs = API;
})();
