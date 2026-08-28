import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import amqp, { type Channel, type ChannelModel } from "amqplib";

export interface SubscribeOptions {
  durable?: boolean;
  queueName?: string;
  prefetch?: number;
}

interface Subscription {
  channel: string;
  handler: (msg: Buffer) => void | Promise<void>;
  opts: SubscribeOptions;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thin amqplib wrapper: fanout exchanges only, JSON bodies, and two subscriber
 * shapes — an anonymous exclusive auto-delete queue (fire-and-forget, `noAck`)
 * or a named durable queue with manual ack / nack-requeue.
 *
 * Unlike core's copy this one reconnects. The Python services it replaces got
 * that from `aio_pika.connect_robust`, and losing it would leave a long-lived
 * relay/consumer dead after any broker blip. Subscriptions are remembered and
 * re-declared on every (re)connect.
 */
@Injectable()
export class MessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private readonly url: string;
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private readonly subscriptions: Subscription[] = [];
  private readonly waiters: Array<(channel: Channel) => void> = [];
  private closing = false;

  constructor(config: ConfigService) {
    this.url = config.get<string>("RABBITMQ_URL", "amqp://localhost:5672");
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.open();
      this.logger.log("RabbitMQ connected");
    } catch (err) {
      // Don't block boot on the broker: keep retrying in the background so
      // /health answers and the process stays restartable by the orchestrator.
      this.logger.error("Initial RabbitMQ connect failed; retrying", err);
      void this.reconnect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    this.channel = this.connection = null;
  }

  async publish(
    channel: string,
    payload: Buffer,
    opts: { durable?: boolean } = {},
  ): Promise<void> {
    const durable = opts.durable ?? false;
    const ch = await this.channelReady();
    await ch.assertExchange(channel, "fanout", { durable });
    ch.publish(channel, "", payload, { persistent: durable });
  }

  async subscribe(
    channel: string,
    handler: (msg: Buffer) => void | Promise<void>,
    opts: SubscribeOptions = {},
  ): Promise<void> {
    if (opts.durable && !opts.queueName) {
      throw new Error(
        `subscribe(${channel}): durable subscribers must provide queueName`,
      );
    }
    const subscription: Subscription = { channel, handler, opts };
    this.subscriptions.push(subscription);
    if (this.channel) {
      await this.consume(this.channel, subscription);
    }
  }

  private async open(): Promise<void> {
    const connection = await amqp.connect(this.url);
    const channel = await connection.createChannel();
    connection.on("error", (e) =>
      this.logger.error("RabbitMQ connection error", e),
    );
    connection.on("close", () => this.handleClose());
    channel.on("error", (e) => this.logger.error("RabbitMQ channel error", e));

    this.connection = connection;
    this.channel = channel;
    // Re-declare everything: after a reconnect the broker has forgotten our
    // anonymous queues and consumers entirely.
    for (const subscription of this.subscriptions) {
      await this.consume(channel, subscription);
    }
    for (const waiter of this.waiters.splice(0)) {
      waiter(channel);
    }
  }

  private handleClose(): void {
    if (this.closing) {
      return;
    }
    this.connection = this.channel = null;
    this.logger.warn("RabbitMQ connection closed; reconnecting");
    void this.reconnect();
  }

  private async reconnect(): Promise<void> {
    for (let attempt = 0; !this.closing; attempt += 1) {
      await sleep(Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt));
      if (this.closing) {
        return;
      }
      try {
        await this.open();
        this.logger.log("RabbitMQ reconnected");
        return;
      } catch (err) {
        this.logger.error("RabbitMQ reconnect failed", err);
      }
    }
  }

  private channelReady(): Promise<Channel> {
    if (this.channel) {
      return Promise.resolve(this.channel);
    }
    return new Promise<Channel>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private async consume(
    channel: Channel,
    { channel: exchange, handler, opts }: Subscription,
  ): Promise<void> {
    const durable = opts.durable ?? false;
    if (opts.prefetch !== undefined) {
      await channel.prefetch(opts.prefetch);
    }
    await channel.assertExchange(exchange, "fanout", { durable });
    const { queue } = await channel.assertQueue(opts.queueName ?? "", {
      exclusive: !opts.queueName,
      autoDelete: !opts.queueName,
      durable,
    });
    await channel.bindQueue(queue, exchange, "");
    await channel.consume(
      queue,
      (msg) => {
        if (!msg) {
          return;
        }
        if (durable) {
          Promise.resolve()
            .then(() => handler(msg.content))
            .then(
              () => channel.ack(msg),
              (err) => {
                this.logger.error(
                  `Handler for ${exchange} failed; requeuing`,
                  err,
                );
                channel.nack(msg, false, true);
              },
            );
        } else {
          handler(msg.content);
        }
      },
      { noAck: !durable },
    );
  }
}
