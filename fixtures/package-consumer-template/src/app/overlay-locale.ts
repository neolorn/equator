import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';
import type {
  LocalizationOverlayAdapter,
  LocalizationSnapshot,
} from '@neolorn/equator';

/**
 * The root this application attaches dialogs and menus to, beside its own. What is attached there
 * reads its language and direction from the root itself, so the root carries the committed locale
 * rather than leaving it to the document.
 */
export function overlayLocale(): LocalizationOverlayAdapter {
  const root = inject(DOCUMENT).querySelector('[data-overlay-root]');
  const show = (snapshot: LocalizationSnapshot | undefined) => {
    if (root === null) return;
    if (snapshot === undefined) {
      root.removeAttribute('lang');
      root.removeAttribute('dir');
      return;
    }
    root.setAttribute('lang', snapshot.primaryLocale);
    root.setAttribute('dir', snapshot.direction);
  };
  return { apply: show, rollback: show };
}
