import { describe, expect, it } from 'vitest';

import {
  HOST_COMPATIBILITY_PROFILE,
  type HostVersions,
  admitHostCompatibility,
  currentHostVersions,
} from '../src/host-compatibility.js';

const supported: HostVersions = Object.freeze({
  node: '24.15.0',
  typescript: '6.0.2',
  angularCompiler: '22.0.0',
});

describe('Equator compiler-host compatibility admission', () => {
  it('admits the actual locked development host through the public contract', () => {
    const current = currentHostVersions();
    const result = admitHostCompatibility();
    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      profile: 'equator-host-compatibility/1',
      versions: current,
    });
    expect(HOST_COMPATIBILITY_PROFILE).toEqual({
      profile: 'equator-host-compatibility/1',
      node: '^22.22.3 || ^24.15.0 || ^26.0.0',
      typescript: '>=6.0.2 <6.1.0',
      angularCompiler: '>=22.0.0 <23.0.0',
    });
  });

  it.each([
    ['22.22.2', false],
    ['22.22.3', true],
    ['22.99.99', true],
    ['23.0.0', false],
    ['24.14.99', false],
    ['24.15.0', true],
    ['24.99.99', true],
    ['25.0.0', false],
    ['26.0.0-rc.1', false],
    ['26.0.0', true],
    ['26.99.99', true],
    ['27.0.0', false],
  ] as const)('checks the exact Node boundary at %s', (node, accepted) => {
    const result = admitHostCompatibility({ ...supported, node });
    expect(result.ok).toBe(accepted);
    if (!accepted) {
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'EQ1806',
          path: ['host', 'node'],
        }),
      ]);
    }
  });

  it.each([
    ['5.9.99', false],
    ['6.0.0-beta.1', false],
    ['6.0.0', false],
    ['6.0.1', false],
    ['6.0.2', true],
    ['6.0.99', true],
    ['6.1.0', false],
  ] as const)(
    'checks the exact TypeScript boundary at %s',
    (typescript, accepted) => {
      const result = admitHostCompatibility({
        ...supported,
        typescript,
      });
      expect(result.ok).toBe(accepted);
      if (!accepted) {
        expect(result.diagnostics).toEqual([
          expect.objectContaining({
            code: 'EQ1806',
            path: ['host', 'typescript'],
          }),
        ]);
      }
    },
  );

  it.each([
    ['21.99.99', false],
    ['22.0.0-next.0', false],
    ['22.0.0', true],
    ['22.99.99', true],
    ['23.0.0', false],
  ] as const)(
    'checks the exact Angular compiler boundary at %s',
    (angularCompiler, accepted) => {
      const result = admitHostCompatibility({
        ...supported,
        angularCompiler,
      });
      expect(result.ok).toBe(accepted);
      if (!accepted) {
        expect(result.diagnostics).toEqual([
          expect.objectContaining({
            code: 'EQ1806',
            path: ['host', 'angularCompiler'],
          }),
        ]);
      }
    },
  );

  it('reports every unsupported host component deterministically', () => {
    const result = admitHostCompatibility({
      node: '23.0.0',
      typescript: '6.1.0',
      angularCompiler: '23.0.0',
    });
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: 'EQ1806', path: ['host', 'node'] },
      { code: 'EQ1806', path: ['host', 'typescript'] },
      { code: 'EQ1806', path: ['host', 'angularCompiler'] },
    ]);
  });
});
