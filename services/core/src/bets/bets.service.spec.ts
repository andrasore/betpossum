import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Bet } from './bet.entity';
import { BetsService } from './bets.service';
import { User } from '../users/user.entity';
import { NotificationsClient } from '../notifications/notifications.client';
import { WalletService } from '../wallet/wallet.service';
import { startTigerBeetle, TbInstance } from '../wallet/tigerbeetle-harness';

const newId = (): string => randomUUID();

describe('BetsService', () => {
  let tb: TbInstance;
  let pg: StartedPostgreSqlContainer;
  let wallet: WalletService;
  let bets: BetsService;
  let userRepo: Repository<User>;
  let betRepo: Repository<Bet>;
  const notifications = { toUser: jest.fn(), broadcast: jest.fn() };

  beforeAll(async () => {
    tb = await startTigerBeetle();
    pg = await new PostgreSqlContainer('postgres:16-alpine').start();

    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: pg.getHost(),
          port: pg.getPort(),
          username: pg.getUsername(),
          password: pg.getPassword(),
          database: pg.getDatabase(),
          entities: [User, Bet],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([User, Bet]),
      ],
      providers: [
        BetsService,
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
        { provide: NotificationsClient, useValue: notifications },
      ],
    }).compile();

    wallet = moduleRef.get(WalletService);
    bets = moduleRef.get(BetsService);
    userRepo = moduleRef.get(getRepositoryToken(User));
    betRepo = moduleRef.get(getRepositoryToken(Bet));
    await wallet.onModuleInit();
  }, 120_000);

  afterAll(async () => {
    wallet?.onModuleDestroy();
    await tb?.shutdown();
    await pg?.stop();
  });

  const newFundedUser = async (cents: number): Promise<string> => {
    const userId = newId();
    await userRepo.insert({ id: userId, email: null, name: null });
    await wallet.createAccount(userId);
    await wallet.setBalance(userId, cents);
    return userId;
  };

  it('places a bet, holds the stake, and transitions to held', async () => {
    const userId = await newFundedUser(10000);
    notifications.toUser.mockClear();

    const bet = await bets.place(userId, 'evt-1', 'home', 2, 5);

    expect(bet.status).toBe('held');
    const stored = await betRepo.findOneByOrFail({ id: bet.id });
    expect(stored.status).toBe('held');
    expect(Number(stored.stake)).toBe(5);
    expect(Number(stored.odds)).toBe(2);

    expect(await wallet.getBalanceCents(userId)).toBe(9500);

    expect(notifications.toUser).toHaveBeenCalledWith(userId, 'bet.held', { betId: bet.id });
  });

  it('settles a winning bet: releases hold, pays profit, updates row', async () => {
    const userId = await newFundedUser(10000);
    const bet = await bets.place(userId, 'evt-2', 'home', 3, 10);
    notifications.toUser.mockClear();

    // stake 10 at odds 3 → profit = 10 * (3 - 1) = 20
    await bets.settle(bet.id, true, 20);

    const stored = await betRepo.findOneByOrFail({ id: bet.id });
    expect(stored.status).toBe('won');
    expect(Number(stored.payout)).toBe(20);

    // release voids the 1000c hold (stake returns) + payout adds 2000c profit.
    expect(await wallet.getBalanceCents(userId)).toBe(12000);

    expect(notifications.toUser).toHaveBeenCalledWith(userId, 'bet.settled', {
      betId: bet.id,
      won: true,
      payout: 20,
    });
  });

  it('settles a losing bet: keeps the hold, no payout', async () => {
    const userId = await newFundedUser(10000);
    const bet = await bets.place(userId, 'evt-3', 'home', 3, 10);
    notifications.toUser.mockClear();

    await bets.settle(bet.id, false, 0);

    const stored = await betRepo.findOneByOrFail({ id: bet.id });
    expect(stored.status).toBe('lost');
    expect(Number(stored.payout)).toBe(0);

    // keep makes the 1000c hold permanent → balance drops by stake.
    expect(await wallet.getBalanceCents(userId)).toBe(9000);

    expect(notifications.toUser).toHaveBeenCalledWith(userId, 'bet.settled', {
      betId: bet.id,
      won: false,
      payout: 0,
    });
  });

  it('settle throws when called twice — duplicate invocations are the caller-side bug', async () => {
    const userId = await newFundedUser(10000);
    const bet = await bets.place(userId, 'evt-twice', 'home', 3, 10);

    await bets.settle(bet.id, true, 20);
    const after1 = await wallet.getBalanceCents(userId);
    expect(after1).toBe(12000);

    await expect(bets.settle(bet.id, true, 20)).rejects.toThrow(/status is won/);
    expect(await wallet.getBalanceCents(userId)).toBe(after1);
  });

  it('preserves decimal precision through stake × odds settlement', async () => {
    const userId = await newFundedUser(10000);

    // 0.1 * 3 lands cleanly in decimal arithmetic but is 0.30000000000000004 in IEEE-754 float.
    const bet = await bets.place(userId, 'evt-4', 'home', 3, 0.1);
    const placed = await betRepo.findOneByOrFail({ id: bet.id });
    expect(Number(placed.stake)).toBe(0.1);
    expect(await wallet.getBalanceCents(userId)).toBe(9990);

    // profit = 0.1 * (3 - 1) = 0.2
    await bets.settle(bet.id, true, 0.2);
    const settled = await betRepo.findOneByOrFail({ id: bet.id });
    expect(Number(settled.payout)).toBe(0.2);
    expect(await wallet.getBalanceCents(userId)).toBe(10020);
  });
});
