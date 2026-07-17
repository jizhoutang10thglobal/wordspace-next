import type { Metadata } from 'next';
import { SiteHeader } from '../components/SiteHeader';
import { SiteFooter } from '../components/SiteFooter';
import { loadChangelog, loadChangelogEn } from '../lib/changelog';
import { ChangelogView } from './ChangelogView';

export const metadata: Metadata = {
  title: '更新日志 — wordspace',
  description: 'wordspace 每个版本的新增、改进与修复，最新版本在最上。',
  alternates: { canonical: '/changelog' },
};

export default async function ChangelogPage() {
  // 双语都在构建时读死（loadChangelogEn 内含最新版本 zh/en 同步门，漏写英文构建即挂）
  const [zh, en] = await Promise.all([loadChangelog(), loadChangelogEn()]);
  return (
    <>
      <SiteHeader />
      <ChangelogView zh={zh} en={en} />
      <SiteFooter />
    </>
  );
}

// 静态化：构建时读 CHANGELOG.md / CHANGELOG.en.md 渲染死，运行时零请求（正本变更靠重新部署带上来）。
export const dynamic = 'force-static';
