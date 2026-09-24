import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {sendExport} from './publisher.js';
import {publicAgent} from './public-network.js';

const sample = (exportedAt=Date.now()/1000) => ({schemaVersion:2,historyMode:'closed-trades',exporterBuild:'1.11',portfolio:'A',platform:'MT5',login:'123456',currency:'CHF',balance:100,equity:75,connected:true,exportedAt,historyAvailable:true,lastTrade:{profit:50,swap:-3,closedAt:'2026.09.24 12:00:00',ticket:'private-ticket'},positionsComplete:true,positionCount:1,positions:[{symbol:'private-symbol',marketValue:1500}],marketValue:1500,fxToCHF:1,fxAgeSeconds:0});
test('Render mode: routes, authenticated publisher, freshness and private data', {timeout:60000}, async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'al-market-deploy-'));
 const token='test-only-012345678901234567890123456789';
 const child=spawn(process.execPath,[fileURLToPath(new URL('./server.js',import.meta.url))],{env:{...process.env,PORT:'3097',HOST:'127.0.0.1',PORTFOLIO_MODE:'remote',PORTFOLIO_UPLOAD_TOKEN:token,PORTFOLIO_DATA_DIR:directory,PORTFOLIO_TEST_MODE:'1',PORTFOLIO_A_LOGIN:'123456'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 const base='http://127.0.0.1:3097';
 const post=(body,secret=token)=>fetch(base+'/api/ingest/A',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify(body)});
 try{
  let ready=false;
  for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error('Server failed: '+logs);try{ready=(await fetch(base+'/healthz')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,logs);
  for(const route of ['/m1','/m1.html','/A/m1.html'])assert.equal((await fetch(base+route)).status,200);
  const redirect=await fetch(base+'/A/portfolio.html',{redirect:'manual'});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'/m1.html');
  for(const route of ['/.env','/A/config.js','/A/data/portfolio-A.json','/api/accounts','/api/set-session'])assert.equal((await fetch(base+route)).status,404);
  assert.equal((await post(sample(),'wrong')).status,401);
  assert.equal((await post(sample(Date.now()/1000-90))).status,400);
  assert.equal((await post({...sample(),login:'999'})).status,400);
  assert.equal((await post({...sample(),historyMode:'all-history'})).status,400);
  const raw=sample();
  await sendExport(base,token,'A',raw);
  const received=JSON.parse(await readFile(path.join(directory,'incoming','portfolio-A.json'),'utf8'));
  assert.equal(received.exportedAt,raw.exportedAt);
  await post({...raw,exportedAt:raw.exportedAt-1,equity:1});
  const pub=await (await fetch(base+'/api/portfolios')).json();
  assert.equal(pub.portfolios[0].strength,5);assert.equal(pub.portfolios[0].lastTrade.adjustedProfit,47);
  const text=JSON.stringify(pub);
  for(const secret of ['123456','private-ticket','private-symbol','positions','balance','marketValue'])assert.ok(!text.includes(secret),secret);
  received.exportedAt-=90;await writeFile(path.join(directory,'incoming','portfolio-A.json'),JSON.stringify(received));
  assert.equal((await (await fetch(base+'/api/portfolios')).json()).portfolios[0].state,'stale');
 }finally{
  const exited=new Promise(resolve=>child.once('exit',resolve));if(child.exitCode===null){child.kill();await exited;}
  publicAgent.destroy();
  assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'al-market-deploy-'));
  await rm(directory,{recursive:true,force:true});
 }
});
