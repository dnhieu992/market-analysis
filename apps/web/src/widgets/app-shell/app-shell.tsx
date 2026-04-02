'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { SidebarNav } from './sidebar-nav';
import { Topbar } from './topbar';

type AppShellProps = Readonly<{
  children: ReactNode;
  currentPath?: string;
}>;

export function AppShell({ children, currentPath }: AppShellProps) {
  const pathname = usePathname();
  const resolvedPath = currentPath ?? pathname ?? '/';

  return (
    <div className="app-shell">
      <SidebarNav currentPath={resolvedPath} />
      <div className="app-shell-main">
        <Topbar currentPath={resolvedPath} />
        <div className="app-shell-content">{children}</div>
      </div>
    </div>
  );
}
