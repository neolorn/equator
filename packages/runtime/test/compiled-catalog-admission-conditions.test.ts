/**
 * What a compiled catalog must be to be admitted, one condition at a time.
 *
 * `specs/05-compiled-artifacts-and-trust.spec.md` section 4 gives the order: the exact field set,
 * identity against the address, each message's structure and contracts, the resource summary
 * measured again from the content (section 7), and then the digest (section 3). Every case here is
 * sealed after its edit, so its digest and its decoded size are right for what it carries and the
 * one condition the case breaks is what refuses it. A refusal for shape is `malformed-input`; a
 * catalog whose shape is sound and whose measures or bytes are not what was recorded is an
 * `integrity-mismatch`. A consumer filtering on the reason is reading that difference.
 */
import { describe, expect, it } from 'vitest';

import { LocalizationError } from '@neolorn/equator/core';

import { RUNTIME_LIMITS } from '../src/runtime-safety.js';
import {
  PROVIDER,
  catalogKey,
  createStore,
  diagnosticOf,
  editedSet,
  loadersFor,
  rejectionOf,
  scope,
} from './catalog-store-harness.js';
import {
  admission,
  admissionFailure,
  messageOf,
  richCatalog,
  richSet,
  richStore,
  sealed,
  sealedEntry,
  type EditableCatalog,
  type EditableMessage,
} from './sealed-catalog-harness.js';

type CatalogEdit = (catalog: EditableCatalog) => void;

const MALFORMED = {
  code: 'catalog-admission-failed',
  outcome: 'operational-failure',
  reason: 'malformed-input',
  providerId: PROVIDER,
  scopeId: 'shell',
  targetLocale: 'en-US',
};

const MISMATCH = { ...MALFORMED, reason: 'integrity-mismatch' };

// A case that builds a catalog at the largest size admitted takes many times longer where the source is
// instrumented, so it carries its own bound in place of the default one.
const CEILING_CASE_MS = 300_000;

const FINGERPRINT = `sha256-${'A'.repeat(43)}`;

/** The one input of the greeting, which the source declares with a description. */
const greetingInput = (catalog: EditableCatalog): Record<string, unknown> =>
  messageOf(catalog, 'greeting').inputs[0]!;

/** The nested slot of the structured message. */
const emphasisSlot = (catalog: EditableCatalog): Record<string, unknown> => {
  const slot = messageOf(catalog, 'rich').slots.find(
    ({ name }) => name === 'em',
  );
  if (slot === undefined) throw new Error('The fixture has no em slot');
  return slot;
};

const onInput =
  (edit: (input: Record<string, unknown>) => void): CatalogEdit =>
  (catalog) =>
    edit(greetingInput(catalog));

const onSlot =
  (edit: (slot: Record<string, unknown>) => void): CatalogEdit =>
  (catalog) =>
    edit(emphasisSlot(catalog));

const onMessage =
  (messageId: string, edit: (message: EditableMessage) => void): CatalogEdit =>
  (catalog) =>
    edit(messageOf(catalog, messageId));

const onBody =
  (
    messageId: string,
    edit: (body: Record<string, unknown>) => void,
  ): CatalogEdit =>
  (catalog) =>
    edit(messageOf(catalog, messageId).body);

/** `count` more of what a message already declares, each under a name of its own. */
const more = (
  count: number,
  model: Record<string, unknown>,
): Record<string, unknown>[] =>
  Array.from({ length: count }, (_, index) => ({
    ...model,
    name: `added${index}`,
  }));

describe('the fixture these cases edit', () => {
  it('seals to what the compiler wrote when nothing is edited', () => {
    const compiled = richCatalog();
    const untouched = sealed(() => undefined);

    expect(untouched.catalog).toStrictEqual(compiled);
    expect(sealedEntry(untouched.set)).toStrictEqual(sealedEntry(richSet()));
  });

  it('is admitted as compiled, with its selection, functions, slots and empty message', async () => {
    expect(await admission(sealed(() => undefined))).toBeUndefined();
  });

  // The fixture formats a date in the context's time zone, and a store is told of none unless the
  // application configured one.
  it('is refused by a store that was not told of a context time zone', () => {
    const { set, loaders } = sealed(() => undefined);

    expect(diagnosticOf(() => createStore(set, loaders))).toMatchObject({
      code: 'invalid-configuration',
    });
  });
});

describe('a catalog whose content is sound', () => {
  it.each<[string, CatalogEdit]>([
    [
      'a boolean input',
      onInput((input) => {
        input['type'] = 'boolean';
      }),
    ],
    [
      'an input named with 128 code units',
      onInput((input) => {
        input['name'] = 'n'.repeat(128);
      }),
    ],
    [
      'an input described in 2,048 code units',
      onInput((input) => {
        input['description'] = 'd'.repeat(2_048);
      }),
    ],
    [
      'an enumeration at its bound',
      onInput((input) => {
        input['enum'] = Array.from(
          { length: RUNTIME_LIMITS.extensionOptionValues },
          (_, index) => `value-${index}`,
        );
      }),
    ],
    [
      'an enumeration of numbers and booleans',
      onInput((input) => {
        input['enum'] = [1, 2.5, true, false];
      }),
    ],
    [
      'a slot named with 128 code units',
      onSlot((slot) => {
        slot['name'] = 's'.repeat(128);
      }),
    ],
    [
      'a slot whose kind has 128 code units',
      onSlot((slot) => {
        slot['kind'] = 'k'.repeat(128);
      }),
    ],
    [
      'a slot nested within a name of 128 code units',
      onSlot((slot) => {
        slot['within'] = ['w'.repeat(128)];
      }),
    ],
    [
      'a slot nested within as many slots as a message may declare',
      onSlot((slot) => {
        slot['within'] = Array.from(
          { length: RUNTIME_LIMITS.slotsPerMessage },
          (_, index) => `outer-${index}`,
        );
      }),
    ],
    [
      'a slot that may stand anywhere',
      onSlot((slot) => {
        slot['within'] = [];
      }),
    ],
    [
      'a slot described in 2,048 code units',
      onSlot((slot) => {
        slot['description'] = 'd'.repeat(2_048);
      }),
    ],
    [
      'a message identifier of 1,024 code units',
      onMessage('title', (message) => {
        message.messageId = 'm'.repeat(1_024);
      }),
    ],
    [
      'a message declaring as many inputs as one may',
      (catalog) => {
        const greeting = messageOf(catalog, 'greeting');
        const added = RUNTIME_LIMITS.inputsPerMessage - greeting.inputs.length;
        greeting.inputs.push(...more(added, greeting.inputs[0]!));
        catalog.resources.inputs += added;
        catalog.resources.identifiers += added;
        catalog.resources.maximumMessage['inputs'] =
          RUNTIME_LIMITS.inputsPerMessage;
      },
    ],
    [
      'a message declaring as many slots as one may',
      (catalog) => {
        const rich = messageOf(catalog, 'rich');
        const added = RUNTIME_LIMITS.slotsPerMessage - rich.slots.length;
        rich.slots.push(...more(added, rich.slots[0]!));
        catalog.resources.slots += added;
        catalog.resources.identifiers += added;
        catalog.resources.maximumMessage['slots'] =
          RUNTIME_LIMITS.slotsPerMessage;
      },
    ],
  ])('is admitted with %s', async (_name, edit) => {
    expect(await admission(sealed(edit))).toBeUndefined();
  });

  // A literal is a node whatever JSON type it has, so swapping one for another leaves every count
  // where the compiler put it.
  it.each<[string, unknown]>([
    ['null', null],
    ['true', true],
    ['false', false],
    ['an integer', 42],
    ['a fraction', 0.5],
  ])('is admitted with %s as body data', async (_name, value) => {
    const edit = onBody('title', (body) => {
      body['pattern'] = [value];
    });

    expect(await admission(sealed(edit))).toBeUndefined();
  });

  // The title's body is five nodes, its literal at depth three. Each wrapper is one node and one
  // level, so 125 of them put the literal at the bound.
  const nestedToTheBound: CatalogEdit = (catalog) => {
    const wrappers = RUNTIME_LIMITS.jsonDepth - 3;
    let nested: unknown = 'Catalog store';
    for (let level = 0; level < wrappers; level += 1) nested = [nested];
    messageOf(catalog, 'title').body['pattern'] = [nested];
    catalog.resources.irNodes += wrappers;
    catalog.resources.depth = RUNTIME_LIMITS.jsonDepth;
    catalog.resources.maximumMessage['irNodes'] = 5 + wrappers;
    catalog.resources.maximumMessage['depth'] = RUNTIME_LIMITS.jsonDepth;
  };

  it('is admitted with a body nested exactly as deep as one may be', async () => {
    expect(await admission(sealed(nestedToTheBound))).toBeUndefined();
  });

  it('is kept from a transfer at the depth it is admitted at from a loader', async () => {
    const { set, loaders, catalog } = sealed(nestedToTheBound);
    const store = richStore(set, loaders);

    await store.seed(structuredClone(catalog));

    expect(store.cachedCount).toBe(1);
  });

  // The title's text is lengthened until the catalog measures exactly what one may.
  it(
    'is admitted at the decoded size a catalog may have',
    async () => {
      const room =
        RUNTIME_LIMITS.catalogBytes - richCatalog().resources.decodedBytes;
      const candidate = sealed((catalog) => {
        messageOf(catalog, 'title').body['pattern'] = [
          `Catalog store${'e'.repeat(room)}`,
        ];
      });

      expect(candidate.catalog.resources.decodedBytes).toBe(
        RUNTIME_LIMITS.catalogBytes,
      );
      expect(await admission(candidate)).toBeUndefined();
    },
    CEILING_CASE_MS,
  );

  it('counts a selection’s output parts from its variants, whatever else the body carries', async () => {
    const edit: CatalogEdit = (catalog) => {
      // A list and its one literal: two nodes, one literal, no output part.
      messageOf(catalog, 'count').body['pattern'] = ['stray'];
      catalog.resources.irNodes += 2;
      catalog.resources.literals += 1;
      catalog.resources.maximumMessage['irNodes'] =
        catalog.resources.maximumMessage['irNodes']! + 2;
    };

    expect(await admission(sealed(edit))).toBeUndefined();
  });
});

describe('a catalog that is not the one its address names', () => {
  it.each<[string, CatalogEdit]>([
    [
      'a profile this release does not read',
      (catalog) => {
        catalog['profile'] = 'equator-compiled-ir/2';
      },
    ],
    [
      'another generated ABI',
      (catalog) => {
        catalog['generatedAbi'] = 'equator-generated/2';
      },
    ],
    [
      'another standards profile',
      (catalog) => {
        catalog['standardsProfile'] = 'equator-2';
      },
    ],
    [
      'a key that is not a record',
      (catalog) => {
        (catalog as Record<string, unknown>)['key'] = `${PROVIDER}:shell:en-US`;
      },
    ],
    [
      'another provider',
      (catalog) => {
        catalog.key['providerId'] = '@example/another-provider';
      },
    ],
    [
      'another scope',
      (catalog) => {
        catalog.key['scopeId'] = 'lazy';
      },
    ],
    [
      'another locale',
      (catalog) => {
        catalog.key['catalogLocale'] = 'ar-EG';
      },
    ],
    [
      'another application contract',
      (catalog) => {
        catalog['applicationContractFingerprint'] = FINGERPRINT;
      },
    ],
    [
      'another semantic registry',
      (catalog) => {
        catalog['semanticRegistryFingerprint'] = FINGERPRINT;
      },
    ],
    [
      'an extension its address does not require',
      (catalog) => {
        catalog['requiredExtensions'] = [{ kind: 'function', id: 'extra' }];
      },
    ],
    [
      'messages that are not a list',
      (catalog) => {
        (catalog as Record<string, unknown>)['messages'] = {};
      },
    ],
    [
      'a field the profile does not name',
      (catalog) => {
        catalog['note'] = 'added';
      },
    ],
  ])('is refused as malformed when it states %s', async (_name, edit) => {
    expect(await admission(sealed(edit))).toMatchObject(MALFORMED);
  });

  it('is refused as malformed when its summary is not the one the set recorded', async () => {
    const candidate = sealed(() => undefined);
    const set = editedSet(candidate.set, () => undefined);
    sealedEntry(set).resources.literals += 1;

    expect(await admission({ ...candidate, set })).toMatchObject(MALFORMED);
  });

  it('is refused as malformed when its summary counts another number of messages', async () => {
    const edit: CatalogEdit = (catalog) => {
      catalog.resources.messages -= 1;
    };

    expect(await admission(sealed(edit))).toMatchObject(MALFORMED);
  });

  it('keeps what refused it as the cause', async () => {
    const failure = await admissionFailure(
      sealed((catalog) => {
        catalog['note'] = 'added';
      }),
    );

    expect(failure).toBeInstanceOf(LocalizationError);
    expect((failure as LocalizationError).cause).toBeInstanceOf(TypeError);
  });
});

describe('a catalog whose measures or bytes are not what was recorded', () => {
  it.each([
    'identifiers',
    'literals',
    'irNodes',
    'selectors',
    'variants',
    'references',
    'functions',
    'outputParts',
  ])(
    'is an integrity mismatch when it overstates its %s by one',
    async (count) => {
      const edit: CatalogEdit = (catalog) => {
        catalog.resources[count] = (catalog.resources[count] as number) + 1;
      };

      expect(await admission(sealed(edit))).toMatchObject(MISMATCH);
    },
  );

  it.each(['selectors', 'variants', 'irNodes', 'outputParts'])(
    'is an integrity mismatch when it understates its largest message’s %s',
    async (count) => {
      const edit: CatalogEdit = (catalog) => {
        catalog.resources.maximumMessage[count] =
          catalog.resources.maximumMessage[count]! - 1;
      };

      expect(await admission(sealed(edit))).toMatchObject(MISMATCH);
    },
  );

  it('is an integrity mismatch when it misreports its decoded size', async () => {
    const edit: CatalogEdit = (catalog) => {
      catalog.resources.decodedBytes -= 1;
    };

    expect(await admission(sealed(edit, { measure: false }))).toMatchObject(
      MISMATCH,
    );
  });

  // A size past the ceiling is not a size a catalog can have, so there is nothing to compare the
  // recorded one with: the refusal is for shape, whatever the summary says.
  it(
    'is malformed, not mismatched, when it measures one byte past the ceiling and records the ceiling',
    async () => {
      const room =
        RUNTIME_LIMITS.catalogBytes - richCatalog().resources.decodedBytes;
      const edit: CatalogEdit = (catalog) => {
        messageOf(catalog, 'title').body['pattern'] = [
          `Catalog store${'e'.repeat(room + 1)}`,
        ];
        catalog.resources.decodedBytes = RUNTIME_LIMITS.catalogBytes;
      };

      expect(await admission(sealed(edit, { measure: false }))).toMatchObject(
        MALFORMED,
      );
    },
    CEILING_CASE_MS,
  );

  it('is an integrity mismatch when its bytes are not the ones the digest was taken over', async () => {
    const candidate = sealed(() => undefined);
    const changed = structuredClone(candidate.catalog);
    // The same length, so the summary still holds and only the digest can tell.
    messageOf(changed, 'title').body['pattern'] = ['Catalog stare'];

    expect(
      await admission({
        set: candidate.set,
        loaders: {
          ...candidate.loaders,
          [catalogKey('shell', 'en-US')]: () => changed,
        },
      }),
    ).toMatchObject(MISMATCH);
  });
});

describe('a message that is not a message', () => {
  it.each<[string, CatalogEdit]>([
    [
      'is text',
      (catalog) => {
        (catalog.messages as unknown[])[0] = 'title';
      },
    ],
    [
      'is a list',
      (catalog) => {
        (catalog.messages as unknown[])[0] = [];
      },
    ],
    [
      'carries a field the profile does not name',
      onMessage('title', (message) => {
        message['note'] = 'added';
      }),
    ],
    [
      'has an identifier that is not text',
      onMessage('title', (message) => {
        message.messageId = 7;
      }),
    ],
    [
      'has an empty identifier',
      onMessage('title', (message) => {
        message.messageId = '';
      }),
    ],
    [
      'has an identifier of 1,025 code units',
      onMessage('title', (message) => {
        message.messageId = 'm'.repeat(1_025);
      }),
    ],
    [
      'repeats another message’s identifier',
      (catalog) => {
        catalog.messages.push(structuredClone(messageOf(catalog, 'title')));
        catalog.resources.messages += 1;
      },
    ],
    [
      'has a kind outside the closed set',
      onMessage('title', (message) => {
        message.kind = 'note';
      }),
    ],
    [
      'has a result kind outside the closed set',
      onMessage('title', (message) => {
        message.resultKind = 'markup';
      }),
    ],
    [
      'has a source fingerprint that is not text',
      onMessage('title', (message) => {
        message.sourceFingerprint = 7;
      }),
    ],
    [
      'has a source fingerprint with something before the digest',
      onMessage('title', (message) => {
        message.sourceFingerprint = `x${FINGERPRINT}`;
      }),
    ],
    [
      'has a source fingerprint with something after the digest',
      onMessage('title', (message) => {
        message.sourceFingerprint = `${FINGERPRINT}x`;
      }),
    ],
    [
      'has inputs that are not a list',
      onMessage('title', (message) => {
        (message as Record<string, unknown>)['inputs'] = {};
      }),
    ],
    [
      'has slots that are not a list',
      onMessage('title', (message) => {
        (message as Record<string, unknown>)['slots'] = {};
      }),
    ],
    [
      'has a body that is not a record',
      onMessage('title', (message) => {
        (message as Record<string, unknown>)['body'] = ['Catalog store'];
      }),
    ],
    [
      'is empty and has a body that is not',
      onMessage('separator', (message) => {
        message.body = { kind: 'pattern', declarations: [], pattern: [] };
      }),
    ],
    [
      'is empty and has a body of a kind no message has',
      onMessage('separator', (message) => {
        message.body = { kind: 'blank' };
      }),
    ],
    [
      'has a source fingerprint held in a list',
      onMessage('title', (message) => {
        message.sourceFingerprint = [FINGERPRINT];
      }),
    ],
    [
      'is empty and its body carries more than its kind',
      onBody('separator', (body) => {
        body['pattern'] = [];
      }),
    ],
    [
      'is not empty and has an empty body',
      onMessage('title', (message) => {
        message.body = { kind: 'empty' };
      }),
    ],
    [
      'has a body of a kind outside the closed set',
      onBody('title', (body) => {
        body['kind'] = 'script';
      }),
    ],
    [
      'is a pattern whose declarations are not a list',
      onBody('title', (body) => {
        body['declarations'] = 'none';
      }),
    ],
    [
      'is a pattern whose parts are not a list',
      onBody('title', (body) => {
        body['pattern'] = 'Catalog store';
      }),
    ],
    [
      'is a selection whose declarations are not a list',
      onBody('count', (body) => {
        body['declarations'] = 'none';
      }),
    ],
    [
      'is a selection whose selectors are not a list',
      onBody('count', (body) => {
        body['selectors'] = 'c';
      }),
    ],
    [
      'is a selection whose variants are not a list',
      onBody('count', (body) => {
        body['variants'] = 'ab';
      }),
    ],
    [
      'is a selection with a variant that is not a record',
      onBody('count', (body) => {
        (body['variants'] as unknown[])[0] = 'one';
      }),
    ],
    [
      'is a selection with a variant whose parts are not a list',
      onBody('count', (body) => {
        (body['variants'] as Record<string, unknown>[])[0]!['pattern'] = 'One';
      }),
    ],
    [
      'has a body nested one level past the bound',
      (catalog) => {
        let nested: unknown = 'Catalog store';
        for (let level = 0; level < RUNTIME_LIMITS.jsonDepth - 2; level += 1) {
          nested = [nested];
        }
        messageOf(catalog, 'title').body['pattern'] = [nested];
      },
    ],
  ])('is refused as malformed when it %s', async (_name, edit) => {
    expect(await admission(sealed(edit))).toMatchObject(MALFORMED);
  });
});

describe('a message’s declared input', () => {
  it.each<[string, CatalogEdit]>([
    [
      'is not a record',
      (catalog) => {
        (messageOf(catalog, 'greeting').inputs as unknown[])[0] = 'name';
      },
    ],
    [
      'carries a field the contract does not name',
      onInput((input) => {
        input['pattern'] = '.*';
      }),
    ],
    [
      'has a name that is not text',
      onInput((input) => {
        input['name'] = 7;
      }),
    ],
    [
      'has an empty name',
      onInput((input) => {
        input['name'] = '';
      }),
    ],
    [
      'has a name of 129 code units',
      onInput((input) => {
        input['name'] = 'n'.repeat(129);
      }),
    ],
    [
      'has a type outside the closed set',
      onInput((input) => {
        input['type'] = 'object';
      }),
    ],
    [
      'does not say whether it is optional',
      onInput((input) => {
        input['optional'] = 'no';
      }),
    ],
    [
      'does not say whether it is nullable',
      onInput((input) => {
        input['nullable'] = 0;
      }),
    ],
    [
      'has a description that is not text',
      onInput((input) => {
        input['description'] = 7;
      }),
    ],
    [
      'has a description of 2,049 code units',
      onInput((input) => {
        input['description'] = 'd'.repeat(2_049);
      }),
    ],
    [
      'has an enumeration that is not a list',
      onInput((input) => {
        input['enum'] = 'ab';
      }),
    ],
    [
      'has an enumeration one past its bound',
      onInput((input) => {
        input['enum'] = Array.from(
          { length: RUNTIME_LIMITS.extensionOptionValues + 1 },
          (_, index) => `value-${index}`,
        );
      }),
    ],
    [
      'has an enumeration holding a record',
      onInput((input) => {
        input['enum'] = ['a', { value: 'b' }];
      }),
    ],
    [
      'has an enumeration holding null',
      onInput((input) => {
        input['enum'] = ['a', null];
      }),
    ],
    [
      'has an enumeration that repeats a value',
      onInput((input) => {
        input['enum'] = ['a', 'b', 'a'];
      }),
    ],
  ])('is refused as malformed when it %s', async (_name, edit) => {
    expect(await admission(sealed(edit))).toMatchObject(MALFORMED);
  });
});

describe('a message’s declared slot', () => {
  it.each<[string, CatalogEdit]>([
    [
      'is not a record',
      (catalog) => {
        (messageOf(catalog, 'rich').slots as unknown[])[0] = 'em';
      },
    ],
    [
      'carries a field the contract does not name',
      onSlot((slot) => {
        slot['href'] = '/second';
      }),
    ],
    [
      'has a name that is not text',
      onSlot((slot) => {
        slot['name'] = 7;
      }),
    ],
    [
      'has a name held in a list',
      onSlot((slot) => {
        slot['name'] = ['em'];
      }),
    ],
    [
      'has a kind held in a list',
      onSlot((slot) => {
        slot['kind'] = ['emphasis'];
      }),
    ],
    [
      'nests within a name held in a list',
      onSlot((slot) => {
        slot['within'] = [['strong']];
      }),
    ],
    [
      'has a description held in a list',
      onSlot((slot) => {
        slot['description'] = ['The nested phrase'];
      }),
    ],
    [
      'has an empty name',
      onSlot((slot) => {
        slot['name'] = '';
      }),
    ],
    [
      'has a name of 129 code units',
      onSlot((slot) => {
        slot['name'] = 's'.repeat(129);
      }),
    ],
    [
      'has a kind that is not text',
      onSlot((slot) => {
        slot['kind'] = 7;
      }),
    ],
    [
      'has an empty kind',
      onSlot((slot) => {
        slot['kind'] = '';
      }),
    ],
    [
      'has a kind of 129 code units',
      onSlot((slot) => {
        slot['kind'] = 'k'.repeat(129);
      }),
    ],
    [
      'has a shape outside the closed set',
      onSlot((slot) => {
        slot['shape'] = 'inline';
      }),
    ],
    [
      'does not say whether it is optional',
      onSlot((slot) => {
        slot['optional'] = 'no';
      }),
    ],
    [
      'does not say whether it is repeatable',
      onSlot((slot) => {
        slot['repeatable'] = 1;
      }),
    ],
    [
      'names what it nests within as something other than a list',
      onSlot((slot) => {
        slot['within'] = 'strong';
      }),
    ],
    [
      'nests within one more slot than a message may declare',
      onSlot((slot) => {
        slot['within'] = Array.from(
          { length: RUNTIME_LIMITS.slotsPerMessage + 1 },
          (_, index) => `outer-${index}`,
        );
      }),
    ],
    [
      'nests within something that is not a name',
      onSlot((slot) => {
        slot['within'] = ['strong', 7];
      }),
    ],
    [
      'nests within a name of 129 code units',
      onSlot((slot) => {
        slot['within'] = ['strong', 'w'.repeat(129)];
      }),
    ],
    [
      'has a description that is not text',
      onSlot((slot) => {
        slot['description'] = 7;
      }),
    ],
    [
      'has a description of 2,049 code units',
      onSlot((slot) => {
        slot['description'] = 'd'.repeat(2_049);
      }),
    ],
  ])('is refused as malformed when it %s', async (_name, edit) => {
    expect(await admission(sealed(edit))).toMatchObject(MALFORMED);
  });
});

describe('a catalog one process has already admitted', () => {
  const signal = (): AbortSignal => new AbortController().signal;

  it('is the same admitted catalog for every store handed the same export', async () => {
    const set = richSet();
    // What a generated loader does: the one frozen module export, on every call.
    const exported = Object.freeze(richCatalog());
    const loaders = {
      ...loadersFor(set),
      [catalogKey('shell', 'en-US')]: () => exported,
    };
    const first = richStore(set, loaders);
    const second = richStore(set, loaders);

    const one = await first.acquire(scope('shell'), 'en-US', signal());
    const other = await second.acquire(scope('shell'), 'en-US', signal());

    expect(other.catalog).toBe(one.catalog);
    expect(one.catalog).toEqual(exported);
  });

  it('is verified again when it is offered for another address', async () => {
    const set = richSet();
    const exported = Object.freeze(richCatalog());
    const loaders = {
      ...loadersFor(set),
      [catalogKey('shell', 'en-US')]: () => exported,
      [catalogKey('lazy', 'en-US')]: () => exported,
    };
    const store = richStore(set, loaders);

    await store.preload(scope('shell'), 'en-US', signal());

    expect(
      await rejectionOf(() => store.preload(scope('lazy'), 'en-US', signal())),
    ).toMatchObject({ ...MALFORMED, scopeId: 'lazy' });
  });

  it('is verified again for an address whose fields run together into the same text', async () => {
    // Two addresses that differ only in where the provider ends and the scope begins, recording
    // the same digest. The catalog is the first one's and must not pass for the second.
    const neighbour = { providerId: `${PROVIDER}s`, scopeId: 'hell' };
    const set = editedSet(richSet(), ({ configuration, descriptor }) => {
      const declared = configuration.scopes.find(
        ({ scopeId }) => scopeId === 'shell',
      );
      (configuration as Record<string, unknown>)['scopes'] = [
        ...configuration.scopes,
        { ...declared, ...neighbour },
      ];
      const entry = structuredClone(
        descriptor.providers[0]!.artifacts.find(
          ({ address }) =>
            address.key['scopeId'] === 'shell' &&
            address.key['catalogLocale'] === 'en-US',
        )!,
      );
      Object.assign(entry.address.key, neighbour);
      (descriptor.providers as unknown[]).push({
        providerId: neighbour.providerId,
        catalogSetId: 'neighbour',
        artifacts: [entry],
      });
    });
    const exported = Object.freeze(richCatalog());
    const loaders = {
      ...loadersFor(richSet()),
      [catalogKey('shell', 'en-US')]: () => exported,
      [`${neighbour.providerId}:${neighbour.scopeId}:en-US`]: () => exported,
    };
    const store = richStore(set, loaders);

    await store.preload(scope('shell'), 'en-US', signal());

    expect(
      await rejectionOf(() => store.preload(neighbour, 'en-US', signal())),
    ).toMatchObject({ ...MALFORMED, ...neighbour });
  });
});
