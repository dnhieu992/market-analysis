import { NextRequest } from 'next/server';

import { middleware } from './middleware';

describe('middleware', () => {
  it('redirects unauthenticated users to login', () => {
    const response = middleware(
      new NextRequest('http://localhost:3001/analysis')
    );

    expect(response.headers.get('location')).toBe('http://localhost:3001/login');
  });

  it('allows authenticated users into protected routes', () => {
    const response = middleware(
      new NextRequest('http://localhost:3001/analysis', {
        headers: {
          cookie: 'market_analysis_session=session-token'
        }
      })
    );

    expect(response.headers.get('location')).toBeNull();
  });

  it('redirects authenticated users away from login', () => {
    const response = middleware(
      new NextRequest('http://localhost:3001/login', {
        headers: {
          cookie: 'market_analysis_session=session-token'
        }
      })
    );

    expect(response.headers.get('location')).toBe('http://localhost:3001/');
  });
});
