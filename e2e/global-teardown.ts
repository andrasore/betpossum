import { captureLogs, compose } from "./compose";

export default async function globalTeardown(): Promise<void> {
  console.log("→ Capturing docker logs");
  captureLogs();
  if (process.env.E2E_KEEP_STACK === "1") {
    console.log("→ E2E_KEEP_STACK=1 — leaving stack running");
    return;
  }
  console.log("→ Tearing down e2e stack");
  compose(["down", "--volumes"]);
}
