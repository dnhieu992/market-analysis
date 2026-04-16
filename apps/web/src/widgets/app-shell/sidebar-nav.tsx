import Link from 'next/link';
import type { ReactNode } from 'react';

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
    href: '/trades',
    label: 'Trading History',
    description: 'Manual orders'
  },
  {
    href: '/analysis',
    label: 'Analysis Feed',
    description: 'Worker signals'
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
    href: '/settings',
    label: 'Settings',
    description: 'Tracking symbol configuration'
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

export function SidebarNav({ currentPath }: SidebarNavProps) {
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

      <div className="sidebar-footnote">
        <span className="status-dot" />
        <p>Overview, trades, and worker analysis in one place.</p>
      </div>
    </aside>
  );
}
