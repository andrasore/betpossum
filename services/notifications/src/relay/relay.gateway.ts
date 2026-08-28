import { Logger } from "@nestjs/common";
import {
  type OnGatewayConnection,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { TokenVerifierService } from "../auth/token-verifier.service";

// `cors.origin: "*"` is Engine.IO's own server-side Origin allowlist, not
// browser CORS. Behind nginx the browser's Origin (the public edge origin)
// never matches the proxied upstream Host, so the default same-origin policy
// rejects every handshake. "*" disables that check; the real auth boundary is
// the JWT verified in the handshake middleware below, so opening the Origin is
// safe here.
//
// Default namespace and default `/socket.io` path: nginx routes on the path and
// the SPA connects to the namespace, so neither may change.
@WebSocketGateway({ cors: { origin: "*" } })
export class RelayGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RelayGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly tokens: TokenVerifierService) {}

  afterInit(server: Server): void {
    // Authenticate in middleware rather than in handleConnection: passing an
    // Error to next() makes the client emit `connect_error`, which is what
    // frontend/src/lib/websocket.ts keys its silent token refresh off. A
    // server-side disconnect() would fire `disconnect` instead and silently
    // break refresh.
    server.use((socket, next) => {
      void this.tokens.verify(socket.handshake.auth?.token).then((verified) => {
        if (!verified) {
          this.logger.log(`Rejecting socket ${socket.id}: invalid token`);
          next(new Error("unauthorized"));
          return;
        }
        socket.data.sub = verified.sub;
        next();
      });
    });
  }

  handleConnection(client: Socket): void {
    // Per-user rooms are keyed on the JWT `sub` — the same claim core uses as
    // the user id, so a NotificationEvent.userId routes straight to the socket.
    const sub = client.data.sub as string;
    void client.join(sub);
    this.logger.log(`Socket ${client.id} joined room ${sub}`);
  }
}
