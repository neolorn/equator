/**
 * What the process that runs a consumer's jsdom specs needs in its environment.
 *
 * Node 25 turned on its own Web Storage, and without a storage file its `localStorage` is
 * undefined. Vitest 4 keeps a global Node already defines instead of taking jsdom's, so the specs
 * would read Node's rather than the browser's jsdom stands in for. Vitest 5 takes jsdom's
 * (vitest-dev/vitest#10293), and Angular 22's test builder accepts Vitest 4 only. So the specs'
 * process turns Node's off where Node has it. The server bundle keeps it, as a server on that Node
 * does.
 *
 * One spelling, because every gate that runs the suite has to run it the same way: the consumer
 * row that holds the suite green, and the one that asks whether the suite notices a defect.
 */
export function consumerSpecsEnvironment() {
  if (!('localStorage' in globalThis)) return {};
  return {
    NODE_OPTIONS: [process.env['NODE_OPTIONS'], '--no-experimental-webstorage']
      .filter(Boolean)
      .join(' '),
  };
}
