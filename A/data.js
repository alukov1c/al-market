import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function validate(raw, id, settings) {
  if (!raw || raw.portfolio !== id || raw.platform !== settings.platform ||
      typeof raw.login !== 'string' || !/^\d+$/.test(raw.login) ||
      typeof raw.currency !== 'string' || !/^[A-Z][A-Z0-9]{1,11}$/.test(raw.currency) ||
      !finite(raw.balance) || !finite(raw.equity) || !finite(raw.exportedAt) ||
      typeof raw.connected !== 'boolean' || typeof raw.historyAvailable !== 'boolean') throw Error('Neispravan format podataka');
  if (settings.expectedLogin !== null && String(settings.expectedLogin) !== raw.login) throw Error('Račun ne odgovara podešavanju');
  if (raw.lastTrade !== null && (!raw.lastTrade || !finite(raw.lastTrade.profit) ||
      typeof raw.lastTrade.closedAt !== 'string' || !/^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}$/.test(raw.lastTrade.closedAt))) throw Error('Neispravna poslednja trgovina');
  if (raw.lastTrade?.swap !== undefined && !finite(raw.lastTrade.swap)) throw Error('Neispravan swap');
  if (raw.schemaVersion === 2 && (typeof raw.positionsComplete !== 'boolean' ||
      !Number.isInteger(raw.positionCount) || raw.positionCount < 0 || !Array.isArray(raw.positions) ||
      (raw.positionsComplete && (!finite(raw.marketValue) || raw.marketValue < 0)))) throw Error('Neispravna tržišna vrednost');
  return raw;
}
export async function readPortfolio(id, settings, config, now = Date.now()) {
  try {
    const filename = path.join(config.sourceDir, settings.file);
    const raw = validate(JSON.parse(await readFile(filename, 'utf8')), id, settings);
    const info = await stat(filename);
    const age = now - raw.exportedAt * 1000;
    const state = !raw.connected ? 'disconnected' : age < -5000 || age > config.staleAfterMs || now - info.mtimeMs > config.staleAfterMs ? 'stale' : 'live';
    const level = raw.balance > 0 ? raw.equity / raw.balance * 100 : null;
    const lastQuote = raw.conversionPolicy === 'last-broker-quote';
    const conversionAgeSeconds = Math.max(0, finite(raw.fxAgeSeconds) && raw.currency !== 'CHF' ? raw.fxAgeSeconds : 0);
    const positionsFxAgeSeconds = finite(raw.positionsFxAgeSeconds) ? Math.max(0, raw.positionsFxAgeSeconds) : 0;
    const rate = raw.currency === 'CHF' ? 1 : finite(raw.fxToCHF) && raw.fxToCHF > 0 && finite(raw.fxAgeSeconds) && raw.fxAgeSeconds >= 0 && (raw.fxAgeSeconds <= 120 || lastQuote) ? raw.fxToCHF : null;
    return { id, platform: raw.platform, state, currency: raw.currency, balance: raw.balance,
      equity: raw.equity, level: finite(level) ? level : null, exportedAt: raw.exportedAt * 1000,
      historyAvailable: raw.historyAvailable,
      lastTrade: raw.lastTrade ? { ...raw.lastTrade, adjustedProfit: raw.historyMode === 'closed-trades' && finite(raw.lastTrade.swap) ? raw.lastTrade.profit + raw.lastTrade.swap : null } : null,
      marketValue: raw.positionsComplete === true && finite(raw.marketValue) ? raw.marketValue : null,
      positionCount: raw.positionCount ?? null,
      positions: raw.positions ?? [],
      exporterVersion: raw.schemaVersion ?? 1,
      exporterBuild: raw.exporterBuild ?? '1.00',
      conversionAgeSeconds, positionsFxAgeSeconds,
      conversionQuoteTime: raw.currency !== 'CHF' && typeof raw.fxQuoteTime === 'string' && /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}$/.test(raw.fxQuoteTime) ? raw.fxQuoteTime : null,
      strengthQuoteTime: typeof raw.positionsFxQuoteTime === 'string' && /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}$/.test(raw.positionsFxQuoteTime) ? raw.positionsFxQuoteTime : null,
      conversionUsesLastQuote: lastQuote && conversionAgeSeconds > 120,
      strengthUsesLastQuote: lastQuote && positionsFxAgeSeconds > 120,
      equityCHF: rate === null ? null : raw.equity * rate,
      strength: raw.positionsComplete === true && finite(raw.marketValue) && raw.marketValue > 0 ? raw.equity / raw.marketValue * 100 : null };
  } catch (error) {
    return { id, platform: settings.platform, state: error.code === 'ENOENT' ? 'waiting' : 'error' };
  }
}
export async function snapshot(config) {
  const portfolios = await Promise.all(Object.entries(config.portfolios).map(([id, settings]) => readPortfolio(id, settings, config)));
  const ready = portfolios.every(p => p.state === 'live' && Number.isFinite(p.equityCHF));
  const quoteTimes = portfolios.filter(p => p.currency !== 'CHF').map(p => p.conversionQuoteTime);
  const quoteTime = ready && quoteTimes.length && quoteTimes.every(Boolean) ? quoteTimes.sort()[0] : null;
  return { portfolios, combined: { currency: 'CHF', quoteTime, usesLastQuote: portfolios.some(p => p.conversionUsesLastQuote), quoteAgeSeconds: Math.max(0, ...portfolios.map(p => p.conversionAgeSeconds || 0)), value: ready ? portfolios.reduce((sum, p) => sum + p.equityCHF, 0) : null,
    sampledAt: ready ? Math.max(...portfolios.map(p => p.exportedAt)) : null } };
}

export function publicSnapshot(data) {
  return {
    combined: data.combined,
    portfolios: data.portfolios.map(p => ({
      id:p.id, platform:p.platform, state:p.state, currency:p.currency, level:p.level,
      exportedAt:p.exportedAt, historyAvailable:p.historyAvailable, exporterVersion:p.exporterVersion, exporterBuild:p.exporterBuild,
      strength:p.strength, strengthUsesLastQuote:p.strengthUsesLastQuote, strengthQuoteAgeSeconds:p.positionsFxAgeSeconds, strengthQuoteTime:p.strengthQuoteTime,
      lastTrade:p.lastTrade ? {profit:p.lastTrade.profit, swap:p.lastTrade.swap,
        adjustedProfit:p.lastTrade.adjustedProfit, closedAt:p.lastTrade.closedAt} : null
    }))
  };
}
