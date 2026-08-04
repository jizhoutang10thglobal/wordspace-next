const { mk, caretAtStartOf, key, clean } = require('./h.js');

function run(name, html, pick) {
  const { doc, dirty, ck } = mk(html);
  const target = pick(doc);
  // 进入编辑态：模拟点击进块
  const blk = target.closest('ul,ol,p,h1,h2,h3,blockquote,details') ;
  doc.getSelection().removeAllRanges();
  target.setAttribute && null;
  // enterEdit 由 mousedown/click 触发太重；直接用导出的内部不行 —— 改用 click 事件
  const md = new doc.defaultView.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
  target.dispatchEvent(md);
  const cl = new doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
  target.dispatchEvent(cl);
  caretAtStartOf(doc, target);
  const ev = key(doc, 'Backspace');
  console.log('== ' + name);
  console.log('   prevented:', ev.defaultPrevented, ' dirty:', dirty.n, ' ckpt:', ck.n);
  console.log('   after:', clean(doc));
  return { doc, ck, dirty };
}

run('E1 顶层行首退格（中间行）', '<p>前</p><ul><li>A</li><li>B</li><li>C</li></ul>', d => d.querySelectorAll('li')[1]);
run('E1 顶层行（带嵌套子项）行首退格', '<ul><li>A<ul><li>A1</li></ul></li><li>B</li></ul>', d => d.querySelectorAll('li')[0]);
run('E1 单行列表', '<p>前</p><ul><li>A</li></ul>', d => d.querySelector('li'));
