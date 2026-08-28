import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Client } from "pg";
import { AppModule } from "./app.module";

/**
 * TypeORM will create its tables but not the schema they live in, so a bare
 * database would fail on boot. infra's postgres/init.sh normally provisions it;
 * this is the idempotent self-provision the Python service also did.
 */
async function ensureSchema(): Promise<void> {
  const schema = process.env.DB_SCHEMA;
  const url = process.env.DATABASE_URL;
  if (!schema || !url) {
    return;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(
      `Refusing to create schema with unexpected name: ${schema}`,
    );
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  } finally {
    await client.end();
  }
}

async function bootstrap() {
  await ensureSchema();
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  // docker stop sends SIGTERM; enable shutdown hooks so Nest handles it
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 8000);
}

bootstrap();
