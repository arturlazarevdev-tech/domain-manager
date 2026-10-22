import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Redis from 'ioredis';
import { OpenproviderRateLimiter, OpenproviderRateLimitError } from '../src/lib/integrations/registrars/openprovider/rate-limit';
const policy = { spacing: 3, registration: 90, check: 60, auth: 30, lease: 150, concurrency: 2 };
async function verify(first: OpenproviderRateLimiter, second: OpenproviderRateLimiter, key: string) {
  const times: number[] = [];
  await Promise.all([first, second, first].map(async limiter => {
    const release = await limiter.acquire(key, 'registration', randomUUID());
    times.push(Date.now()); await release();
  }));
  times.sort((a,b)=>a-b);
  assert(times[1]-times[0]>=80 && times[2]-times[1]>=80, 'Registration spacing is shared across instances and domain names');
  const release = await first.acquire(key+'checks', 'check', 'same-payload');await release();
  const started = Date.now();const secondRelease = await second.acquire(key+'checks', 'check', 'same-payload');
  assert(Date.now()-started>=45, 'Identical checks respect a separate limit');await secondRelease();
  let active=0,max=0;
  await Promise.all([first,second,first,second].map(async limiter=>{
    const done=await limiter.acquire(key+'concurrency','other',randomUUID());active++;max=Math.max(max,active);
    await delay(25);active--;await done();
  }));
  assert(max<=2,'Concurrent requests are bounded across clients');
  await first.block(key,80);
  await assert.rejects(second.acquire(key,'other','read'),e=>e instanceof OpenproviderRateLimitError&&e.status===429&&e.waitMs>0);
  const other=await second.acquire(key+'independent','other','read');await other();
  await delay(90);const resumed=await second.acquire(key,'other','read');await resumed();
}
async function main() {
  const memory=new OpenproviderRateLimiter(undefined,policy);await verify(memory,memory,'memory');
  await memory.acquire('expired','other','one');await memory.acquire('expired','other','two');
  await delay(160);const reclaimed=await memory.acquire('expired','other','three');await reclaimed();
  if(process.env.TEST_REDIS_URL){
    const url=new URL(process.env.TEST_REDIS_URL);
    assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'33007','Only the isolated rate-limit test Redis is allowed');
    const r1=new Redis(url.toString()),r2=new Redis(url.toString());const key='test-'+randomUUID();
    try{await verify(new OpenproviderRateLimiter(r1,policy),new OpenproviderRateLimiter(r2,policy),key);}
    finally{const keys=await r1.keys(`openprovider:api:${key}*`);if(keys.length)await r1.del(...keys);await Promise.all([r1.quit(),r2.quit()]);}
  }
  console.log('PASS: shared registration/check spacing, bounded concurrency, cooldown, independent accounts, expired lease recovery'+(process.env.TEST_REDIS_URL?' and atomic coordination via two Redis connections.':'.'));
}
main().catch(e=>{console.error(e);process.exitCode=1});
