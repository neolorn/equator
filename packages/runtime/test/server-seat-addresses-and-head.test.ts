/**
 * Where the seat asks an address, and how the head of what was answered is read.
 *
 * Section 12 of `specs/06-runtime-and-angular.spec.md` puts the status, the headers and the head of
 * a response within reach of a test. An address is given as a path or as an absolute address, and
 * the head is read as fields from the text of the body, so what is asserted here is the origin a
 * request arrives on and what each field holds for the ways a document can be written.
 */

import { describe, expect, it } from 'vitest';

import {
  answeredHead,
  createLocalizedServerSeat,
} from '../testing/src/server-seat.js';
import { toWebRequest } from '../http/src/public-api.js';
import type {
  LocaleUrlPolicy,
  RouteRuntimeProjection,
} from '@neolorn/equator/core';

const POLICY: LocaleUrlPolicy = {
  kind: 'path-prefix',
  defaultLocale: 'en-US',
  locales: { 'en-US': 'en-us', 'ar-EG': 'ar-eg' },
  prefixes: { 'en-us': 'en-US', 'ar-eg': 'ar-EG' },
  aliases: {},
  localeNeutralRoots: ['assets'],
  omitDefaultPrefix: false,
};

const PROJECTION: RouteRuntimeProjection = {
  generated: {
    profile: 'equator-route-projection/1',
    identity: 'sha256-ServerSeatAddressProjectionIdentity01234567',
    routes: [
      { id: 'route:_index', path: '', parameterNames: [] },
      { id: 'route:second', path: 'second', parameterNames: [] },
    ],
  },
  localizedPaths: { 'route:second': { 'en-US': 'second', 'ar-EG': 'thani' } },
};

/** A seat whose renderer answers with the address the request arrived on. */
const echoingSeat = (origin?: string) =>
  createLocalizedServerSeat({
    policy: POLICY,
    projection: PROJECTION,
    cache: { successMaxAge: 600, permanentRedirectMaxAge: 86_400 },
    cookie: false,
    ...(origin === undefined ? {} : { origin }),
    render: ({ request }) => new Response(request.url),
  });

describe('the origin an address is asked on', () => {
  it('is https://localhost for a path where the seat names none', async () => {
    const answered = await echoingSeat().request('/en-us/second');

    expect(answered.status).toBe(200);
    expect(answered.body).toBe('https://localhost/en-us/second');
  });

  it('is the one the seat names for a path', async () => {
    const answered = await echoingSeat('https://site.example').request(
      '/en-us/second',
    );

    expect(answered.status).toBe(200);
    expect(answered.body).toBe('https://site.example/en-us/second');
  });

  it('is the one an absolute address names', async () => {
    const answered = await echoingSeat('https://site.example').request(
      'https://other.example/ar-eg/thani',
    );

    expect(answered.status).toBe(200);
    expect(answered.body).toBe('https://other.example/ar-eg/thani');
  });

  it('is the one an absolute address names in either case of its scheme', async () => {
    const answered = await echoingSeat('https://site.example').request(
      'HTTP://other.example/ar-eg/thani',
    );

    expect(answered.status).toBe(200);
    expect(answered.body).toBe('http://other.example/ar-eg/thani');
  });

  it('hands an address of any other scheme to the handler as written, which refuses it', async () => {
    const seat = echoingSeat('https://site.example');

    for (const address of [
      'ftp://other.example/ar-eg/thani',
      'ws://other.example/ar-eg/thani',
      'x-https://other.example/ar-eg/thani',
    ]) {
      const answered = await seat.request(address);

      expect(answered.resolution.status, address).toBe('malformed');
      expect(answered.status, address).toBe(400);
      expect(answered.body, address).toBe('');
    }
  });

  it('hands the handler a path whose query carries an absolute address as that path', async () => {
    const target = '/en-us/second?next=https://other.example/ar-eg/thani';
    const seat = echoingSeat('https://site.example');
    const answered = await seat.request(target);
    const direct = await seat.handler(
      toWebRequest({ url: target, headers: {} }, 'https://site.example'),
    );

    expect(answered.status).toBe(direct.status);
    expect(answered.body).toBe(await direct.text());
  });

  it('ends the authority of an absolute address at a question mark or a number sign', async () => {
    // RFC 3986 section 3.2: the authority ends at the next slash, question mark or number sign.
    const seat = echoingSeat('https://site.example');
    const located = async (address: string) =>
      (await seat.request(address)).headers.get('location');

    expect(await located('https://other.example?x=1')).toBe('/en-us?x=1');
    expect(await located('https://other.example?next=/en-us/second')).toBe(
      '/en-us?next=/en-us/second',
    );
    expect(await located('https://other.example#top')).toBe('/en-us#top');
    expect(await located('https://other.example/?x=1')).toBe('/en-us?x=1');
    // The query is the target's, so the origin is still the one the address names.
    const answered = await seat.request(
      'https://other.example/ar-eg/thani?next=/en-us/second',
    );
    expect(answered.body).toBe(
      'https://other.example/ar-eg/thani?next=/en-us/second',
    );
  });

  it('leaves a backslash after the host in the target, where the handler refuses it', async () => {
    const answered = await echoingSeat('https://site.example').request(
      'https://site.example\\en-us/second',
    );

    expect(answered.resolution.status).toBe('malformed');
    expect(answered.status).toBe(400);
  });

  it('asks the root where an absolute address stops at its host', async () => {
    const seat = echoingSeat('https://site.example');
    const root = await seat.request('/');
    const answered = await seat.request('https://site.example');

    expect(root.resolution.status).not.toBe('malformed');
    expect(answered.resolution.status).toBe(root.resolution.status);
    expect(answered.status).toBe(root.status);
    expect(answered.headers.get('location')).toBe(root.headers.get('location'));
  });
});

describe('the part of a document read as its head', () => {
  it('ends where the head ends, so the body is not read', () => {
    const head = answeredHead(
      `<html><head>\n<meta name="description" content="from the head">\n` +
        `<link rel="canonical" href="/head">\n</head>` +
        `<body><meta name="description" content="from the body">` +
        `<link rel="canonical" href="/body"></body></html>`,
    );

    expect(head.description).toBe('from the head');
    expect(head.links.map((link) => link.href)).toEqual(['/head']);
  });

  it('is found where the head element carries attributes', () => {
    const head = answeredHead(
      `<html><head data-build="12" class="page">` +
        `<link rel="canonical" href="/head"></head>` +
        `<body><link rel="canonical" href="/body"></body></html>`,
    );

    expect(head.links.map((link) => link.href)).toEqual(['/head']);
  });

  it('is the whole text where the document has no head element', () => {
    const head = answeredHead(
      `<title>Fragment</title><link rel="canonical" href="/fragment">`,
    );

    expect(head.title).toBe('Fragment');
    expect(head.canonical).toBe('/fragment');
    expect(head.lang).toBeUndefined();
    expect(head.dir).toBeUndefined();
  });
});

describe('what is left out of the head before it is read', () => {
  it('is every comment, script and style, with what they hold', () => {
    const head = answeredHead(
      `<head><!-- <link rel="canonical" href="/commented"> -->` +
        `<script type="application/ld+json">{"a":"<link rel='canonical' href='/scripted'>"}</script>` +
        `<style>a::after{content:"<meta name='robots' content='styled'>"}</style>` +
        `<link rel="canonical" href="/kept"></head>`,
    );

    expect(head.links.map((link) => link.href)).toEqual(['/kept']);
    expect(head.robots).toBeUndefined();
  });

  it('is a comment written inside a title or an attribute value as well', () => {
    // The head is read as text, not parsed, so the three are removed wherever they stand.
    const head = answeredHead(
      `<head><title>Name<!-- draft --></title>` +
        `<meta name="description" content="a<!-- x -->b"></head>`,
    );

    expect(head.title).toBe('Name');
    expect(head.description).toBe('ab');
  });
});

describe('the title of an answered document', () => {
  it('is read from a title element that carries attributes', () => {
    expect(
      answeredHead(`<head><title data-page="7">Named</title></head>`).title,
    ).toBe('Named');
  });

  it('loses the whitespace around it and keeps the whitespace inside it', () => {
    expect(
      answeredHead(`<head><title>\n    Two words \n</title></head>`).title,
    ).toBe('Two words');
  });
});

describe('the attributes of an answered element', () => {
  it('are read where the value is written without quotes', () => {
    const head = answeredHead(`<html lang=ar-EG dir=rtl><head></head></html>`);

    expect(head.lang).toBe('ar-EG');
    expect(head.dir).toBe('rtl');
  });

  it('are read where the value is written in single quotes', () => {
    const head = answeredHead(
      `<head><link rel='canonical' href='https://site.example/a b'></head>`,
    );

    expect(head.canonical).toBe('https://site.example/a b');
  });

  it('are read where whitespace surrounds the equals sign', () => {
    const head = answeredHead(
      `<head><meta name = "description" content = "spaced"></head>`,
    );

    expect(head.meta).toEqual({ description: 'spaced' });
  });

  it('are present and empty where no value is written', () => {
    const head = answeredHead(
      `<html lang dir="rtl"><head><meta name="robots" content></head></html>`,
    );

    expect(head.lang).toBe('');
    expect(head.dir).toBe('rtl');
    expect(head.meta).toEqual({ robots: '' });
  });
});

describe('the metadata of an answered document', () => {
  it('keeps named metadata and property metadata apart', () => {
    const head = answeredHead(
      `<head><meta name="description" content="About">` +
        `<meta property="og:title" content="Card"></head>`,
    );

    expect(head.meta).toEqual({ description: 'About' });
    expect(head.properties).toEqual({ 'og:title': 'Card' });
  });

  it('reads what the page tells a crawler', () => {
    const head = answeredHead(
      `<head><meta name="description" content="About">` +
        `<meta name="robots" content="noindex, follow"></head>`,
    );

    expect(head.robots).toBe('noindex, follow');
  });

  it('reads metadata written with no content as empty', () => {
    const head = answeredHead(
      `<head><meta name="robots"><meta property="og:title"></head>`,
    );

    expect(head.meta).toEqual({ robots: '' });
    expect(head.properties).toEqual({ 'og:title': '' });
  });

  it('answers with no crawler directive where the page wrote none', () => {
    const head = answeredHead(
      `<head><meta name="description" content="About"></head>`,
    );

    expect(head.robots).toBeUndefined();
  });
});

describe('the links of an answered document', () => {
  it('leaves out a link with no relationship and a link with no address', () => {
    const head = answeredHead(
      `<head><link href="/no-relationship"><link rel="preconnect">` +
        `<link type="text/css"><link rel="canonical" href="/kept"></head>`,
    );

    expect(head.links).toEqual([
      { rel: 'canonical', href: '/kept', hreflang: undefined },
    ]);
  });

  it('finds the canonical after links that are not one', () => {
    const head = answeredHead(
      `<head><link rel="stylesheet" href="/site.css">` +
        `<link rel="Canonical" href="/page"></head>`,
    );

    expect(head.canonical).toBe('/page');
  });

  it('answers with no canonical where the links hold none', () => {
    const head = answeredHead(
      `<head><link rel="stylesheet" href="/site.css"></head>`,
    );

    expect(head.links).toHaveLength(1);
    expect(head.canonical).toBeUndefined();
  });

  it('counts as the cluster only the alternates that name a locale', () => {
    const head = answeredHead(
      `<head><link rel="alternate" type="application/rss+xml" href="/feed">` +
        `<link rel="author" hreflang="en" href="/about">` +
        `<link rel="Alternate" hreflang="ar-EG" href="/ar-eg/thani"></head>`,
    );

    expect(head.links).toHaveLength(3);
    expect(head.alternates).toEqual([
      { rel: 'Alternate', href: '/ar-eg/thani', hreflang: 'ar-EG' },
    ]);
  });
});

describe('the character references of an answered document', () => {
  it('decodes the named references for a greater-than sign and an apostrophe', () => {
    const head = answeredHead(
      `<head><title>2 &gt; 1, it&apos;s so</title></head>`,
    );

    expect(head.title).toBe("2 > 1, it's so");
  });

  it('decodes a no-break space to that character', () => {
    const head = answeredHead(`<head><title>10&nbsp;km</title></head>`);

    expect(head.title).toBe(`10${String.fromCodePoint(0xa0)}km`);
  });

  it('decodes the last code point there is', () => {
    const head = answeredHead(`<head><title>a&#x10FFFF;b</title></head>`);

    expect(head.title).toBe(`a${String.fromCodePoint(0x10_ffff)}b`);
  });

  it('leaves a reference past the last code point as written', () => {
    const head = answeredHead(
      `<head><title>a&#x110000;b&#1114112;c</title></head>`,
    );

    expect(head.title).toBe('a&#x110000;b&#1114112;c');
  });

  it('leaves a reference that names no character as written', () => {
    // Code point zero and the surrogates are not characters a document can hold.
    const head = answeredHead(
      `<head><title>a&#0;b&#x0;c&#xD800;d&#57343;e</title></head>`,
    );

    expect(head.title).toBe('a&#0;b&#x0;c&#xD800;d&#57343;e');
  });

  it('decodes the code points on either side of the surrogates', () => {
    const head = answeredHead(
      `<head><title>&#1;&#xD7FF;&#xE000;</title></head>`,
    );

    expect(head.title).toBe(String.fromCodePoint(1, 0xd7ff, 0xe000));
  });
});
