'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { createApiClient } from '@web/shared/api/client';

type SidebarNavProps = Readonly<{
  currentPath: string;
}>;

type NavItem = Readonly<{
  href: string;
  label: string;
  description: string;
}>;

const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Overview',
    description: 'Dashboard summary'
  },
  {
    href: '/journal',
    label: 'Trading Journal',
    description: 'Nhật ký phân tích & cảm xúc hàng ngày + ảnh mô hình'
  },
  {
    href: '/portfolio',
    label: 'Portfolio',
    description: 'Coin holdings & PnL tracker'
  },
  {
    href: '/trades',
    label: 'Trading History',
    description: 'Manual orders'
  },
  {
    href: '/daily-plan',
    label: 'Daily Plan',
    description: 'BTC daily analysis'
  },
  {
    href: '/tracked-setups',
    label: 'Lệnh theo dõi',
    description: 'Setup từ Daily Plan · trạng thái live'
  },
  {
    href: '/strategy',
    label: 'Strategies',
    description: 'Manage trading strategies'
  },
  {
    href: '/strategy-test',
    label: 'Strategy Lab',
    description: 'Back-test trading strategies'
  },
  {
    href: '/small-cap-radar',
    label: 'Small Cap Radar',
    description: 'Daily signal scan for small-cap watchlist'
  },
  {
    href: '/meme-radar',
    label: 'Meme Radar',
    description: 'Daily signal scan for Binance-listed meme coins'
  },
  {
    href: '/tracking-coins',
    label: 'Tracking Coins · Gom đáy',
    description: 'Gom đáy mạnh no-SL · cổng dcaScore≥50 · target x2'
  },
  {
    href: '/bitget',
    label: 'Bitget',
    description: 'Vị thế đang mở & lịch sử lệnh · uPnL, realized PnL, win rate'
  },
  {
    href: '/spot-flip',
    label: 'Spot Flip',
    description: 'Biến động, dip & ATR · máy tính TP/SL net phí'
  },
  {
    href: '/pattern-scanner',
    label: 'Pattern Scanner',
    description: 'Quét mô hình giá: 2 đáy, 2 đỉnh, vai đầu vai'
  },
  {
    href: '/ema-bounce',
    label: 'EMA Bounce Scanner',
    description: 'Quét 4h: giá giãn dưới EMA34/89/200 + StochRSI quá bán'
  },
  {
    href: '/skills',
    label: 'Skills',
    description: 'AI-powered analysis skills'
  }
];

function NavLink({
  currentPath,
  href,
  label,
  description,
  onClick
}: SidebarNavProps & NavItem & { onClick?: () => void }): ReactNode {
  const isActive = currentPath === href;

  return (
    <Link
      className={`sidebar-nav-link${isActive ? ' is-active' : ''}`}
      href={href}
      aria-current={isActive ? 'page' : undefined}
      onClick={onClick}
    >
      <span className="sidebar-nav-link-label">{label}</span>
      <span className="sidebar-nav-link-description">{description}</span>
    </Link>
  );
}

const apiClient = createApiClient();

export function SidebarNav({ currentPath }: SidebarNavProps) {
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    apiClient.fetchUserProfile().then(setUser).catch(() => setUser(null));
  }, []);

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [currentPath]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const initials = user
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  const close = () => setMobileOpen(false);

  return (
    <>
      {/* Mobile topbar — only visible on small screens via CSS */}
      <div className="mobile-topbar">
        <button
          className="hamburger-btn"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
        >
          <span />
          <span />
          <span />
        </button>
        <Link href="/" className="mobile-topbar-brand">
          <span className="sidebar-brand-mark">MA</span>
          <p className="mobile-topbar-title">Market Analysis</p>
        </Link>
      </div>

      {/* Backdrop overlay */}
      <div
        className={`sidebar-backdrop${mobileOpen ? ' is-open' : ''}`}
        onClick={close}
        aria-hidden="true"
      />

      {/* Sidebar / drawer */}
      <aside className={`sidebar-nav${mobileOpen ? ' is-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">MA</span>
          <div>
            <p className="sidebar-brand-eyebrow">Market Analysis</p>
            <p className="sidebar-brand-title">Dashboard</p>
          </div>
          {/* Close button inside drawer (mobile only) */}
          <button
            className="sidebar-close-btn"
            onClick={close}
            aria-label="Close navigation"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav aria-label="Primary" className="sidebar-nav-links">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} currentPath={currentPath} {...item} onClick={close} />
          ))}
        </nav>

        <Link href="/profile" className="sidebar-user" onClick={close}>
          <span className="sidebar-user-avatar">{initials}</span>
          <div className="sidebar-user-info">
            <p className="sidebar-user-name">{user?.name ?? '…'}</p>
            <p className="sidebar-user-email">{user?.email ?? ''}</p>
          </div>
        </Link>
      </aside>
    </>
  );
}
