/**
 * The commands the executable accepts.
 *
 * A module of its own because two files read it and one cannot import the other: `cli.ts` runs the
 * command line when it loads, and `schemas.ts`, whose result schema lists the commands a machine
 * result can name, is imported by build scripts that must not start it.
 */
export const CLI_COMMANDS = Object.freeze([
  'init',
  'generate',
  'check',
  'format',
  'clean',
  'uninstall',
  'migrate',
  'watch',
] as const);

export type CliCommand = (typeof CLI_COMMANDS)[number];
