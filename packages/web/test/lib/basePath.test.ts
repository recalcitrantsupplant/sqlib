import { describe, it, expect } from 'vitest';
import { normaliseBase, withBase, withoutBase } from '../../src/lib/basePath';

describe('normaliseBase', () => {
  it('treats an unset, empty or root base as the root', () => {
    for (const base of [undefined, null, '', '  ', '/']) {
      expect(normaliseBase(base)).toBe('/');
    }
  });

  it('supplies the slashes an author leaves off', () => {
    // NUXT_APP_BASE_URL is typed into a Dockerfile or a CI variable, and Nuxt
    // is strict about the trailing slash — which is the one most often missed.
    for (const base of ['/sqlib', 'sqlib/', '/sqlib/', ' /sqlib ']) {
      expect(normaliseBase(base)).toBe('/sqlib/');
    }
  });

  it('keeps a nested base', () => {
    expect(normaliseBase('/demo/sqlib')).toBe('/demo/sqlib/');
  });
});

describe('withBase', () => {
  it('leaves every path alone at the root, which is what most deployments are', () => {
    expect(withBase('/favicon.svg', '/')).toBe('/favicon.svg');
    expect(withBase('/config.json', undefined as unknown as string)).toBe('/config.json');
  });

  it('moves a site-absolute path under the base', () => {
    expect(withBase('/favicon.svg', '/sqlib/')).toBe('/sqlib/favicon.svg');
    expect(withBase('/assets/fonts/inter.woff2', '/sqlib')).toBe('/sqlib/assets/fonts/inter.woff2');
  });

  it('does not double the separator, whichever side carries it', () => {
    expect(withBase('config.json', '/sqlib/')).toBe('/sqlib/config.json');
    expect(withBase('//config.json'.slice(1), '/sqlib/')).toBe('/sqlib/config.json');
  });

  it('leaves a URL somewhere else alone', () => {
    // A font or an icon on another origin is not this app's to move.
    expect(withBase('https://cdn.example.org/f.woff2', '/sqlib/'))
      .toBe('https://cdn.example.org/f.woff2');
    expect(withBase('//cdn.example.org/f.woff2', '/sqlib/')).toBe('//cdn.example.org/f.woff2');
  });
});

describe('withoutBase', () => {
  it('leaves every path alone at the root', () => {
    expect(withoutBase('/queries', '/')).toBe('/queries');
  });

  it('strips the base from a browser path', () => {
    expect(withoutBase('/dev-console/sqlib/queries', '/dev-console/sqlib/')).toBe('/queries');
    expect(withoutBase('/sqlib/auth/callback', '/sqlib')).toBe('/auth/callback');
  });

  it('names the base itself as the root, with or without its trailing slash', () => {
    expect(withoutBase('/sqlib/', '/sqlib/')).toBe('/');
    expect(withoutBase('/sqlib', '/sqlib/')).toBe('/');
  });

  it('leaves a path outside the base alone', () => {
    expect(withoutBase('/sqlibrary/x', '/sqlib/')).toBe('/sqlibrary/x');
  });
});
