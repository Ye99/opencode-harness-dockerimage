import net from 'node:net';

const [, , host, portStr] = process.argv;

if (!host || !portStr) {
  console.error('Usage: node scripts/port-drain-probe.mjs <host> <port>');
  process.exit(1);
}

const port = Number(portStr);
let attempts = 0;

function probe() {
  const socket = net.connect({ host, port });

  socket.once('connect', () => {
    socket.destroy();

    if (++attempts > 25) {
      process.exit(1);
    }

    setTimeout(probe, 200);
  });

  socket.once('error', () => process.exit(0));
}

probe();
