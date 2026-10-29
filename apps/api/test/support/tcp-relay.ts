import { connect, createServer, type Server, type Socket } from 'node:net';

/**
 * A switchable TCP relay in front of a test service (Mailpit, ClamAV): `down()` makes the port
 * refuse connections, as a crashed server would; `up()` restores it on the same port.
 */
export class TcpRelay {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  port = 0;

  constructor(
    private readonly targetHost: string,
    private readonly targetPort: number,
  ) {}

  async up(): Promise<void> {
    this.server = createServer((client) => {
      const upstream = connect(this.targetPort, this.targetHost);
      for (const s of [client, upstream]) {
        this.sockets.add(s);
        s.on('error', () => s.destroy());
        s.on('close', () => this.sockets.delete(s));
      }
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((resolve) => this.server?.listen(this.port, '127.0.0.1', resolve));
    const address = this.server.address();
    if (address && typeof address === 'object') this.port = address.port;
  }

  async down(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}
