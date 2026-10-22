/**
 * Each spec starts from a clean document and address, undone by the testing entry point that
 * exists for it rather than by a copy here.
 */
import { afterEach } from 'vitest';

import { resetLocalizationTestEnvironment } from '@neolorn/equator/testing';

afterEach(resetLocalizationTestEnvironment);
