import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { type Client, createClient } from "tigerbeetle-node";
import { NotificationsClient } from "../notifications/notifications.client";
import { startTigerBeetle, type TbInstance } from "./tigerbeetle-harness";
import { WalletService } from "./wallet.service";

const newId = (): string => randomUUID();

const HOUSE_ID = 2n;

const toAccountId = (uuid: string): bigint =>
  BigInt(`0x${uuid.replace(/-/g, "")}`);

describe("WalletService", () => {
  let tb: TbInstance;
  let wallet: WalletService;
  let probe: Client;

  const readRawBalance = async (id: bigint): Promise<number> => {
    const accounts = await probe.lookupAccounts([id]);
    if (accounts.length === 0) return 0;
    const a = accounts[0];
    return Number(a.credits_posted - a.debits_posted);
  };

  const readPendingDebit = async (id: bigint): Promise<number> => {
    const accounts = await probe.lookupAccounts([id]);
    if (accounts.length === 0) return 0;
    return Number(accounts[0].debits_pending);
  };

  beforeAll(async () => {
    tb = await startTigerBeetle();

    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) => {
              if (key === "TIGERBEETLE_ADDRESS") return tb.address;
              if (key === "TIGERBEETLE_CLUSTER_ID") return "0";
              return fallback;
            },
          },
        },
        {
          provide: NotificationsClient,
          useValue: { toUser: jest.fn(), broadcast: jest.fn() },
        },
      ],
    }).compile();

    wallet = moduleRef.get(WalletService);
    await wallet.onModuleInit();

    probe = createClient({ cluster_id: 0n, replica_addresses: [tb.address] });
  });

  afterAll(async () => {
    probe?.destroy();
    wallet?.onModuleDestroy();
    await tb?.shutdown();
  });

  it("reports zero balance for a newly created account", async () => {
    const userId = newId();
    await wallet.createAccount(userId);
    expect(await wallet.getBalanceCents(userId)).toBe(0);
  });

  it("reports zero balance for an unknown account", async () => {
    expect(await wallet.getBalanceCents(newId())).toBe(0);
  });

  it("credits the user balance on payout", async () => {
    const userId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 500);
    expect(await wallet.getBalanceCents(userId)).toBe(500);
  });

  it("returns the balance amount in dollars", async () => {
    const userId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 500);
    expect(await wallet.getBalance(userId)).toBe(5);
  });

  it("debits the user balance on hold", async () => {
    const userId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 1000);
    await wallet.hold(userId, newId(), 300);
    expect(await wallet.getBalanceCents(userId)).toBe(700);
  });

  it("restores the held funds on release", async () => {
    const userId = newId();
    const betId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 1000);
    await wallet.hold(userId, betId, 400);
    await wallet.release(userId, betId, 400);
    expect(await wallet.getBalanceCents(userId)).toBe(1000);
  });

  it("leaves the user balance reduced after the house keeps the stake", async () => {
    const userId = newId();
    const betId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 1000);
    await wallet.hold(userId, betId, 600);
    await wallet.keep(userId, betId, 600);
    expect(await wallet.getBalanceCents(userId)).toBe(400);
  });

  it("accumulates multiple concurrent holds", async () => {
    const userId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 1000);
    await wallet.hold(userId, newId(), 200);
    await wallet.hold(userId, newId(), 300);
    expect(await wallet.getBalanceCents(userId)).toBe(500);
  });

  it("clears the user pending debit after hold → release", async () => {
    const userId = newId();
    const betId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 1000);

    await wallet.hold(userId, betId, 400);
    expect(await readPendingDebit(toAccountId(userId))).toBe(400);

    await wallet.release(userId, betId, 400);
    expect(await readPendingDebit(toAccountId(userId))).toBe(0);
  });

  it("credits the house account when it keeps a held stake", async () => {
    const userId = newId();
    const betId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 1000);

    const houseBefore = await readRawBalance(HOUSE_ID);
    await wallet.hold(userId, betId, 600);
    await wallet.keep(userId, betId, 600);
    const houseAfter = await readRawBalance(HOUSE_ID);

    expect(houseAfter - houseBefore).toBe(600);
  });

  it("credits the user beyond the original hold when payout exceeds the stake", async () => {
    const userId = newId();
    const betId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 1000);

    await wallet.hold(userId, betId, 500);
    expect(await wallet.getBalanceCents(userId)).toBe(500);

    await wallet.payout(userId, betId, 1500);
    expect(await wallet.getBalanceCents(userId)).toBe(2000);
  });

  it("rejects a hold that would push the user balance below zero", async () => {
    const userId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 500);

    await expect(wallet.hold(userId, newId(), 1000)).rejects.toThrow(
      /TigerBeetle transfer failed/,
    );
    expect(await wallet.getBalanceCents(userId)).toBe(500);
  });

  it("raises and lowers the balance symmetrically via setBalance", async () => {
    const userId = newId();
    await wallet.createAccount(userId);

    await wallet.setBalance(userId, 10000);
    expect(await wallet.getBalanceCents(userId)).toBe(10000);

    await wallet.setBalance(userId, 2500);
    expect(await wallet.getBalanceCents(userId)).toBe(2500);

    await wallet.setBalance(userId, 0);
    expect(await wallet.getBalanceCents(userId)).toBe(0);
  });
});
