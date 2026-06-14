import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link href="/" className="site-header__brand" aria-label="wordspace home">
          <svg
            className="site-header__mark"
            viewBox="0 0 1024 1024"
            role="img"
            aria-hidden="true"
          >
            <rect x="190" y="80" width="644" height="880" rx="24" fill="#d9d3c4" opacity="0.5" />
            <path
              d="M 160 64 L 720 64 L 864 208 L 864 960 Q 864 976, 848 976 L 160 976 Q 144 976, 144 960 L 144 80 Q 144 64, 160 64 Z"
              fill="#faf7f0"
            />
            <path
              d="M 720 64 L 864 208 L 736 208 Q 720 208, 720 192 Z"
              fill="#e8e2d4"
            />
            <text
              x="504"
              y="620"
              fontFamily="-apple-system, 'Inter', 'Helvetica Neue', sans-serif"
              fontWeight="700"
              fontSize="300"
              textAnchor="middle"
              fill="#1e1a12"
            >
              ws
            </text>
            <rect x="200" y="880" width="620" height="16" rx="4" fill="#C9A96E" />
          </svg>
          <span>wordspace</span>
        </Link>
      </div>
    </header>
  );
}
