import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // docker stop sends SIGTERM; enable shutdown hooks so Nest handles it
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 8000);
}

bootstrap();
