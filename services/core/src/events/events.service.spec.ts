import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Bet } from '../bets/bet.entity';
import { BetsService } from '../bets/bets.service';
import { User } from '../users/user.entity';
import { NotificationsClient } from '../notifications/notifications.client';
import { WalletService } from '../wallet/wallet.service';
import { MessagingService } from '../messaging/messaging.service';
import { startTigerBeetle, TbInstance } from '../wallet/tigerbeetle-harness';
import { EventResult } from './event-result.entity';
import { EventsService } from './events.service';
import { EventResolvedEvent, Outcome } from '../generated/events';

const newId = (): string => randomUUID();

const encodeEvent = (eventId: string, outcome: Outcome): Buffer =>
  Buffer.from(
    EventResolvedEvent.toBinary(
      EventResolvedEvent.create({
        eventId,
        sport: 'soccer_epl',
        outcome,
        resolvedAt: Date.now(),
      }),
    ),
  );

describe('EventsService', () => {
  let tb: TbInstance;
  let pg: StartedPostgreSqlContainer;
  let wallet: WalletService;
  let bets: BetsService;
  let events: EventsService;
  let userRepo: Repository<User>;
  let betRepo: Repository<Bet>;
  let resultRepo: Repository<EventResult>;
  const notifications = { toUser: jest.fn(), broadcast: jest.fn() };
  const messaging = { publish: jest.fn(), subscribe: jest.fn() };

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
          entities: [User, Bet, EventResult],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([User, Bet, EventResult]),
      ],
      providers: [
        BetsService,
        EventsService,
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
        { provide: MessagingService, useValue: messaging },
      ],
    }).compile();

    wallet = moduleRef.get(WalletService);
    bets = moduleRef.get(BetsService);
    events = moduleRef.get(EventsService);
    userRepo = moduleRef.get(getRepositoryToken(User));
    betRepo = moduleRef.get(getRepositoryToken(Bet));
    resultRepo = moduleRef.get(getRepositoryToken(EventResult));
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

  it('settles only held bets on the resolved event; winning selections receive profit', async () => {
    const userA = await newFundedUser(10000);
    const userB = await newFundedUser(10000);

    // Two bets on the event-to-resolve, one bet on an unrelated event.
    const winnerBet = await bets.place(userA, 'evt-win', 'home', 3, 10);   // matches outcome → wins
    const loserBet = await bets.place(userB, 'evt-win', 'away', 2, 5);      // doesn't match → loses
    const unrelatedBet = await bets.place(userA, 'evt-other', 'home', 2, 5);

    await events.handle(encodeEvent('evt-win', Outcome.HOME));

    const winner = await betRepo.findOneByOrFail({ id: winnerBet.id });
    const loser = await betRepo.findOneByOrFail({ id: loserBet.id });
    const unrelated = await betRepo.findOneByOrFail({ id: unrelatedBet.id });

    expect(winner.status).toBe('won');
    expect(Number(winner.payout)).toBe(20); // 10 * (3-1) = 20

    expect(loser.status).toBe('lost');
    expect(Number(loser.payout)).toBe(0);

    expect(unrelated.status).toBe('held');

    // userA: +2000c profit; held released. Pre-bet 10000, held -1000 (other), so balance = 10000 + 2000 - 500 (other still held) = 11500
    expect(await wallet.getBalanceCents(userA)).toBe(11500);
    // userB lost stake of $5 = 500c, so balance = 10000 - 500 = 9500
    expect(await wallet.getBalanceCents(userB)).toBe(9500);

    const persisted = await resultRepo.findOneByOrFail({ eventId: 'evt-win' });
    expect(persisted.outcome).toBe('home');
  });

  it('duplicate delivery is a no-op — bets are not settled twice', async () => {
    const userId = await newFundedUser(10000);
    const bet = await bets.place(userId, 'evt-dup', 'home', 3, 10);

    await events.handle(encodeEvent('evt-dup', Outcome.HOME));
    const balanceAfterFirst = await wallet.getBalanceCents(userId);

    // Second delivery of the same event should be swallowed by the
    // event_results idempotency guard — it must NOT reach settle(), which
    // would now throw because the bet is no longer in 'held'.
    await expect(events.handle(encodeEvent('evt-dup', Outcome.HOME))).resolves.toBeUndefined();

    expect(await wallet.getBalanceCents(userId)).toBe(balanceAfterFirst);
    const settled = await betRepo.findOneByOrFail({ id: bet.id });
    expect(settled.status).toBe('won');
  });

  it('ignores events with unspecified outcome', async () => {
    const userId = await newFundedUser(10000);
    const bet = await bets.place(userId, 'evt-unspec', 'home', 2, 5);

    await events.handle(encodeEvent('evt-unspec', Outcome.UNSPECIFIED));

    const stored = await betRepo.findOneByOrFail({ id: bet.id });
    expect(stored.status).toBe('held');
    expect(await resultRepo.findOneBy({ eventId: 'evt-unspec' })).toBeNull();
  });
});
