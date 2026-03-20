import net from 'node:net';

const [, , host, portStr] = process.argv;

if (!host || !portStr) {
  console.error('Usage: node scripts/port-drain-probe.mjs <host> <port>');
  process.exit(1);
}

const port = Number(portStr);

if (Number.isNaN(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${portStr} (must be an integer 1-65535)`);
  process.exit(1);
}

/** Max connection attempts before giving up (25 x 200ms = 5s total timeout). */
const MAX_PROBE_ATTEMPTS = 25;
/** Millisecond delay between probe attempts. */
const PROBE_INTERVAL_MS = 200;

let attempts = 0;

function probe() {
  const socket = net.connect({ host, port });

  socket.once('connect', () => {
    socket.destroy();

    if (++attempts > MAX_PROBE_ATTEMPTS) {
      process.exit(1);
    }

    setTimeout(probe, PROBE_INTERVAL_MS);
  });

  socket.once('error', () => process.exit(0));
}

probe();
