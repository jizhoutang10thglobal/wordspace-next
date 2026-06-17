(function (global) {
  // 纯几何，跟 Electron/DOM 解耦，可 node:test 单测。8 个手柄 + computeResize 数学。

  // 每个手柄：id、相对位置 x/y（0 左/上、.5 中、1 右/下）、axis（角双轴、边单轴）、CSS resize cursor。
  const HANDLES = [
    { id: 'nw', x: 0, y: 0, axis: 'both', cursor: 'nwse-resize' },
    { id: 'n', x: 0.5, y: 0, axis: 'y', cursor: 'ns-resize' },
    { id: 'ne', x: 1, y: 0, axis: 'both', cursor: 'nesw-resize' },
    { id: 'e', x: 1, y: 0.5, axis: 'x', cursor: 'ew-resize' },
    { id: 'se', x: 1, y: 1, axis: 'both', cursor: 'nwse-resize' },
    { id: 's', x: 0.5, y: 1, axis: 'y', cursor: 'ns-resize' },
    { id: 'sw', x: 0, y: 1, axis: 'both', cursor: 'nesw-resize' },
    { id: 'w', x: 0, y: 0.5, axis: 'x', cursor: 'ew-resize' },
  ];

  // 东边手柄(e/ne/se) +dx 加宽、西边(w/nw/sw) -dx（西边正 dx 缩）；南边(s/se/sw) +dy 加高、
  // 北边(n/ne/nw) -dy。角双轴、边中点单轴。宽高钳到 >= min（不塌成 0/负）。
  function computeResize(handle, startRect, dx, dy, opts) {
    const id = handle && handle.id ? handle.id : handle;
    const min = opts && typeof opts.min === 'number' ? opts.min : 8;
    let width = startRect.width;
    let height = startRect.height;

    if (id === 'e' || id === 'ne' || id === 'se') width = startRect.width + dx;
    else if (id === 'w' || id === 'nw' || id === 'sw') width = startRect.width - dx;

    if (id === 's' || id === 'se' || id === 'sw') height = startRect.height + dy;
    else if (id === 'n' || id === 'ne' || id === 'nw') height = startRect.height - dy;

    return { width: Math.max(min, width), height: Math.max(min, height) };
  }

  const api = { HANDLES, computeResize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WS2ResizeGeom = api;
})(typeof window !== 'undefined' ? window : globalThis);
