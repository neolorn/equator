/**
 * Markup names that are also the names of HTML elements.
 *
 * `specs/04-message-authoring-and-catalogs.spec.md` section 8: a markup name identifies a slot and
 * nothing else. A name the portable kind registry does not hold becomes a message-local slot that
 * trusted application code has to bind, so `{#a}` is not a link, `{#script}` is not a script and
 * `{#img/}` is not an image. The built-in kind of the same spelling is the control: `strong` names
 * the registered semantic kind, which the renderer chooses its markup for.
 */
import { describe, expect, it } from 'vitest';

import { parseCatalog, parseConfiguration } from '../src/index.js';
import { analyzeCatalogSet } from '../src/semantic-model.js';

function slots(message: string) {
  const configuration = parseConfiguration(
    JSON.stringify({
      schemaVersion: 1,
      sourceLocale: 'en-US',
      defaultLocale: 'en-US',
      locales: ['en-US'],
    }),
  );
  if (!configuration.ok) throw new Error('Configuration fixture failed');
  const catalog = parseCatalog(
    `messages:\n  subject: ${JSON.stringify(message)}\n`,
    {
      role: 'source',
      providerId: '@neolorn/markup-lab',
      scopeId: 'shell',
      locale: 'en-US',
      sourcePath: 'i18n/shell/en-US.yaml',
    },
  );
  if (!catalog.ok) throw new Error(JSON.stringify(catalog.diagnostics));
  const graph = analyzeCatalogSet({
    configuration: configuration.value,
    catalogs: [catalog.value],
  });
  if (!graph.ok) throw new Error(JSON.stringify(graph.diagnostics));
  return Object.fromEntries(
    (graph.value.scopes[0]?.messages[0]?.slots ?? []).map((slot) => [
      slot.name,
      slot.kind,
    ]),
  );
}

describe('a markup name spelled like an HTML element', () => {
  it('is a message-local slot, not the element', () => {
    expect(
      slots(
        'Open {#a}the page{/a}, {#script}run{/script}, {#style}styled{/style}, {#iframe}framed{/iframe}, {#button}press{/button} {#img/}',
      ),
    ).toEqual({
      a: 'message-local',
      button: 'message-local',
      iframe: 'message-local',
      img: 'message-local',
      script: 'message-local',
      style: 'message-local',
    });
  });

  it('names a registered kind only where the registry holds that kind', () => {
    expect(slots('Read the {#strong}guide{/strong}.')).toEqual({
      strong: 'strong',
    });
  });
});
