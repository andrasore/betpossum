import { promises as dns } from "node:dns";
import * as net from "node:net";
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import {
  AccountFlags,
  type Client,
  CreateAccountStatus,
  CreateTransferStatus,
  createClient,
  type Transfer,
  TransferFlags,
  id as tbId,
} from "tigerbeetle-node";
import type { NotificationsClient } from "../notifications/notifications.client";

const HOUSE_ID = 2n;

const LEDGER = 1;

const CODE_BET = 1;
const CODE_PAYOUT = 3;
const CODE_DEPOSIT = 5;
const CODE_ADMIN_ADJUST = 6;

const HOUSE_CODE = 101;
const USER_CODE = 1;

@Injectable()
export class WalletService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WalletService.name);
  private client!: Client;

  constructor(
    private readonly config: ConfigService,
    private readonly notifications: NotificationsClient,
  ) {}

  async onModuleInit() {
    const address = this.config.get<string>(
      "TIGERBEETLE_ADDRESS",
      "localhost:6000",
    );
    const resolved = await this.resolveAddress(address);
    const clusterId = BigInt(
      this.config.get<string>("TIGERBEETLE_CLUSTER_ID", "0"),
    );
    this.logger.log(
      `Connecting to TigerBeetle cluster=${clusterId} address=${resolved}`,
    );
    this.client = createClient({
      cluster_id: clusterId,
      replica_addresses: [resolved],
    });
    await this.ensureSystemAccounts();
  }

  private async resolveAddress(address: string): Promise<string> {
    const [host, port] = address.split(":");
    if (!port) return address;
    if (net.isIP(host)) return address;
    const { address: ip } = await dns.lookup(host, { family: 4 });
    return `${ip}:${port}`;
  }

  onModuleDestroy() {
    this.client?.destroy();
  }

  async createAccount(userId: string): Promise<void> {
    const results = await this.client.createAccounts([
      this.buildAccount(
        this.toId(userId),
        USER_CODE,
        AccountFlags.debits_must_not_exceed_credits,
      ),
    ]);
    this.assertCreateAccounts(results);
  }

  async getBalanceCents(userId: string): Promise<number> {
    const accounts = await this.client.lookupAccounts([this.toId(userId)]);
    if (accounts.length === 0) return 0;
    const a = accounts[0];
    return Number(a.credits_posted - a.debits_posted - a.debits_pending);
  }

  async getBalance(userId: string): Promise<number> {
    const cents = await this.getBalanceCents(userId);
    return cents / 100;
  }

  async deposit(userId: string, amountCents: number): Promise<void> {
    await this.simpleTransfer(
      HOUSE_ID,
      this.toId(userId),
      amountCents,
      CODE_DEPOSIT,
    );
    await this.pushBalanceUpdated(userId);
  }

  async setBalance(userId: string, targetCents: number): Promise<void> {
    const currentCents = await this.getBalanceCents(userId);
    const diff = targetCents - currentCents;
    if (diff > 0) {
      await this.simpleTransfer(
        HOUSE_ID,
        this.toId(userId),
        diff,
        CODE_ADMIN_ADJUST,
      );
    } else if (diff < 0) {
      await this.simpleTransfer(
        this.toId(userId),
        HOUSE_ID,
        -diff,
        CODE_ADMIN_ADJUST,
      );
    }
    await this.pushBalanceUpdated(userId);
  }

  async hold(
    userId: string,
    betId: string,
    amountCents: number,
  ): Promise<void> {
    await this.createTransfers([
      {
        id: this.toId(betId),
        debit_account_id: this.toId(userId),
        credit_account_id: HOUSE_ID,
        amount: BigInt(amountCents),
        pending_id: 0n,
        user_data_128: this.toId(betId),
        user_data_64: 0n,
        user_data_32: 0,
        timeout: 0,
        ledger: LEDGER,
        code: CODE_BET,
        flags: TransferFlags.pending,
        timestamp: 0n,
      },
    ]);
    await this.pushBalanceUpdated(userId);
  }

  async release(
    userId: string,
    betId: string,
    amountCents: number,
  ): Promise<void> {
    await this.createTransfers([
      {
        id: tbId(),
        debit_account_id: this.toId(userId),
        credit_account_id: HOUSE_ID,
        amount: BigInt(amountCents),
        pending_id: this.toId(betId),
        user_data_128: this.toId(betId),
        user_data_64: 0n,
        user_data_32: 0,
        timeout: 0,
        ledger: LEDGER,
        code: CODE_BET,
        flags: TransferFlags.void_pending_transfer,
        timestamp: 0n,
      },
    ]);
    await this.pushBalanceUpdated(userId);
  }

  async keep(
    userId: string,
    betId: string,
    amountCents: number,
  ): Promise<void> {
    await this.createTransfers([
      {
        id: tbId(),
        debit_account_id: this.toId(userId),
        credit_account_id: HOUSE_ID,
        amount: BigInt(amountCents),
        pending_id: this.toId(betId),
        user_data_128: this.toId(betId),
        user_data_64: 0n,
        user_data_32: 0,
        timeout: 0,
        ledger: LEDGER,
        code: CODE_BET,
        flags: TransferFlags.post_pending_transfer,
        timestamp: 0n,
      },
    ]);
    await this.pushBalanceUpdated(userId);
  }

  async payout(
    userId: string,
    betId: string,
    amountCents: number,
  ): Promise<void> {
    await this.simpleTransfer(
      HOUSE_ID,
      this.toId(userId),
      amountCents,
      CODE_PAYOUT,
      this.toId(betId),
    );
    await this.pushBalanceUpdated(userId);
  }

  private async ensureSystemAccounts(): Promise<void> {
    const results = await this.client.createAccounts([
      this.buildAccount(HOUSE_ID, HOUSE_CODE),
    ]);
    this.assertCreateAccounts(results);
  }

  private async pushBalanceUpdated(userId: string): Promise<void> {
    const balance = await this.getBalance(userId);
    await this.notifications.toUser(userId, "balance.updated", { balance });
  }

  private buildAccount(
    id: bigint,
    code: number,
    flags: number = AccountFlags.none,
  ) {
    return {
      id,
      debits_pending: 0n,
      debits_posted: 0n,
      credits_pending: 0n,
      credits_posted: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      reserved: 0,
      ledger: LEDGER,
      code,
      flags,
      timestamp: 0n,
    };
  }

  private async simpleTransfer(
    debitId: bigint,
    creditId: bigint,
    amountCents: number,
    code: number,
    betId: bigint = 0n,
  ): Promise<void> {
    await this.createTransfers([
      {
        id: tbId(),
        debit_account_id: debitId,
        credit_account_id: creditId,
        amount: BigInt(amountCents),
        pending_id: 0n,
        user_data_128: betId,
        user_data_64: 0n,
        user_data_32: 0,
        timeout: 0,
        ledger: LEDGER,
        code,
        flags: TransferFlags.none,
        timestamp: 0n,
      },
    ]);
  }

  private async createTransfers(transfers: Transfer[]): Promise<void> {
    const results = await this.client.createTransfers(transfers);
    for (const r of results) {
      if (r.status !== CreateTransferStatus.created) {
        throw new Error(
          `TigerBeetle transfer failed: ${CreateTransferStatus[r.status]}`,
        );
      }
    }
  }

  private assertCreateAccounts(
    results: { status: CreateAccountStatus }[],
  ): void {
    for (const r of results) {
      if (
        r.status !== CreateAccountStatus.created &&
        r.status !== CreateAccountStatus.exists
      ) {
        throw new Error(
          `TigerBeetle account creation failed: ${CreateAccountStatus[r.status]}`,
        );
      }
    }
  }

  private toId(value: string): bigint {
    return BigInt(`0x${value.replace(/-/g, "")}`);
  }
}
