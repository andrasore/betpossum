import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const dir = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: ["./dist/main.js"],
  bundle: true,
  platform: "node",
  format: "cjs",
  nodePaths: [
    resolve(dir, "./node_modules"),
    resolve(dir, "../../node_modules"),
  ],
  external: [
    "amqp-connection-manager",
    "amqplib",
    //'class-transformer',
    //'class-validator',
    "@grpc/grpc-js",
    "@grpc/proto-loader",
    //'ioredis',
    "kafkajs",
    "mqtt",
    "nats",
    //'@nestjs/platform-express',
    "@nestjs/websockets/socket-module",
  ],
  outfile: "./dist/bundle.js",
});
