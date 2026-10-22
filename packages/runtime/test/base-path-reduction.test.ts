import { describe, expect, it } from 'vitest';

import { withBasePath, withoutBasePath } from '@neolorn/equator/core';

/**
 * The declared base href, reduced to the sub-path it means, and taken off or put on an address.
 *
 * The reduction follows Angular's `Location`: a trailing `/index.html` goes, then one trailing
 * slash, then the origin of an absolute base. The base then comes off an address only at a segment
 * boundary, and an address under a root deployment is returned as it was given.
 */

describe('the base href reduced to a sub-path', () => {
  it('drops index.html only from the end of the base', () => {
    expect(withoutBasePath('/app/second', '/app/index.html')).toBe('/second');
    // A directory that happens to carry the name is part of the path.
    expect(withoutBasePath('/index.html/app/second', '/index.html/app')).toBe(
      '/second',
    );
    expect(withBasePath('/second', '/index.html/app')).toBe(
      '/index.html/app/second',
    );
  });

  it('reads an absolute base over either HTTP scheme as its path', () => {
    expect(withoutBasePath('/app/second', 'https://example.com/app/')).toBe(
      '/second',
    );
    expect(withoutBasePath('/app/second', 'http://example.com/app/')).toBe(
      '/second',
    );
    expect(withBasePath('/second', 'http://example.com/app/')).toBe(
      '/app/second',
    );
  });

  it('takes a base for absolute by how it begins, not by what it contains', () => {
    expect(withBasePath('/second', '/a//b')).toBe('/a//b/second');
    expect(withoutBasePath('/a//b/second', '/a//b')).toBe('/second');
  });
});

describe('putting the base on an address', () => {
  it('returns any address as it was given under a root deployment', () => {
    for (const base of ['', '/']) {
      expect(withBasePath('/second', base)).toBe('/second');
      // An absolute address is not parsed and written out again, which would respell it.
      expect(withBasePath('https://AR.site.example', base)).toBe(
        'https://AR.site.example',
      );
    }
  });

  it('mounts the path of an absolute address and keeps its origin', () => {
    expect(withBasePath('https://ar.site.example/second', '/app')).toBe(
      'https://ar.site.example/app/second',
    );
  });
});

describe('taking the base off an address', () => {
  it('returns an address that is not under the base as it was given', () => {
    expect(withoutBasePath('/abc/def', '/app')).toBe('/abc/def');
    expect(withoutBasePath('/other', '/app')).toBe('/other');
  });

  it('strips nothing under a root deployment, whatever the address is', () => {
    for (const base of ['', '/']) {
      expect(withoutBasePath('?page=2', base)).toBe('?page=2');
      expect(withoutBasePath('#top', base)).toBe('#top');
      expect(withoutBasePath('', base)).toBe('');
      expect(withoutBasePath('second', base)).toBe('second');
    }
  });

  it('matches the base only where a segment ends', () => {
    expect(withoutBasePath('/app?page=2', '/app')).toBe('/?page=2');
    expect(withoutBasePath('/app#top', '/app')).toBe('/#top');
    expect(withoutBasePath('/app;mode=full', '/app')).toBe('/;mode=full');
    // The base is four characters of a longer first segment here, and a boundary further along
    // the address does not make it one.
    expect(withoutBasePath('/application/x?page=2', '/app')).toBe(
      '/application/x?page=2',
    );
    expect(withoutBasePath('/application#top', '/app')).toBe(
      '/application#top',
    );
    expect(withoutBasePath('/apps;mode=full', '/app')).toBe('/apps;mode=full');
  });
});
