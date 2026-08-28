/**
 * Consumer boundary: BetSettledEvent JSON -> signed-cents row.
 *
 * Drives `handle` with real event bytes validated by the generated schema, so
 * the test tracks the wire contract. The signed-cents convention (win =
 * +payout, loss = -stake) is what silently corrupts every downstream P&L
 * number, so it is asserted from the raw bytes rather than in isolation.
 * Amounts arrive as integer cents and are stored verbatim — nothing rounds,
 * which is what keeps this read model identical to Core's ledger.
 */
import { Test } from "@nestjs/testing";
import { MessagingService } from "../messaging/messaging.service";
import type { RecordSettlement } from "../storage/stats-storage";
import { StatsStorage } from "../storage/stats-storage";
import { SettlementsConsumer } from "./settlements.consumer";

describe("SettlementsConsumer", () => {
  let consumer: SettlementsConsumer;
  let recorded: RecordSettlement[];

  beforeEach(async () => {
    recorded = [];
    const store: Pick<StatsStorage, "recordSettlement"> = {
      recordSettlement: (row) => {
        recorded.push(row);
        return Promise.resolve();
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SettlementsConsumer,
        { provide: StatsStorage, useValue: store },
        { provide: MessagingService, useValue: { subscribe: jest.fn() } },
      ],
    }).compile();

    consumer = moduleRef.get(SettlementsConsumer);
  });

  const eventBytes = (
    overrides: Partial<Record<string, unknown>> = {},
  ): Buffer =>
    Buffer.from(
      JSON.stringify({
        userId: "u1",
        userName: "Al",
        betId: "b1",
        eventId: "e1",
        selection: "home",
        odds: 2.0,
        stakeCents: 1_000,
        won: true,
        payoutCents: 1_500,
        settledAt: 1_700_000_000_000,
        ...overrides,
      }),
    );

  it("maps a win's payout to positive cents", async () => {
    await consumer.handle(
      eventBytes({ won: true, stakeCents: 1_000, payoutCents: 1_500 }),
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      stakeCents: 1_000,
      profitCents: 1_500,
    });
  });

  it("maps a loss's stake to negative cents", async () => {
    await consumer.handle(
      eventBytes({ won: false, stakeCents: 1_000, payoutCents: 0 }),
    );

    expect(recorded[0]).toMatchObject({
      stakeCents: 1_000,
      profitCents: -1_000,
    });
  });

  it("stores cents verbatim without rounding", async () => {
    // An odd-cent profit that a dollars round-trip would have been free to
    // shift by one — it must survive the consumer untouched.
    await consumer.handle(
      eventBytes({ won: true, stakeCents: 333, payoutCents: 167 }),
    );

    expect(recorded[0]).toMatchObject({ stakeCents: 333, profitCents: 167 });
  });

  it("carries the denormalized display name through", async () => {
    await consumer.handle(eventBytes({ userName: "Lucky Possum" }));
    expect(recorded[0].userName).toBe("Lucky Possum");
  });

  it("normalises an absent userName to null", async () => {
    const body = JSON.parse(eventBytes().toString());
    delete body.userName;
    await consumer.handle(Buffer.from(JSON.stringify(body)));

    expect(recorded[0].userName).toBeNull();
  });

  it.each([
    ["an empty object", Buffer.from("{}")],
    ["a non-JSON body", Buffer.from("<html>")],
    [
      "an unknown extra field",
      Buffer.from(
        JSON.stringify({
          ...JSON.parse(
            Buffer.from(
              JSON.stringify({
                userId: "u1",
                betId: "b1",
                eventId: "e1",
                selection: "home",
                odds: 2,
                stakeCents: 1,
                won: true,
                payoutCents: 1,
                settledAt: 1,
              }),
            ).toString(),
          ),
          rogue: 1,
        }),
      ),
    ],
  ])(
    "rejects %s before any write, so the message requeues",
    async (_label, body) => {
      // run() relies on this throwing so MessagingService can nack/requeue.
      await expect(consumer.handle(body)).rejects.toThrow();
      expect(recorded).toEqual([]);
    },
  );
});
