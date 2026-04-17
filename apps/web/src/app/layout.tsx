import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@web/widgets/app-shell/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: 'Market Analysis Dashboard',
  description: 'Overview of trading history and structured market analysis.',
  manifest: '/manifest.json',
  themeColor: '#0f172a',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Market Analysis',
  },
  other: {
    'msapplication-TileColor': '#0f172a',
    'msapplication-tap-highlight': 'no',
  },
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
