/**
 * A listening port a browser, and Node's own `fetch`, will connect to.
 *
 * Browsers refuse a request to a port the Fetch standard lists as bad, and so does Node's `fetch`,
 * which implements the same algorithm. A server listening on port 0 takes whatever the system hands
 * out, and a system whose dynamic range reaches down into the list can hand out one of them: Windows
 * lets that range start at 1024, where 19 of the listed ports sit. The run then fails in its first
 * navigation with an error about the port, not the page.
 */

/**
 * Every port in the table of Fetch, section 2.9 "Port blocking", at commit snapshot
 * 357bd98924d94b81fbe8608192a2ee1f123b82f4 (21 September 2026):
 * https://fetch.spec.whatwg.org/commit-snapshots/357bd98924d94b81fbe8608192a2ee1f123b82f4/#port-blocking
 */
export const FETCH_BAD_PORTS = Object.freeze([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77,
  79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135,
  137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531,
  532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720,
  1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

/**
 * The most ports asked for before the run stops: one more than the list is long, since a system
 * that never repeats itself can hand out each listed port once and then has to hand out another. A
 * system that hands out ports in sequence gives 6665 to 6669 five in a row, so a smaller count
 * stops a run the next ask would have finished. A system that gives back a port it already gave
 * will keep doing so, and that is what stops the run early.
 */
export const PORT_ATTEMPTS = FETCH_BAD_PORTS.length + 1;

/**
 * Listens on `host` at a port no browser refuses, and returns it.
 *
 * `requested` names the port each attempt asks for; the system chooses unless it says otherwise,
 * which is how the self-test puts a listed port in the way.
 */
export async function listenForBrowsers(server, host, requested = () => 0) {
  const refused = [];
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(requested(attempt), host, () => {
        server.off('error', rejectListen);
        resolveListen();
      });
    });
    const { port } = server.address();
    if (!FETCH_BAD_PORTS.includes(port)) return port;
    const repeated = refused.includes(port);
    refused.push(port);
    await new Promise((resolveClose) => server.close(() => resolveClose()));
    if (repeated) break;
  }
  throw new Error(
    `The system gave ${host} the ports ${refused.join(', ')} in ${refused.length} attempts, and browsers and Node's fetch refuse each one (Fetch, section 2.9). Move the system's dynamic port range above them; on Windows, "netsh int ipv4 show dynamicport tcp" shows it.`,
  );
}
