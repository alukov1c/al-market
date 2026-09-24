import './load-env.js';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const remote = process.env.PORTFOLIO_MODE === 'remote' || process.env.RENDER === 'true';
const dataDir = process.env.PORTFOLIO_DATA_DIR || fileURLToPath(new URL('./data/', import.meta.url));
export const config = {
  mode: remote ? 'remote' : 'local',
  host: process.env.HOST || (remote ? '0.0.0.0' : '127.0.0.1'),
  port: Number(process.env.PORT || process.env.PORTFOLIO_PORT || 3081),
  uploadToken: process.env.PORTFOLIO_UPLOAD_TOKEN || '',
  dataDir,
  sourceDir: process.env.PORTFOLIO_SOURCE_DIR || (remote ? path.join(dataDir, 'incoming') : path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'MetaQuotes', 'Terminal', 'Common', 'Files', 'al-market')),
  staleAfterMs: 30000,
  portfolios: {
    A: { platform: 'MT5', file: 'portfolio-A.json', expectedLogin: process.env.PORTFOLIO_A_LOGIN || null },
    B: { platform: 'MT4', file: 'portfolio-B.json', expectedLogin: process.env.PORTFOLIO_B_LOGIN || null }
  }
};
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw Error('Neispravan PORT');
if (remote && config.uploadToken.length < 32) throw Error('Render zahteva PORTFOLIO_UPLOAD_TOKEN od najmanje 32 znaka.');
