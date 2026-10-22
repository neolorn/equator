/**
 * Capabilities an application selects with a feature, each named by text only its own code
 * carries.
 *
 * `specs/02-packages-and-platform.spec.md` section 8 requires an unselected provider to stay
 * unreachable from a production graph. A minifier renames every identifier, so what survives into
 * the output to show a capability is present is the text of its own messages and stamps; the
 * minimal consumer selects none of these features, and any of this text in its browser output is
 * the capability shipped unselected.
 */
export const UNSELECTED_CAPABILITY_MARKERS = Object.freeze([
  {
    capability: 'route resolution, selected with withRouting()',
    // Written by the path-prefix and host resolvers in `@neolorn/equator/core` when an address
    // cannot be parsed, which only resolving an address can reach.
    markers: [
      'The localized request URL is malformed.',
      'The host-localized request URL is malformed.',
    ],
  },
  {
    capability: 'the route projection check, selected with withRouting()',
    markers: ['withRouting() requires a generated route projection'],
  },
  {
    capability: 'runtime events, selected with withObservability()',
    // The stamp every event carries, which only building an event writes.
    markers: ['equator-runtime-observability-event/1'],
  },
]);

/** The capabilities whose text appears in `text`, with the text that shows each. */
export function unselectedCapabilitiesIn(text) {
  return UNSELECTED_CAPABILITY_MARKERS.flatMap(({ capability, markers }) => {
    const found = markers.filter((marker) => text.includes(marker));
    return found.length === 0 ? [] : [{ capability, found }];
  });
}
