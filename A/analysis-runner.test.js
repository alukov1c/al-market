import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createAnalysisRunner, scheduledDay } from './analysis-runner.js';

test('Belgrade 08:00 boundary in summer and winter', () => {
  assert.equal(scheduledDay(new Date('2026-09-26T05:59:59Z')), null);
  assert.equal(scheduledDay(new Date('2026-09-26T06:00:00Z')), '2026-09-26');
  assert.equal(scheduledDay(new Date('2026-01-26T06:59:59Z')), null);
  assert.equal(scheduledDay(new Date('2026-01-26T07:00:00Z')), '2026-01-26');
});

test('Missed schedule, retries, concurrent requests and restart deduplication', async () => {
  const reports = [];
  let fail = true;
  const options = {
    now: () => new Date('2026-09-26T10:00:00Z'),
    readReports: async () => reports,
    generate: async () => { if (fail) throw Error('network'); return {id: reports.length}; },
    saveReport: async report => { reports.push(report); }
  };
  const runner = createAnalysisRunner(options);
  await assert.rejects(runner.run(true), /network/);
  fail = false;
  await Promise.all([runner.run(true), runner.run(true), runner.run()]);
  assert.equal(reports.length, 2);
  assert.equal(reports[0].scheduledDay, '2026-09-26');
  assert.equal(reports[1].scheduledDay, undefined);
  await createAnalysisRunner(options).run(true);
  assert.equal(reports.length, 2);
});

test('Manual button reaches API and recovers after HTTP failure', async () => {
  const source = await readFile(new URL('./market.js', import.meta.url), 'utf8');
  const fragment = source.slice(source.indexOf('async function generateSelfAnalysisNow()'), source.indexOf('function renderAnalysis(report)'));
  const button = { disabled: false }, summary = {};
  let ok = false, rendered = false, requests = 0;
  const context = vm.createContext({
    document: { getElementById: id => id === 'btnGenALmeh' ? button : summary },
    fetch: async url => { assert.equal(url, '/api/self-analysis/generate'); requests++; return {ok, json: async () => ({signal:'WAIT'})}; },
    renderAnalysis: () => { rendered = true; }, loadAnalysisHistory: async () => {},
    analysisHistorySelected: true
  });
  vm.runInContext(fragment, context);
  await context.generateSelfAnalysisNow();
  assert.match(summary.textContent, /nije generisana/);
  assert.equal(button.disabled, false);
  ok = true;
  await context.generateSelfAnalysisNow();
  assert.equal(requests, 2);
  assert.equal(rendered, true);
  assert.equal(button.disabled, false);
});
