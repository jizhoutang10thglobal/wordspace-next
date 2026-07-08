// 文档标签 + 置顶的纯逻辑：同一批被跟踪文件，每条带两个标记——
//   open   = 开着（在「标签页」区，浏览器式打开记录）
//   pinned = 钉了（在「置顶」区，用户主动留的快速入口）
// 去重不变式（pinned 优先）：置顶区渲染 e.pinned；标签页区渲染 e.open && !e.pinned。
// 两者皆 false 的 entry 立即销毁（不留幽灵）。pin 不依赖 tab——可从文件树直接钉（建 open:false 的 entry）。
//
// 双模：node:test 走 module.exports；渲染层（classic script，无 require）走 window.WS2Tabs，
// 跟 editor 的 WS2Serialize/WS2BlockEdit 同款（IIFE + 双导出）。语义镜像 ui-demo/src/mock/store.ts。
//
// state = { entries: [{ rel, abs, kind, title, open, pinned }], activeRel: string|null }
// 身份键 keyOf = rel || abs：工作区内文件用相对路径 rel（无前导 /）作身份；工作区外文件（「打开」按钮选的、
// 不在当前工作区文件夹内）没有 rel，用绝对路径 abs 作身份。rel 相对、abs 绝对，二者永不相等 → 单字段
// keyOf 不跨类型撞键，且对现有 rel 标签完全向后兼容（rel 标签 abs=undefined，keyOf 恒等于 rel）。
// activeRel = 当前编辑器/查看器里那个文件的 keyOf（内部=rel、外部=abs）。
(function () {
  function keyOf(e) {
    return e.rel || e.abs;
  }
  // 第三身份类：网页标签。身份键塞进 abs（照抄 temp: 先例），前缀 'web:'。URL 是 entry 上的可变状态,
  // 导航不改身份。⚠ id 必须带时间戳（见 mkWebId）——web 条目要跨重启持久化,裸递增 seq 每次从 1 重数
  // 会与恢复条目撞键、openEntry 撞键即把两个逻辑标签合并成一个。
  var WEB_PREFIX = 'web:';
  function isWebKey(key) {
    return typeof key === 'string' && key.indexOf(WEB_PREFIX) === 0;
  }
  function isWebEntry(e) {
    return !!e && isWebKey(keyOf(e));
  }
  // 纯函数生成 web 身份键：'web:' + seq + ':' + base36(nowMs)。seq 保证同会话内唯一,时间戳保证跨重启唯一。
  function mkWebId(seq, nowMs) {
    return WEB_PREFIX + seq + ':' + Number(nowMs).toString(36);
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
  const mkEntry = ({ rel, abs, kind, title, url }, open, pinned) => {
    const e = {
      rel,
      abs,
      kind: kind || 'other',
      title: title != null ? title : rel || abs,
      open,
      pinned,
    };
    // web 条目携带当前 URL（null = 新标签页,尚未导航）；doc 条目无此字段,不污染。
    if (url !== undefined) e.url = url;
    return e;
  };

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
  // 只对工作区内（有 rel）文件触发，oldRel/newRel 都是 rel；外部 entry（key=abs）的 rel=undefined，
  // `e.rel === oldRel` 永不命中，天然不被波及。若 newRel 撞名 → 合并（open/pinned 取并集）守去重不变式。
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

  // 更新被跟踪 entry 的字段（web 导航后主进程推来 url/title 刷新用）。只 patch 命中的项,
  // 不动 open/pinned/激活态；未命中原样返回。
  function updateEntry(state, key, patch) {
    let hit = false;
    const entries = state.entries.map((e) => {
      if (keyOf(e) !== key) return e;
      hit = true;
      return { ...e, ...patch };
    });
    return hit ? { entries, activeRel: state.activeRel } : state;
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
  // 不处理。relSet = 新树所有文件 rel 的集合；inoToRel = 新树 inode(字符串)→rel 的映射。
  // 安全性：撞名（renamed-to 的路径已有标签）由 retargetEntry 的合并逻辑兜住，不会留重复项。
  function reconcileTree(state, relSet, inoToRel) {
    let s = state;
    for (const e of state.entries.filter((x) => x.rel)) {
      if (relSet.has(e.rel)) continue; // 文件还在原位
      const newRel = e.ino != null ? inoToRel.get(String(e.ino)) : undefined;
      s = newRel ? retargetEntry(s, e.rel, newRel, newRel.split('/').pop()) : removeEntry(s, e.rel);
    }
    return s;
  }

  // —— Arc 润滑①:最近关闭栈(Cmd+Shift+T 重开误关标签)。纯数据、内存态、重启即清(文件都在树里丢不了)。
  // 同 key 去重(反复关同一个只留最新一条),封顶防无限涨。
  function pushClosed(stack, entry, cap) {
    if (!entry) return stack || [];
    const key = keyOf(entry);
    const rest = (stack || []).filter((e) => keyOf(e) !== key);
    rest.unshift({ ...entry });
    return rest.slice(0, cap || 20);
  }
  function popClosed(stack) {
    const s = stack || [];
    return { entry: s[0] || null, rest: s.slice(1) };
  }

  // —— Arc 润滑③:MRU(最近使用)序,Ctrl+Tab 切换器用。激活即置顶,去重。
  function mruBump(list, key) {
    if (!key) return list || [];
    return [key, ...(list || []).filter((k) => k !== key)];
  }

  const API = {
    keyOf,
    isWebKey,
    isWebEntry,
    mkWebId,
    reconcileTree,
    openEntry,
    setActive,
    closeEntry,
    pinEntry,
    unpinEntry,
    dropEntry,
    retargetEntry,
    updateEntry,
    removeEntry,
    pinnedEntries,
    tabEntries,
    displayOrder,
    resolveActive,
    pushClosed,
    popClosed,
    mruBump,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.WS2Tabs = API;
})();
