const { mk, enter, caretStart, caretEnd, key, clean, where } = require('./h.js');
function show(t, ctx) { console.log('  ' + t + ' -> ' + clean(ctx.doc)); console.log('     caret: ' + where(ctx.doc) + '  | dirty=' + ctx.dirty.n + ' ckpt=' + ctx.ck.n); }

console.log('### A. 有序列表中间行剥离 -> 后段编号');
{
  const ctx = mk('<ol start="1"><li>一</li><li>二</li><li>三</li></ol>');
  const li = ctx.doc.querySelectorAll('li')[1];
  enter(ctx.doc, li); caretStart(ctx.doc, li);
  key(ctx.doc, 'Backspace');
  show('第1次退格', ctx);
}

console.log('### B. 两步剥离：第二次退格并入上一块');
{
  const ctx = mk('<p>前</p><ul><li>A</li><li>B</li><li>C</li></ul>');
  const li = ctx.doc.querySelectorAll('li')[1];
  enter(ctx.doc, li); caretStart(ctx.doc, li);
  key(ctx.doc, 'Backspace'); show('第1次', ctx);
  key(ctx.doc, 'Backspace'); show('第2次', ctx);
  key(ctx.doc, 'Backspace'); show('第3次', ctx);
  key(ctx.doc, 'Backspace'); show('第4次', ctx);
}

console.log('### C. 带嵌套子项的顶层行剥离');
{
  const ctx = mk('<ol><li>父</li><li>子父<ol><li>子一</li><li>子二</li></ol></li><li>尾</li></ol>');
  const li = ctx.doc.querySelectorAll('li')[1];
  enter(ctx.doc, li); caretStart(ctx.doc, li);
  key(ctx.doc, 'Backspace'); show('剥离带子项的行', ctx);
}

console.log('### D. 空块删除后光标落列表末项（连按）');
{
  const ctx = mk('<ul><li>A</li><li>B</li></ul><p><br></p>');
  const p = ctx.doc.querySelector('p');
  enter(ctx.doc, p); caretStart(ctx.doc, p);
  key(ctx.doc, 'Backspace'); show('第1次(删空段)', ctx);
  key(ctx.doc, 'Backspace'); show('第2次', ctx);
  key(ctx.doc, 'Backspace'); show('第3次', ctx);
}

console.log('### E. 空块删除后上一块列表末项【带子项】');
{
  const ctx = mk('<ul><li>A<ul><li>A1</li></ul></li></ul><p><br></p>');
  const p = ctx.doc.querySelector('body > p');
  enter(ctx.doc, p); caretStart(ctx.doc, p);
  key(ctx.doc, 'Backspace'); show('删空段', ctx);
}

console.log('### F. 段落并入上一列表末项（末项带子项）');
{
  const ctx = mk('<ul><li>A<ul><li>A1</li></ul></li></ul><p>段落文字</p>');
  const p = ctx.doc.querySelector('body > p');
  enter(ctx.doc, p); caretStart(ctx.doc, p);
  key(ctx.doc, 'Backspace'); show('并入', ctx);
}
