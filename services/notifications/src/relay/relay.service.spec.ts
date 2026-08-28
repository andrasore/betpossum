import { Test } from "@nestjs/testing";
import { MessagingService } from "../messaging/messaging.service";
import { RelayGateway } from "./relay.gateway";
import { RelayService } from "./relay.service";
import { SOCKET_EVENT } from "./socket-events";

/**
 * Exercises the real routing decision the relay exists to make: envelope in →
 * which socket.io event name, and which room (or broadcast). The socket.io
 * server is the only stand-in, because "did we emit to the right room" is
 * exactly what we are asserting.
 */
describe("RelayService", () => {
  let relay: RelayService;
  let emit: jest.Mock;
  let to: jest.Mock;

  beforeEach(async () => {
    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    const gateway = { server: { emit, to } } as unknown as RelayGateway;

    const moduleRef = await Test.createTestingModule({
      providers: [
        RelayService,
        { provide: RelayGateway, useValue: gateway },
        { provide: MessagingService, useValue: { subscribe: jest.fn() } },
      ],
    }).compile();

    relay = moduleRef.get(RelayService);
  });

  const envelope = (
    kind: string,
    userId: string,
    payload: Record<string, unknown>,
  ) => Buffer.from(JSON.stringify({ userId, kind, payload }));

  it("emits a per-user notification into the room named after the sub", () => {
    relay.relay(envelope("betHeld", "user-sub-1", { betId: "bet-1" }));

    expect(to).toHaveBeenCalledWith("user-sub-1");
    expect(emit).toHaveBeenCalledWith("bet.held", { betId: "bet-1" });
  });

  it("broadcasts when userId is empty", () => {
    relay.relay(
      envelope("oddsUpdated", "", {
        eventId: "mock:epl-1",
        homeOdds: 2,
        awayOdds: 3,
        drawOdds: 3.5,
        updatedAt: 1,
      }),
    );

    expect(to).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      "odds.updated",
      expect.objectContaining({ eventId: "mock:epl-1" }),
    );
  });

  it("relays the inner payload verbatim, not the envelope", () => {
    const payload = { betId: "bet-2", won: true, payoutCents: 500 };
    relay.relay(envelope("betSettled", "user-sub-2", payload));

    expect(emit).toHaveBeenCalledWith("bet.settled", payload);
  });

  it.each([
    ["not JSON at all", Buffer.from("<html>")],
    [
      "an unknown kind",
      Buffer.from(JSON.stringify({ userId: "u", kind: "nope", payload: {} })),
    ],
    [
      "an extra envelope field",
      Buffer.from(
        JSON.stringify({ userId: "u", kind: "betHeld", payload: {}, extra: 1 }),
      ),
    ],
  ])("drops %s without emitting or throwing", (_label, raw) => {
    expect(() => relay.relay(raw)).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });

  it("maps every NotificationEvent kind to a distinct socket event", () => {
    const names = Object.values(SOCKET_EVENT);
    expect(new Set(names).size).toBe(names.length);
  });
});
