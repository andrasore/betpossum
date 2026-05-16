import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as dns } from 'node:dns';
import * as net from 'node:net';
import {
  AccountFlags,
  Client,
  CreateAccountStatus,
  CreateTransferStatus,
  TransferFlags,
  createClient,
  id as tbId,
} from 'tigerbeetle-node';
import { NotificationsClient } from '../notifications/notifications.client';

const ESCROW_ID = 1n;
const HOUSE_ID = 2n;

const LEDGER = 1;

const CODE_HOLD = 1;
const CODE_RELEASE = 2;
const CODE_PAYOUT = 3;
const CODE_KEEP = 4;
const CODE_DEPOSIT = 5;

const ESCROW_CODE = 100;
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
    const address = this.config.get<string>('TIGERBEETLE_ADDRESS', 'localhost:6000');
    const resolved = await this.resolveAddress(address);
    const clusterId = BigInt(this.config.get<string>('TIGERBEETLE_CLUSTER_ID', '0'));
    this.logger.log(`Connecting to TigerBeetle cluster=${clusterId} address=${resolved}`);
    this.client = createClient({ cluster_id: clusterId, replica_addresses: [resolved] });
    await this.ensureSystemAccounts();
  }

  private async resolveAddress(address: string): Promise<string> {
    const [host, port] = address.split(':');
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
      this.buildAccount(this.toId(userId), USER_CODE),
    ]);
    this.assertCreateAccounts(results);
  }

  async getBalance(userId: string): Promise<number> {
    const cents = await this.getBalanceCents(userId);
    return cents / 100;
  }

  async deposit(userId: string, amountCents: number): Promise<void> {
    await this.transfer(HOUSE_ID, this.toId(userId), amountCents, CODE_DEPOSIT);
    await this.pushBalanceUpdated(userId);
  }

  async hold(userId: string, betId: string, amountCents: number): Promise<void> {
    await this.transfer(this.toId(userId), ESCROW_ID, amountCents, CODE_HOLD, this.toId(betId));
    await this.pushBalanceUpdated(userId);
  }

  async release(userId: string, betId: string, amountCents: number): Promise<void> {
    await this.transfer(ESCROW_ID, this.toId(userId), amountCents, CODE_RELEASE, this.toId(betId));
    await this.pushBalanceUpdated(userId);
  }

  async payout(userId: string, betId: string, amountCents: number): Promise<void> {
    await this.transfer(HOUSE_ID, this.toId(userId), amountCents, CODE_PAYOUT, this.toId(betId));
    await this.pushBalanceUpdated(userId);
  }

  async keep(betId: string, amountCents: number): Promise<void> {
    await this.transfer(ESCROW_ID, HOUSE_ID, amountCents, CODE_KEEP, this.toId(betId));
  }

  private async ensureSystemAccounts(): Promise<void> {
    const results = await this.client.createAccounts([
      this.buildAccount(ESCROW_ID, ESCROW_CODE),
      this.buildAccount(HOUSE_ID, HOUSE_CODE),
    ]);
    this.assertCreateAccounts(results);
  }

  private async getBalanceCents(userId: string): Promise<number> {
    const accounts = await this.client.lookupAccounts([this.toId(userId)]);
    if (accounts.length === 0) return 0;
    const a = accounts[0];
    return Number(a.credits_posted - a.debits_posted);
  }

  private async pushBalanceUpdated(userId: string): Promise<void> {
    const balance = await this.getBalance(userId);
    await this.notifications.toUser(userId, 'balance.updated', { balance });
  }

  private buildAccount(id: bigint, code: number) {
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
      flags: AccountFlags.none,
      timestamp: 0n,
    };
  }

  private async transfer(
    debitId: bigint,
    creditId: bigint,
    amountCents: number,
    code: number,
    betId: bigint = 0n,
  ): Promise<void> {
    const results = await this.client.createTransfers([
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
    for (const r of results) {
      if (r.status !== CreateTransferStatus.created) {
        throw new Error(`TigerBeetle transfer failed: ${CreateTransferStatus[r.status]}`);
      }
    }
  }

  private assertCreateAccounts(results: { status: CreateAccountStatus }[]): void {
    for (const r of results) {
      if (r.status !== CreateAccountStatus.created && r.status !== CreateAccountStatus.exists) {
        throw new Error(`TigerBeetle account creation failed: ${CreateAccountStatus[r.status]}`);
      }
    }
  }

  private toId(value: string): bigint {
    return BigInt('0x' + value.replace(/-/g, ''));
  }
}
