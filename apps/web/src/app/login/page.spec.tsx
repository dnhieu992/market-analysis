import { renderToStaticMarkup } from 'react-dom/server';

import LoginPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: jest.fn(),
    refresh: jest.fn()
  })
}));

describe('LoginPage', () => {
  it('renders the login form fields', async () => {
    const markup = renderToStaticMarkup(await LoginPage());

    expect(markup).toContain('Login to Market Analysis');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('Sign in');
  });
});
