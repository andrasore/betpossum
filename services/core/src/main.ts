import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  // docker stop sends SIGTERM; enable shutdown hooks so Nest handles it
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000);
}

bootstrap();
