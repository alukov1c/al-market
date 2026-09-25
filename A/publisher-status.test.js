import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {publisherStatus} from './publisher-status.js';
test('Publisher lifecycle, restart persistence, stale heartbeat and replay protection', async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'publisher-state-'));
 try {
  const config={dataDir,staleAfterMs:30000};
  const store=publisherStatus(config);
  assert.equal(await store.snapshot(),null);
  const now=Date.now();
  const body={session:'11111111-1111-1111-1111-111111111111',startedAt:now-1000,eventAt:now,state:'running'};
  assert.throws(()=>store.event({...body,eventAt:now-60000}));
  await store.event(body);
  assert.equal((await store.snapshot()).state,'running');
  await store.received();
  const received=(await store.snapshot()).lastReceivedAt;
  await store.event({...body,state:'stopped',eventAt:now+1});
  assert.equal((await store.snapshot()).stoppedAt,now+1);
  await store.event({...body,eventAt:now+2});
  assert.equal((await publisherStatus(config).snapshot()).state,'stopped');
  await store.event({...body,session:'22222222-2222-2222-2222-222222222222',startedAt:now+3,eventAt:now+3});
  assert.equal((await store.snapshot()).state,'running');
  await store.event({...body,state:'stopped',eventAt:now+4});
  assert.equal((await store.snapshot()).state,'running');
  const offline=await publisherStatus({...config,staleAfterMs:-1}).snapshot();
  assert.equal(offline.state,'offline');assert.equal(offline.lastReceivedAt,received);
 } finally {await rm(dataDir,{recursive:true,force:true});}
});
