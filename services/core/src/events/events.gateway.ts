import {
  WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(EventsGateway.name);
  private userSockets = new Map<string, Set<string>>(); // userId → socket ids

  constructor(private readonly jwt: JwtService) {}

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;
      const payload = this.jwt.verify<{ sub: string }>(token);
      client.data.userId = payload.sub;
      const sockets = this.userSockets.get(payload.sub) ?? new Set();
      sockets.add(client.id);
      this.userSockets.set(payload.sub, sockets);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId: string = client.data.userId;
    if (!userId) return;
    const sockets = this.userSockets.get(userId);
    sockets?.delete(client.id);
    if (sockets?.size === 0) this.userSockets.delete(userId);
  }

  sendToUser(userId: string, event: string, data: unknown) {
    const sockets = this.userSockets.get(userId);
    sockets?.forEach((id) => this.server.to(id).emit(event, data));
  }

  broadcast(event: string, data: unknown) {
    this.server.emit(event, data);
  }
}
