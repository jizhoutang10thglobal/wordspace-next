import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { assertImagesOnDisk, buildEntries, parseChangelog } from '../../app/lib/changelog';
import { FIXTURE_CHANGELOG_MD } from '../../app/changelog/fixture/fixture-md';

// parser 是纯函数，配图的规则（路径映射 / alt 必填 / 归属 / 写错就抛）全在这层定死。
// 这里不需要浏览器也不需要 next build——渲染那半由 tests/e2e/changelog-images.spec.ts 钉。

const IMG = 'website/public/changelog/fixture-render-check.png';
const IMG2 = 'website/public/changelog/fixture-render-check-2.png';
const REAL_PUBLIC = path.join(__dirname, '..', '..', 'public');

test.describe('parseChangelog · 配图', () => {
  test('分组内的图片行归该分组，路径剥掉 website/public 前缀', () => {
    const [entry] = parseChangelog(
      ['## v1.2.3 — 2026-01-01', '', '### 新增', '', '- 一条条目', '', `![改颜色](${IMG})`, ''].join('\n'),
    );
    expect(entry.images).toEqual([]);
    expect(entry.groups).toHaveLength(1);
    expect(entry.groups[0].items).toHaveLength(1); // 图不占列表项
    expect(entry.groups[0].images).toEqual([
      { src: '/changelog/fixture-render-check.png', alt: '改颜色' },
    ]);
  });

  test('任何分组之前的图片行归该版本（跟在导语后面）', () => {
    const [entry] = parseChangelog(
      ['## v1.2.3 — 2026-01-01', '', '一句话导语', '', `![总览](${IMG})`, '', '### 修复', '', '- 一条条目'].join('\n'),
    );
    expect(entry.lead).toBe('一句话导语');
    expect(entry.images).toEqual([{ src: '/changelog/fixture-render-check.png', alt: '总览' }]);
    expect(entry.groups[0].images).toEqual([]);
  });

  test('图片行不再被导语抢走、也不会变成 `!alt` 噪声文本', () => {
    // 老 parser 的两种坏法：导语位的图片被吞成 lead 文本；条目里的图片被 stripInline 剥成 "!alt"
    const [entry] = parseChangelog(['## v1.2.3 — 2026-01-01', '', `![只有图没有导语](${IMG})`, ''].join('\n'));
    expect(entry.lead).toBeNull();
    expect(entry.images).toHaveLength(1);
    expect(JSON.stringify(entry)).not.toContain('!只有图没有导语');
  });

  test('同一分组里的多张图按书写顺序保留', () => {
    const [entry] = parseChangelog(
      ['## v1.2.3 — 2026-01-01', '### 新增', '- 条目', `![一](${IMG})`, `![二](${IMG})`].join('\n'),
    );
    expect(entry.groups[0].images.map((i) => i.alt)).toEqual(['一', '二']);
  });

  test('alt 里带半角 ] 也照常解析成图（正则退回 [^\\]]* 就红）', () => {
    // 血案：alt 含 ] 时 IMG_LINE 与 IMG_INLINE 双双失配 —— 图既解析不出来、又逃过守卫，
    // 三种产出全是「构建全绿地坏掉」：写在 ### 下静默消失、写在标题下变成字面 markdown 导语、
    // 写在条目里连守卫都不抛。这三条分别钉在这条和下面两条。
    const [entry] = parseChangelog(
      ['## v1.2.3 — 2026-01-01', '### 新增', '- 条目', `![多选 [Cmd+K] 一起改色](${IMG})`].join('\n'),
    );
    expect(entry.groups[0].images).toEqual([
      { src: '/changelog/fixture-render-check.png', alt: '多选 [Cmd+K] 一起改色' },
    ]);
  });

  test('alt 里带 ] 的图片行不会被吞成导语', () => {
    const [entry] = parseChangelog(['## v1.2.3 — 2026-01-01', '', `![多选 [Cmd+K] 一起改色](${IMG})`].join('\n'));
    expect(entry.lead).toBeNull();
    expect(entry.images.map((i) => i.alt)).toEqual(['多选 [Cmd+K] 一起改色']);
  });

  test('alt 里带 ] 的图片混在条目里 → 照样抛（守卫不能跟被测对象共用脆弱正则）', () => {
    expect(() =>
      parseChangelog(['## v1.2.3 — 2026-01-01', '### 新增', `- **列表**：多选后改色 ![见 [Cmd+K] 面板](${IMG})`].join('\n')),
    ).toThrow(/独立成行/);
  });

  test('图片语法本身写坏（解析不出形状）→ 抛，不许静默丢掉', () => {
    // 形状级兜底：不依赖「能不能匹配出完整图片语法」——那个前提跟被测对象是同一个正则。
    for (const bad of [`![缺右括号](${IMG}`, '![](', `![alt]${IMG})`]) {
      expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', '### 新增', '- 条目', bad].join('\n')), bad).toThrow(
        /写法不合法|独立成行|alt/,
      );
    }
  });

  test('alt 为空 → 抛错（alt 同时当图注，不许省）', () => {
    expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', `![](${IMG})`].join('\n'))).toThrow(/alt/);
    expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', `![   ](${IMG})`].join('\n'))).toThrow(/alt/);
  });

  test('alt 里带 markdown 标记 → 抛（图注不过 stripInline/splitBold，会原样显示）', () => {
    expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', `![**新** 侧栏面板](${IMG})`].join('\n'))).toThrow(
      /纯文本/,
    );
    expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', `![\`Cmd+K\` 面板](${IMG})`].join('\n'))).toThrow(/纯文本/);
  });

  test('路径不在 website/public/ 下 → 抛错（Next 只服务 public/，别处就是线上裂图）', () => {
    expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', '![图](docs/qa/assets/x.png)'].join('\n'))).toThrow(
      /website\/public/,
    );
    expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', '![图](/changelog/x.png)'].join('\n'))).toThrow(
      /website\/public/,
    );
    expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', '![图](https://example.com/x.png)'].join('\n'))).toThrow(
      /website\/public/,
    );
    // 只有前缀、没有文件名
    expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', '![图](website/public/)'].join('\n'))).toThrow(
      /website\/public/,
    );
  });

  test('路径形状不合法（// / .. / 目录 / 没扩展名）→ 抛，别指望查盘那头兜着', () => {
    // 查盘用 path.join 归一，浏览器按 URL 规则解析原串：两边不是同一个真相时，
    // 下面这几种全是「构建门 PASS + 线上裂图」——正是这道校验要挡的东西。
    const bad = [
      'website/public//changelog/fixture-render-check.png', // → <img src="//changelog/…"> 是 protocol-relative URL，会去请求外部主机
      'website/public/../../CHANGELOG.md', // → path.join 归一到仓库根真文件，门绿；浏览器归一成 /CHANGELOG.md → 404
      'website/public/./changelog/fixture-render-check.png',
      'website/public/changelog', // 漏写文件名，指向目录
      'website/public/changelog/', // 同上，带斜杠
    ];
    for (const src of bad) {
      expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', `![图](${src})`].join('\n')), src).toThrow(
        /website\/public/,
      );
    }
  });

  test('图片写进条目里 / 混在文本行里 → 抛错，不许悄悄变成 `!alt`', () => {
    expect(() =>
      parseChangelog(['## v1.2.3 — 2026-01-01', '### 新增', `- **区域**：一条条目 ![图](${IMG})`].join('\n')),
    ).toThrow(/独立成行/);
    expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', `![图](${IMG}) 说明文字`].join('\n'))).toThrow(/独立成行/);
    // 分组之后的游离文本行本来会被静默丢弃——含图片语法时也要响亮地挂，别让写错的图消失
    expect(() =>
      parseChangelog(['## v1.2.3 — 2026-01-01', '### 新增', '- 条目', `看这里 ![图](${IMG})`].join('\n')),
    ).toThrow(/独立成行/);
  });

  test('行内代码里提到图片语法 → 放行（这是正当写作，不是写错）', () => {
    const [entry] = parseChangelog(
      ['## v1.2.3 — 2026-01-01', '### 新增', '- **Markdown**：粘贴图片自动写成 `![alt](path)` 语法'].join('\n'),
    );
    expect(entry.groups[0].items[0].parts.join('')).toContain('![alt](path)');
  });

  test('没有配图的正本一切照旧（导语/备注/平铺组/粗体切段不受影响）', () => {
    const [entry] = parseChangelog(
      [
        '## v1.2.3 — 2026-01-01（补发）',
        '',
        '**一句话导语。**',
        '',
        '- **侧栏**：一条平铺条目',
        '- 第二条',
      ].join('\n'),
    );
    expect(entry.version).toBe('v1.2.3');
    expect(entry.note).toBe('补发');
    expect(entry.lead).toBe('一句话导语。');
    expect(entry.images).toEqual([]);
    expect(entry.groups).toHaveLength(1);
    expect(entry.groups[0].title).toBeNull();
    expect(entry.groups[0].images).toEqual([]);
    expect(entry.groups[0].items[0].parts).toEqual(['', '侧栏', '：一条平铺条目']);
  });

  test('夹具本身解析得出两张图、两个分组（e2e 就是拿它当渲染门的）', () => {
    const [entry] = parseChangelog(FIXTURE_CHANGELOG_MD);
    expect(entry.images.map((i) => i.src)).toEqual(['/changelog/fixture-render-check.png']);
    expect(entry.groups).toHaveLength(2);
    // 两张图必须是不同文件：同一个文件名会让「收集分组级配图」那半失去覆盖（Set 靠另一张凑齐）
    expect(entry.groups[0].images.map((i) => i.src)).toEqual(['/changelog/fixture-render-check-2.png']);
    expect(entry.groups[1].images).toEqual([]);
    for (const img of [...entry.images, ...entry.groups[0].images]) {
      expect(img.alt.length).toBeGreaterThan(0);
    }
  });
});

test.describe('assertImagesOnDisk · 构建门', () => {
  const entries = () => parseChangelog(FIXTURE_CHANGELOG_MD);

  test('图在盘上 → 通过', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ws-cl-img-'));
    await mkdir(path.join(dir, 'changelog'), { recursive: true });
    await writeFile(path.join(dir, 'changelog', 'fixture-render-check.png'), 'x');
    await writeFile(path.join(dir, 'changelog', 'fixture-render-check-2.png'), 'x');
    await expect(assertImagesOnDisk(entries(), dir, 'CHANGELOG.md')).resolves.toBeUndefined();
  });

  test('图不在盘上 → 抛错挂构建（否则线上就是裂图、没有任何门会红）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ws-cl-img-'));
    await expect(assertImagesOnDisk(entries(), dir, 'CHANGELOG.md')).rejects.toThrow(/fixture-render-check\.png/);
  });

  test('只有分组级配图缺文件 → 也要红（这半以前零覆盖：删掉收集那行 15 条单测全绿）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ws-cl-img-'));
    await mkdir(path.join(dir, 'changelog'), { recursive: true });
    const md = ['## v1.2.3 — 2026-01-01', '', '### 新增', '', '- 条目', '', `![只在分组下](${IMG})`].join('\n');
    await expect(buildEntries(md, 'CHANGELOG.md', dir)).rejects.toThrow(/fixture-render-check\.png/);
  });

  test('src 指向目录 → 也要红（access 对目录成立，光查存在性是哑门）', async () => {
    // parseImage 那头已经挡了「漏写文件名」，这里直接构造一个绕过 parser 的条目，
    // 单独钉住查盘这一层自己的判据：必须是文件，不能是目录。
    const dir = await mkdtemp(path.join(tmpdir(), 'ws-cl-img-'));
    await mkdir(path.join(dir, 'changelog', 'oops.png'), { recursive: true });
    const fake = parseChangelog(['## v1.2.3 — 2026-01-01', `![图](${IMG})`].join('\n'));
    fake[0].images[0].src = '/changelog/oops.png';
    await expect(assertImagesOnDisk(fake, dir, 'CHANGELOG.md')).rejects.toThrow(/不是文件|不存在/);
  });

  test('src 用 .. 逃出 publicDir → 也要红（path.join 会把 .. 归一掉，归一后照样查得到）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ws-cl-img-'));
    await mkdir(path.join(dir, 'public'), { recursive: true });
    await writeFile(path.join(dir, 'outside.png'), 'x'); // 在 publicDir 之外，但归一后能查到
    const fake = parseChangelog(['## v1.2.3 — 2026-01-01', `![图](${IMG})`].join('\n'));
    fake[0].images[0].src = '/../outside.png';
    await expect(assertImagesOnDisk(fake, path.join(dir, 'public'), 'CHANGELOG.md')).rejects.toThrow(/不存在|不是文件/);
  });

  test('报错指得出是哪份正本、哪个版本，且回显正本里的原始写法（能直接 grep）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ws-cl-img-'));
    const md = ['## v0.13.0 — 2026-01-01', '', '![漏了 git add 的图](website/public/changelog/0130-foo.png)'].join('\n');
    await expect(buildEntries(md, 'CHANGELOG.en.md', dir)).rejects.toThrow(
      /CHANGELOG\.en\.md v0\.13\.0 → website\/public\/changelog\/0130-foo\.png/,
    );
  });

  test('顺带读出固有尺寸写进 img（<img width/height> 没值 → 图到货把下方内容顶下去）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ws-cl-img-'));
    await mkdir(path.join(dir, 'changelog'), { recursive: true });
    for (const f of ['fixture-render-check.png', 'fixture-render-check-2.png']) {
      await copyFile(path.join(REAL_PUBLIC, 'changelog', f), path.join(dir, 'changelog', f));
    }
    const got = entries();
    await assertImagesOnDisk(got, dir, 'CHANGELOG.md');
    expect({ w: got[0].images[0].width, h: got[0].images[0].height }).toEqual({ w: 1600, h: 900 });
    expect({ w: got[0].groups[0].images[0].width, h: got[0].groups[0].images[0].height }).toEqual({ w: 1200, h: 675 });
  });

  test('真 public 目录里两张夹具图确实存在（图被误删 → 这条红）', async () => {
    await expect(assertImagesOnDisk(entries(), REAL_PUBLIC, 'CHANGELOG.md')).resolves.toBeUndefined();
  });

  test('buildEntries：给了 publicDir 就查盘，缺图直接挂', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ws-cl-img-'));
    await expect(buildEntries(FIXTURE_CHANGELOG_MD, 'CHANGELOG.md', dir)).rejects.toThrow(/配图文件不存在/);
  });

  test('buildEntries：publicDir=null（GitHub raw 回退）跳过查盘，但必须在构建日志里留痕', async () => {
    // 回退路径下 md 与磁盘不同源，硬校会拿两个版本对照 → 必须跳过。
    // 但静默跳过 = 整道门无声失效、事后没人判断得出这次部署有没有被保护，所以要 warn。
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => void warns.push(a.join(' '));
    try {
      const got = await buildEntries(FIXTURE_CHANGELOG_MD, 'CHANGELOG.md', null);
      expect(got[0].version).toBe('v9.9.9');
    } finally {
      console.warn = orig;
    }
    expect(warns.join('\n')).toMatch(/CHANGELOG\.md.*(回退|跳过)/);
  });

  test('buildEntries：解析出零条目仍然挂（原有的格式漂移门没被削弱）', async () => {
    await expect(buildEntries('# 只有个标题\n', 'CHANGELOG.md', null)).rejects.toThrow(/zero entries/);
  });
});
