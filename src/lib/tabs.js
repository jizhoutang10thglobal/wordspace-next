// 文档标签 + 置顶的纯逻辑：同一批被跟踪文件，每条带两个标记——
//   open   = 开着（在「标签页」区，浏览器式打开记录）
//   pinned = 钉了（在「置顶」区，用户主动留的快速入口）
// 去重不变式（pinned 优先）：置顶区渲染 e.pinned；标签页区渲染 e.open && !e.pinned。
// 两者皆 false 的 entry 立即销毁（不留幽灵）。pin 不依赖 tab——可从文件树直接钉（建 open:false 的 entry）。
//
// 纯 Node（无 electron）→ node:test 直接 require（CLAUDE.md S1）。语义镜像 ui-demo/src/mock/store.ts 的
// openFileTab/closeTab/togglePin/dropTab，但加了 open/pinned 双标记 + 从树直接钉。
//
// state = { entries: [{ rel, kind, title, open, pinned }], activeRel: string|null }
// rel = 工作区内相对路径，作 entry 身份（去重键）。activeRel = 当前编辑器/查看器里那个文件。

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
// 激活态回落：activeRel 仍指向一个「开着」的 entry 就保留；否则取视觉序里最后一个开着的；都没有 → null（回空态）。
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

function setActive(state, rel) {
  return { entries: state.entries, activeRel: rel };
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
  const moved = { ...cur, pinned: !!toPinned };
  const inGroup = state.entries.filter((e) => e.rel !== rel && !!e.pinned === !!toPinned);
  const others = state.entries.filter((e) => e.rel !== rel && !!e.pinned !== !!toPinned);
  inGroup.splice(clamp(toIndex, 0, inGroup.length), 0, moved);
  const entries = [...others, ...inGroup].filter((e) => e.open || e.pinned);
  return { entries, activeRel: resolveActive(entries, state.activeRel) };
}

// 改名/移动被跟踪文件：换 rel/title/kind，open/pinned/激活保持（补 v0.4.0「置顶文件改名后丢失」遗留坑）。
function retargetEntry(state, oldRel, newRel, newTitle, newKind) {
  const entries = state.entries.map((e) =>
    e.rel === oldRel
      ? { ...e, rel: newRel, title: newTitle != null ? newTitle : e.title, kind: newKind || e.kind }
      : e,
  );
  const activeRel = state.activeRel === oldRel ? newRel : state.activeRel;
  return { entries, activeRel };
}

// 删除被跟踪文件：销毁 entry + 激活项则回落。
function removeEntry(state, rel) {
  const entries = state.entries.filter((e) => e.rel !== rel);
  const seed = rel === state.activeRel ? null : state.activeRel;
  return { entries, activeRel: resolveActive(entries, seed) };
}

module.exports = {
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
