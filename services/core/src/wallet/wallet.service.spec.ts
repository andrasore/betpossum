import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { NotificationsClient } from '../notifications/notifications.client';
import { WalletService } from './wallet.service';
import { startTigerBeetle, TbInstance } from './tigerbeetle-harness';

const newId = (): string => randomUUID();

describe('WalletService', () => {
  let tb: TbInstance;
  let wallet: WalletService;

  beforeAll(async () => {
    tb = await startTigerBeetle();

    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) => {
              if (key === 'TIGERBEETLE_ADDRESS') return tb.address;
              if (key === 'TIGERBEETLE_CLUSTER_ID') return '0';
              return fallback;
            },
          },
        },
        { provide: NotificationsClient, useValue: { toUser: jest.fn(), broadcast: jest.fn() } },
      ],
    }).compile();

    wallet = moduleRef.get(WalletService);
    await wallet.onModuleInit();
  });

  afterAll(async () => {
    wallet?.onModuleDestroy();
    await tb?.shutdown();
  });

  it('reports zero balance for a newly created account', async () => {
    const userId = newId();
    await wallet.createAccount(userId);
    expect(await wallet.getBalance(userId)).toBe(0);
  });

  it('reports zero balance for an unknown account', async () => {
    expect(await wallet.getBalance(newId())).toBe(0);
  });

  it('credits the user balance on payout', async () => {
    const userId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 500);
    expect(await wallet.getBalance(userId)).toBe(5);
  });

  it('debits the user balance on hold', async () => {
    const userId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 1000);
    await wallet.hold(userId, newId(), 300);
    expect(await wallet.getBalance(userId)).toBe(7);
  });

  it('restores the held funds on release', async () => {
    const userId = newId();
    const betId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 1000);
    await wallet.hold(userId, betId, 400);
    await wallet.release(userId, betId, 400);
    expect(await wallet.getBalance(userId)).toBe(10);
  });

  it('leaves the user balance reduced after the house keeps the stake', async () => {
    const userId = newId();
    const betId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 1000);
    await wallet.hold(userId, betId, 600);
    await wallet.keep(betId, 600);
    expect(await wallet.getBalance(userId)).toBe(4);
  });

  it('accumulates multiple concurrent holds', async () => {
    const userId = newId();
    await wallet.createAccount(userId);
    await wallet.payout(userId, newId(), 1000);
    await wallet.hold(userId, newId(), 200);
    await wallet.hold(userId, newId(), 300);
    expect(await wallet.getBalance(userId)).toBe(5);
  });
});
