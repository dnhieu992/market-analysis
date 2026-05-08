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
    href: '/skills',
    label: 'Skills',
    description: 'AI-powered analysis skills'
  }
];

function NavLink({
  currentPath,
  href,
  label,
  description
}: SidebarNavProps & NavItem): ReactNode {
  const isActive = currentPath === href;

  return (
    <Link
      className={`sidebar-nav-link${isActive ? ' is-active' : ''}`}
      href={href}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className="sidebar-nav-link-label">{label}</span>
      <span className="sidebar-nav-link-description">{description}</span>
    </Link>
  );
}

const apiClient = createApiClient();

export function SidebarNav({ currentPath }: SidebarNavProps) {
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    apiClient.fetchUserProfile().then(setUser).catch(() => setUser(null));
  }, []);

  const initials = user
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <aside className="sidebar-nav">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">MA</span>
        <div>
          <p className="sidebar-brand-eyebrow">Market Analysis</p>
          <p className="sidebar-brand-title">Dashboard</p>
        </div>
      </div>

      <nav aria-label="Primary" className="sidebar-nav-links">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} currentPath={currentPath} {...item} />
        ))}
      </nav>

      <Link href="/profile" className="sidebar-user">
        <span className="sidebar-user-avatar">{initials}</span>
        <div className="sidebar-user-info">
          <p className="sidebar-user-name">{user?.name ?? '…'}</p>
          <p className="sidebar-user-email">{user?.email ?? ''}</p>
        </div>
      </Link>
    </aside>
  );
}
