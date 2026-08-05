import path from 'node:path';
import type { Metadata } from 'next';
import { SiteHeader } from '../../components/SiteHeader';
import { SiteFooter } from '../../components/SiteFooter';
import { buildEntries } from '../../lib/changelog';
import { ChangelogView } from '../ChangelogView';
import { FIXTURE_CHANGELOG_MD } from './fixture-md';

// noindex：这页是给 e2e 钉配图渲染用的夹具，不是给用户看的内容（也不进 sitemap.ts）。
export const metadata: Metadata = {
  title: '更新日志 · 配图渲染夹具 — wordspace',
  robots: { index: false, follow: false },
};

export default async function ChangelogFixturePage() {
  // 走的是跟 /changelog 一模一样的 parser + 构建门 + 视图组件，只是数据换成固定夹具：
  // 门测到的就是真实渲染路径，不是另写一套「像那么回事」的样板。
  // 用 buildEntries 而不是裸 parseChangelog——固有尺寸（防位移的 width/height）是查盘那一趟
  // 顺手读出来的，绕开它这页就没有宽高属性，e2e 钉的就不是生产真实产出了。
  const entries = await buildEntries(FIXTURE_CHANGELOG_MD, 'fixture-md.ts', path.join(process.cwd(), 'public'));
  return (
    <>
      <SiteHeader />
      <ChangelogView zh={entries} en={entries} />
      <SiteFooter />
    </>
  );
}

export const dynamic = 'force-static';
