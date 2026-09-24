import './load-env.js';
import https from 'node:https';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { config } from './config.js';
import { validate } from './data.js';
import { publicAgent } from './public-network.js';

export function sendExport(base, token, id, payload) {
  const url = new URL('/api/ingest/' + id, base);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw Error('Koristiti HTTPS za udaljeni server.');
  if (url.username || url.password) throw Error('URL ne sme sadržati pristupne podatke.');
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {method:'POST', agent:url.protocol === 'https:' ? publicAgent : undefined,
      headers:{Authorization:'Bearer ' + token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, response => {
      response.resume();
      response.on('end', () => response.statusCode === 204 ? resolve() : reject(Error('Prijem podataka: HTTP ' + response.statusCode)));
      response.on('error', reject);
    });
    const deadline = setTimeout(() => request.destroy(Error('Isteklo vreme slanja')), 20000);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject); request.end(body);
  });
}
async function main() {
  const destination = process.env.PORTFOLIO_REMOTE_URL;
  const token = process.env.PORTFOLIO_UPLOAD_TOKEN;
  if (!destination || !token || token.length < 32) throw Error('Podesiti PORTFOLIO_REMOTE_URL i PORTFOLIO_UPLOAD_TOKEN u lokalnom .env fajlu.');
  if (config.mode !== 'local') throw Error('Publisher pokrenuti na računaru sa MT terminalima, u local režimu.');
  let running = true;
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { running = false; });
  let lastState = '';
  while (running) {
    const status = [];
    for (const [id, settings] of Object.entries(config.portfolios)) {
      try {
        const file = path.join(config.sourceDir, settings.file);
        const raw = validate(JSON.parse(await readFile(file, 'utf8')), id, settings);
        const info = await stat(file);
        if ((raw.schemaVersion !== 2 || raw.historyMode !== 'closed-trades')) throw Error('Ažurirati izvoznik na 1.11');
        if (Date.now() - raw.exportedAt * 1000 > config.staleAfterMs || Date.now() - info.mtimeMs > config.staleAfterMs) throw Error('Izvoz je zastareo');
        await sendExport(destination, token, id, raw);
        status.push(id + ': poslato');
      } catch (error) { status.push(id + ': ' + error.message); }
    }
    const state = status.join(' | ');
    if (state !== lastState) { console.log(state); lastState = state; }
    if (running) await new Promise(resolve => setTimeout(resolve, 5000));
  }
  publicAgent.destroy();
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); publicAgent.destroy(); process.exitCode = 1; });
