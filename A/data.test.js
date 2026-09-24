import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPortfolio, snapshot, validate } from './data.js';
const settings = { platform: 'MT5', file: 'portfolio-A.json', expectedLogin: null, marketValue: null };
const sample = overrides => ({ portfolio: 'A', platform: 'MT5', historyMode: 'closed-trades', login: '123', currency: 'CHF', balance: 100, equity: 75,
  connected: true, exportedAt: Date.now()/1000, historyAvailable: true, lastTrade: null, fxToCHF: null, fxAgeSeconds: 0, ...overrides });
async function fixture(fn) {
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), 'al-market-test-'));
  try { await fn({ sourceDir, staleAfterMs: 30000, portfolios: { A: settings, B: { ...settings, platform: 'MT4', file: 'portfolio-B.json' } } }); }
  finally { await rm(sourceDir, { recursive: true, force: true }); }
}
async function put(c, id, data) { await writeFile(path.join(c.sourceDir, `portfolio-${id}.json`), JSON.stringify(data)); }
test('Missing and malformed source do not become zero balances', () => fixture(async c => {
  assert.equal((await readPortfolio('A', settings, c)).state, 'waiting');
  await writeFile(path.join(c.sourceDir, settings.file), '{');
  assert.equal((await readPortfolio('A', settings, c)).state, 'error');
}));
test('Level, currency, zero profit and negative equity are preserved', () => fixture(async c => {
  await put(c, 'A', sample({ lastTrade: { profit: 0, closedAt: '2026.09.24 12:00:00' } }));
  let p = await readPortfolio('A', settings, c);
  assert.equal(p.level, 75); assert.equal(p.lastTrade.profit, 0); assert.equal(p.equityCHF, 75);
  await put(c, 'A', sample({ balance: 0 })); assert.equal((await readPortfolio('A', settings, c)).level, null);
  await put(c, 'A', sample({ equity: -10 })); assert.equal((await readPortfolio('A', settings, c)).level, -10);
}));
test('Stale, future and disconnected data are not live', () => fixture(async c => {
  for (const values of [{ exportedAt: Date.now()/1000-60 }, { exportedAt: Date.now()/1000+60 }, { connected: false }]) {
    await put(c, 'A', sample(values)); assert.notEqual((await readPortfolio('A', settings, c)).state, 'live');
  }
  await put(c, 'A', sample()); const old = new Date(Date.now()-60000);
  await utimes(path.join(c.sourceDir, settings.file), old, old);
  assert.equal((await readPortfolio('A', settings, c)).state, 'stale');
}));
test('Different currencies require a fresh conversion quote', () => fixture(async c => {
  await put(c, 'A', sample());
  const b = { portfolio: 'B', platform: 'MT4', currency: 'AUD', equity: 200 };
  await put(c, 'B', sample(b)); assert.equal((await snapshot(c)).combined.value, null);
  await put(c, 'B', sample({ ...b, fxToCHF: 0.5 })); assert.equal((await snapshot(c)).combined.value, 175);
  await put(c, 'B', sample({ ...b, fxToCHF: 0.5, fxAgeSeconds: 121 })); assert.equal((await snapshot(c)).combined.value, null);
}));
test('Account identity and numeric types are validated', () => {
  assert.throws(() => validate(sample(), 'B', settings));
  assert.throws(() => validate(sample({ equity: '75' }), 'A', settings));
  assert.throws(() => validate(sample(), 'A', { ...settings, expectedLogin: '999' }));
});

test('User formula uses live total exposure and signed swap', () => fixture(async c => {
  await put(c, 'A', sample({schemaVersion:2, positionsComplete:true, positionCount:2, positions:[{marketValue:600},{marketValue:900}], marketValue:1500,
    lastTrade:{profit:50,swap:-3,closedAt:'2026.09.24 12:00:00'}}));
  let p=await readPortfolio('A',settings,c);
  assert.equal(p.strength,5);
  assert.equal(p.lastTrade.adjustedProfit,47);
  await put(c,'A',sample({lastTrade:{profit:50,swap:3,closedAt:'2026.09.24 12:00:00'}}));
  assert.equal((await readPortfolio('A',settings,c)).lastTrade.adjustedProfit,53);
}));
test('Missing quote, no positions, or old exporter never use manual exposure', () => fixture(async c => {
  for(const values of [{}, {schemaVersion:2, positionsComplete:false, positionCount:1,positions:[],marketValue:null},
    {schemaVersion:2,positionsComplete:true,positionCount:0,positions:[],marketValue:0}]) {
    await put(c,'A',sample(values));
    assert.equal((await readPortfolio('A',{...settings,marketValue:100},c)).strength,null);
  }
  await put(c,'A',sample({lastTrade:{profit:50,closedAt:'2026.09.24 12:00:00'}}));
  assert.equal((await readPortfolio('A',settings,c)).lastTrade.adjustedProfit,null);
}));
