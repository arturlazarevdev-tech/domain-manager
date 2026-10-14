import { processJob } from "./lib/jobs/processor";
import { redisEnabled, startWorker } from "./lib/jobs/queue";
import { prisma } from "./lib/db";

async function main() {
  if (redisEnabled()) {
    startWorker();
    console.log("BullMQ worker started");
    return;
  }

  console.log("REDIS_URL not set, polling database jobs");
  setInterval(async () => {
    const jobs = await prisma.job.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      take: 3,
    });
    for (const job of jobs) {
      await processJob(job.id);
    }
  }, 1500);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
