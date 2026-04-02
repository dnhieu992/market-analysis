import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '../components/layout/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Market Analysis Dashboard',
  description: 'Overview of trading history and structured market analysis.'
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
