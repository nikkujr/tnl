import { db } from "./database/connection.js";
import { config } from "./config.js";
import {
  claim,
  execute,
  scan,
  heartbeat,
} from "./features/automations/worker.js";
let stopping = false,
  lastScan = 0;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
while (!stopping) {
  try {
    await heartbeat();
    if (Date.now() - lastScan >= 60000) {
      await scan();
      lastScan = Date.now();
    }
    const run = await claim();
    if (run) await execute(run);
    else
      await new Promise((resolve) =>
        setTimeout(resolve, config.WORKER_POLL_MS),
      );
  } catch (error) {
    console.error("Worker failure", error);
    await heartbeat(String(error).slice(0, 1000)).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_MS));
  }
}
await db.end();
