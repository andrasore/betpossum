import { ensureBinary } from "./tigerbeetle-harness";

export default async function globalSetup(): Promise<void> {
  await ensureBinary();
}
