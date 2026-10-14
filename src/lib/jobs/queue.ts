import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@/lib/db";
import { processJob } from "./processor";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let workerStarted = false;

export function redisEnabled() {
  return Boolean(process.env.REDIS_URL);
}

function getConnection() {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getQueue() {
  if (!queue) {
    queue = new Queue("domain-jobs", { connection: getConnection() });
  }
  return queue;
}

export async function enqueueJob(jobId: string, type: string) {
  if (redisEnabled()) {
    await getQueue().add(type, { jobId }, { jobId, removeOnComplete: 100, attempts: 1 });
    return;
  }
  void processJob(jobId);
}

export function startWorker() {
  if (!redisEnabled() || workerStarted) return;
  workerStarted = true;
  new Worker(
    "domain-jobs",
    async (job) => {
      await processJob(String(job.data.jobId));
    },
    { connection: getConnection(), concurrency: 2 },
  );
}

export async function createAndEnqueueJob(type: string, payload: unknown) {
  const job = await prisma.job.create({
    data: { type, payload: payload as object, status: "queued" },
  });
  await enqueueJob(job.id, type);
  return job;
}
