import { renderToStaticMarkup } from 'react-dom/server';

import { AppShell } from './app-shell';

describe('AppShell', () => {
  it('renders navigation links and highlights the active route', () => {
    const markup = renderToStaticMarkup(
      <AppShell currentPath="/trades">
        <div>Dashboard body</div>
      </AppShell>
    );

    expect(markup).toContain('Overview');
    expect(markup).toContain('Trading History');
    expect(markup).toContain('Daily Plan');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('Dashboard body');
  });

  it('renders a mobile-friendly shell structure', () => {
    const markup = renderToStaticMarkup(
      <AppShell currentPath="/">
        <div>Dashboard body</div>
      </AppShell>
    );

    expect(markup).toContain('app-shell');
    expect(markup).toContain('sidebar-nav');
    expect(markup).toContain('app-shell-content');
    expect(markup).toContain('Dashboard body');
  });
});
