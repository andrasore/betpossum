import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { io, type Socket } from "socket.io-client";
import { TokenVerifierService } from "../auth/token-verifier.service";
import { RelayGateway } from "./relay.gateway";

/**
 * Drives a real socket.io handshake over a real TCP connection, because the
 * behaviour under test is protocol-level: an unauthenticated client must see
 * `connect_error`, not `disconnect`. frontend/src/lib/websocket.ts triggers its
 * silent token refresh from `connect_error`, so a gateway that rejected by
 * calling disconnect() would break refresh without failing any unit test.
 */
describe("RelayGateway handshake", () => {
  let app: INestApplication;
  let url: string;
  const clients: Socket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RelayGateway,
        {
          provide: TokenVerifierService,
          useValue: {
            verify: (token: unknown) =>
              Promise.resolve(token === "good" ? { sub: "user-sub-1" } : null),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    url = await app.getUrl();
  });

  afterAll(async () => {
    for (const client of clients) {
      client.disconnect();
    }
    await app.close();
  });

  const connect = (auth: Record<string, unknown>): Socket => {
    const client = io(url, {
      auth,
      transports: ["websocket"],
      reconnection: false,
    });
    clients.push(client);
    return client;
  };

  const outcome = (client: Socket): Promise<string> =>
    new Promise((resolve) => {
      client.on("connect", () => resolve("connect"));
      client.on("connect_error", () => resolve("connect_error"));
      client.on("disconnect", () => resolve("disconnect"));
    });

  it("accepts a valid token", async () => {
    await expect(outcome(connect({ token: "good" }))).resolves.toBe("connect");
  });

  it("rejects an invalid token with connect_error", async () => {
    await expect(outcome(connect({ token: "bad" }))).resolves.toBe(
      "connect_error",
    );
  });

  it("rejects a missing token with connect_error", async () => {
    await expect(outcome(connect({}))).resolves.toBe("connect_error");
  });

  it("joins the connected socket into the room named after its sub", async () => {
    const client = connect({ token: "good" });
    await outcome(client);

    // The client sees `connect` as soon as the server acks the handshake, which
    // can be a tick before handleConnection has run the join.
    const gateway = app.get(RelayGateway);
    const joined = await waitFor(() =>
      Boolean(
        gateway.server.sockets.adapter.rooms
          .get("user-sub-1")
          ?.has(client.id as string),
      ),
    );
    expect(joined).toBe(true);
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}
