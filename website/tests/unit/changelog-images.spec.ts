import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { assertImagesOnDisk, parseChangelog } from '../../app/lib/changelog';
import { FIXTURE_CHANGELOG_MD } from '../../app/changelog/fixture/fixture-md';

// parser 是纯函数，配图的规则（路径映射 / alt 必填 / 归属 / 写错就抛）全在这层定死。
// 这里不需要浏览器也不需要 next build——渲染那半由 tests/e2e/changelog-images.spec.ts 钉。

const IMG = 'website/public/changelog/fixture-render-check.png';

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

  test('alt 为空 → 抛错（alt 同时当图注，不许省）', () => {
    expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', `![](${IMG})`].join('\n'))).toThrow(/alt/);
    expect(() => parseChangelog(['## v1.2.3 — 2026-01-01', `![   ](${IMG})`].join('\n'))).toThrow(/alt/);
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

  test('夹具本身解析得出两张图（e2e 就是拿它当渲染门的）', () => {
    const [entry] = parseChangelog(FIXTURE_CHANGELOG_MD);
    expect(entry.images).toHaveLength(1);
    expect(entry.groups[0].images).toHaveLength(1);
    for (const img of [...entry.images, ...entry.groups[0].images]) {
      expect(img.src).toBe('/changelog/fixture-render-check.png');
      expect(img.alt.length).toBeGreaterThan(0);
    }
  });
});

test.describe('assertImagesOnDisk · 构建门', () => {
  const entries = parseChangelog(FIXTURE_CHANGELOG_MD);

  test('图在盘上 → 通过', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ws-cl-img-'));
    await mkdir(path.join(dir, 'changelog'), { recursive: true });
    await writeFile(path.join(dir, 'changelog', 'fixture-render-check.png'), 'x');
    await expect(assertImagesOnDisk(entries, dir)).resolves.toBeUndefined();
  });

  test('图不在盘上 → 抛错挂构建（否则线上就是裂图、没有任何门会红）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ws-cl-img-'));
    await expect(assertImagesOnDisk(entries, dir)).rejects.toThrow(/fixture-render-check\.png/);
  });

  test('真 public 目录里夹具图确实存在（图被误删 → 这条红）', async () => {
    const publicDir = path.join(__dirname, '..', '..', 'public');
    await expect(assertImagesOnDisk(entries, publicDir)).resolves.toBeUndefined();
  });
});
