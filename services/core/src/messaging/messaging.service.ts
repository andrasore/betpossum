import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import amqp, { type Channel, type ChannelModel } from "amqplib";

@Injectable()
export class MessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private readonly url: string;
  private connection!: ChannelModel;
  private channel!: Channel;

  constructor(config: ConfigService) {
    this.url = config.get<string>("RABBITMQ_URL", "amqp://localhost:5672");
  }

  async onModuleInit(): Promise<void> {
    this.connection = await amqp.connect(this.url);
    this.connection.on("error", (e) =>
      this.logger.error("RabbitMQ connection error", e),
    );
    this.channel = await this.connection.createChannel();
    this.channel.on("error", (e) =>
      this.logger.error("RabbitMQ channel error", e),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  async publish(
    channel: string,
    payload: Buffer,
    opts: { durable?: boolean } = {},
  ): Promise<void> {
    const durable = opts.durable ?? false;
    await this.channel.assertExchange(channel, "fanout", { durable });
    this.channel.publish(channel, "", payload, { persistent: durable });
  }

  async subscribe(
    channel: string,
    handler: (msg: Buffer) => void | Promise<void>,
    opts: { durable?: boolean; queueName?: string } = {},
  ): Promise<void> {
    const durable = opts.durable ?? false;
    if (durable && !opts.queueName) {
      throw new Error(
        `subscribe(${channel}): durable subscribers must provide queueName`,
      );
    }
    await this.channel.assertExchange(channel, "fanout", { durable });
    const { queue } = await this.channel.assertQueue(opts.queueName ?? "", {
      exclusive: !opts.queueName,
      autoDelete: !opts.queueName,
      durable,
    });
    await this.channel.bindQueue(queue, channel, "");
    await this.channel.consume(
      queue,
      (msg) => {
        if (!msg) return;
        if (durable) {
          Promise.resolve()
            .then(() => handler(msg.content))
            .then(
              () => this.channel.ack(msg),
              (err) => {
                this.logger.error(
                  `Handler for ${channel} failed; requeuing`,
                  err,
                );
                this.channel.nack(msg, false, true);
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
