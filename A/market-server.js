import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fsp from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import cron from 'node-cron';
import { fetchPublic, publicAgent } from './public-network.js';
import { createAnalysisRunner } from './analysis-runner.js';

// Izdvajanje postojeće tržišne logike i čuvanje podataka unutar A.
export function installMarket(app, server) {
const dataDir = process.env.PORTFOLIO_DATA_DIR || fileURLToPath(new URL('./data/', import.meta.url));
const SELF_ANALYSIS_CRON_EXPRESSION = "00 08 * * *";
const SELF_ANALYSIS_CRON_TIMEZONE = "Europe/Belgrade";

const selfAnalysisCronTask = cron.schedule(SELF_ANALYSIS_CRON_EXPRESSION, async () => {
  console.log("Generisanje dnevne A-L Market analize...");

  try {
    await analysisRunner.run(true);
  } catch (error) { console.warn('Dnevna analiza nije generisana:', error.message); }
}, {
  timezone: SELF_ANALYSIS_CRON_TIMEZONE
});

const wss = new WebSocketServer({ server });

let marketTick = {
  t: Date.now(),
  btc: {
    price: null,
    changePercent: null
  },
  eth: {
    price: null,
    changePercent: null
  },
  sol: {
    price: null,
    changePercent: null
  },
  note: "init"
};

function broadcastMarketTick() {
  const payload = JSON.stringify({
    type: "market",
    data: marketTick
  });

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on("connection", (ws) => {
  console.log("WS klijent povezan.");

  ws.send(JSON.stringify({
    type: "market",
    data: marketTick
  }));

  ws.on("close", () => {
    console.log("WS klijent diskonektovan.");
  });

  ws.on("error", (err) => {
    console.warn("WS client error:", err.message);
  });
});

let binanceWs = null;
let reconnectTimer = null;
let restTimer = null;
let restInFlight = null;

// Prijem samo potpunih numeričkih kotacija i čuvanje vremena za svaki simbol.
function acceptTicker(data, source) {
  const key = { BTCUSDT: 'btc', ETHUSDT: 'eth', SOLUSDT: 'sol' }[data?.s ?? data?.symbol];
  const price = Number(data?.c ?? data?.lastPrice);
  const changePercent = Number(data?.P ?? data?.priceChangePercent);
  if (!key || !Number.isFinite(price) || price <= 0 || !Number.isFinite(changePercent)) return;
  marketTick[key] = { price, changePercent, updatedAt: Date.now() };
  marketTick.t = Date.now(); marketTick.note = source;
}
function refreshMarketRest() {
  if (restInFlight) return restInFlight;
  restInFlight = (async () => {
  try {
    const symbols = encodeURIComponent(JSON.stringify(['BTCUSDT','ETHUSDT','SOLUSDT']));
    const response = await fetchPublic('https://data-api.binance.vision/api/v3/ticker/24hr?symbols=' + symbols);
    if (!response.ok) throw Error('Binance HTTP ' + response.status);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw Error('Neispravne Binance kotacije');
    rows.forEach(row => acceptTicker(row, 'binance REST'));
    broadcastMarketTick();
  } catch (error) { console.warn('Binance REST:', error.message); }
  finally { restInFlight = null; }
  })();
  return restInFlight;
}
function connectBinanceMarketStream() {
  if (binanceWs && [WebSocket.OPEN, WebSocket.CONNECTING].includes(binanceWs.readyState)) return;
  binanceWs = new WebSocket('wss://data-stream.binance.vision/stream?streams=btcusdt@ticker/ethusdt@ticker/solusdt@ticker', { agent: publicAgent, handshakeTimeout: 10000 });
  binanceWs.on('open', () => console.log('Binance market WS povezan.'));
  binanceWs.on('message', raw => {
    try { acceptTicker(JSON.parse(raw.toString()).data, 'binance WS'); broadcastMarketTick(); }
    catch (error) { console.warn('Binance WS:', error.message); }
  });
  binanceWs.on('close', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectBinanceMarketStream, 10000);
  });
  binanceWs.on('error', error => console.warn('Binance WS:', error.message));
}

app.get("/api/market", (_req, res) => {
  res.json(marketTick);
});

const baseCache = new Map();
async function fetchMarketBasePrice(symbol, days) {
  const key = symbol + ':' + days;
  const cached = baseCache.get(key);
  if (cached && Date.now() - cached.at < 60000) return cached.value;
  const limit = days + 1;
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1d&limit=${limit}`;

  const res = await fetchPublic(url, {
    headers: {
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`Binance klines HTTP ${res.status} za ${symbol}`);
  }

  const rows = await res.json();

  if (!Array.isArray(rows) || rows.length < limit) {
    throw new Error(`Nedovoljno kline podataka za ${symbol}`);
  }

  // rows[0]: najstarija od poslednjih 8 dnevnih sveća
  // Upotreba cene zatvaranja (close) od pre ~7 dana kao osnove (baze)
  const baseClose = Number(rows[0][4]);

  if (!Number.isFinite(baseClose) || baseClose <= 0) {
    throw new Error(`Neispravna ${days}d baza za ${symbol}`);
  }

  baseCache.set(key, {at:Date.now(), value:baseClose});
  return baseClose;
}

async function fetch7dBasePrice(symbol) {
  return fetchMarketBasePrice(symbol, 7);
}

async function fetch30dBasePrice(symbol) {
  return fetchMarketBasePrice(symbol, 30);
}

app.get("/api/market-7d", async (_req, res) => {
  try {
    const [btcBase, ethBase, solBase] = await Promise.all([
      fetch7dBasePrice("BTCUSDT"),
      fetch7dBasePrice("ETHUSDT"),
      fetch7dBasePrice("SOLUSDT")
    ]);

    res.json({
      ok: true,
      ts: Date.now(),
      btcBase,
      ethBase,
      solBase
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      ts: Date.now(),
      error: String(err?.message || err),
      btcBase: null,
      ethBase: null,
      solBase: null
    });
  }
});

app.get("/api/market-30d", async (_req, res) => {
  try {
    const [btcBase, ethBase, solBase] = await Promise.all([
      fetch30dBasePrice("BTCUSDT"),
      fetch30dBasePrice("ETHUSDT"),
      fetch30dBasePrice("SOLUSDT")
    ]);

    res.json({
      ok: true,
      ts: Date.now(),
      btcBase,
      ethBase,
      solBase
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      ts: Date.now(),
      error: String(err?.message || err),
      btcBase: null,
      ethBase: null,
      solBase: null
    });
  }
});

/////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////
///////////////self-analysis: A-L analitički mehanizam//////////////////
////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////
//import fs from "fs/promises";
//import path from "path";

const REPORTS_FILE = path.join(dataDir, "self-analysis.json");




// Proračun analize iz serverskih kotacija, bez javnog upisa proizvoljnog snapshot-a.
async function fetchMarketData() {
  if (['btc','eth','sol'].some(symbol => !marketTick[symbol]?.price || Date.now() - (marketTick[symbol].updatedAt || 0) > 30000)) await refreshMarketRest();
  const result = {collectedAt:new Date().toISOString(), gold:{price:null,change24h:null},
    oil:{price:null,change24h:null}, sp500:{price:null,change24h:null}, cryptoTotal:{value:null,change24h:null}};
  for (const [symbol, pair] of [['btc','BTCUSDT'],['eth','ETHUSDT'],['sol','SOLUSDT']]) {
    const tick = marketTick[symbol];
    if (!tick?.price || Date.now() - (tick.updatedAt || 0) > 30000) throw Error('Tržišne kotacije još nisu dostupne');
    const [base7d, base30d] = await Promise.all([fetch7dBasePrice(pair), fetch30dBasePrice(pair)]);
    result[symbol] = {price:tick.price, change24h:tick.changePercent, base7d, base30d,
      change7d:(tick.price/base7d-1)*100, change30d:(tick.price/base30d-1)*100};
  }
  return result;
}

async function readReports() {
    try {
        const data = await fsp.readFile(REPORTS_FILE, "utf8");

        if (!data.trim()) {
            return [];
        }

        const parsed = JSON.parse(data);

        if (Array.isArray(parsed)) {
            return parsed.filter(report => report && typeof report === "object");
        }

        if (parsed && typeof parsed === "object") {
            return [parsed];
        }

        throw new Error("self-analysis.json mora biti JSON niz ili objekat.");
    } catch (err) {
        if (err.code === "ENOENT") {
            return [];
        }

        console.error("Greška pri čitanju self-analysis.json:", err.message);
        throw err;
    }
}

async function saveReport(report) {
    const reports = await readReports();
    const reportId = getPersistentReportId(report);
    const existingIndex = reportId
        ? reports.findIndex(r => getPersistentReportId(r) === reportId)
        : -1;

    if (existingIndex >= 0) {
        reports[existingIndex] = report;
    } else {
        reports.push(report);
    }

    reports.sort(compareReportsDesc);

    await writeReportsFile(reports);
}

function getPersistentReportId(report) {
    return report?.id || report?.generatedAtIso || report?.generatedAt || null;
}

async function writeReportsFile(reports) {
    const reportsDir = path.dirname(REPORTS_FILE);
    const tmpFile = path.join(reportsDir, `.${path.basename(REPORTS_FILE)}.tmp`);

    await fsp.mkdir(reportsDir, { recursive: true });
    await fsp.writeFile(tmpFile, JSON.stringify(reports, null, 2), "utf8");
    await fsp.rename(tmpFile, REPORTS_FILE);
}

async function getAllReports() {
    const reports = await readReports();

    return reports
        .map(report => ({
            id: report.id || report.generatedAt || report.date,
            generatedAt: report.generatedAt || null,
            date: report.date,
            marketState: report.marketState,
            riskLevel: report.riskLevel,
            signal: report.signal
        }))
        .sort(compareReportsDesc);
}

async function getLatestReport() {
    const reports = await readReports();

    if (reports.length === 0) {
        return {
            date: "—",
            marketState: "—",
            riskLevel: "—",
            signal: "—",
            summary: "Analiza još nije generisana."
        };
    }

    return reports.sort(compareReportsDesc)[0];
}

async function getReportById(id) {
    const reports = await readReports();

    return reports.find(report =>
        report.id === id ||
        report.generatedAt === id ||
        report.date === id
    ) || {
        date: id,
        marketState: "—",
        riskLevel: "—",
        signal: "—",
        summary: "Analiza za izabrani datum nije pronađena."
    };
}

function compareReportsDesc(a, b) {
    const aKey = a.generatedAtIso || a.generatedAt || a.id || a.date || "";
    const bKey = b.generatedAtIso || b.generatedAt || b.id || b.date || "";
    return String(bKey).localeCompare(String(aKey));
}

function calculateIndicators(data) {
    const cryptoSymbols = ["btc", "eth", "sol"];
    const changes24h = cryptoSymbols
        .map(symbol => data[symbol]?.change24h)
        .filter(Number.isFinite);
    const changes7d = cryptoSymbols
        .map(symbol => data[symbol]?.change7d)
        .filter(Number.isFinite);
    const changes30d = cryptoSymbols
        .map(symbol => data[symbol]?.change30d)
        .filter(Number.isFinite);

    const avgCrypto24h = average(changes24h);
    const avgCrypto7d = average(changes7d);
    const avgCrypto30d = average(changes30d);
    const maxAbsCrypto7d = changes7d.length
        ? Math.max(...changes7d.map(value => Math.abs(value)))
        : null;

    const riskIndex = calculateRiskIndex({
        avgCrypto24h,
        avgCrypto7d,
        avgCrypto30d,
        maxAbsCrypto7d,
        btc24h: data.btc?.change24h,
        btc7d: data.btc?.change7d,
        sp500: data.sp500?.change24h,
        gold: data.gold?.change24h
    });

    return {
        ...data,
        indicators: {
            avgCrypto24h,
            avgCrypto7d,
            avgCrypto30d,
            maxAbsCrypto7d,
            riskIndex,
            riskLevel: getRiskLevel(riskIndex),
            marketState: getMarketState(riskIndex, avgCrypto24h, avgCrypto7d, avgCrypto30d),
            signal: getMarketSignal(riskIndex, avgCrypto24h, avgCrypto7d, avgCrypto30d)
        }
    };
}

function average(values) {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function addRisk(score, condition, points) {
    return condition ? score + points : score;
}

function calculateRiskIndex(values) {
    let score = 50;

    score = addRisk(score, values.avgCrypto24h <= -3, 15);
    score = addRisk(score, values.avgCrypto24h >= 3, -8);
    score = addRisk(score, values.avgCrypto7d <= -6, 15);
    score = addRisk(score, values.avgCrypto7d >= 6, -10);
    score = addRisk(score, values.avgCrypto30d <= -12, 12);
    score = addRisk(score, values.avgCrypto30d >= 12, -8);
    score = addRisk(score, values.maxAbsCrypto7d >= 12, 10);
    score = addRisk(score, values.btc24h <= -3, 10);
    score = addRisk(score, values.btc7d <= -7, 10);
    score = addRisk(score, values.sp500 < 0, 8);
    score = addRisk(score, values.gold > 0 && values.sp500 < 0, 8);
    score = addRisk(score, values.gold < 0 && values.sp500 > 0, -6);

    return Math.max(0, Math.min(100, Math.round(score)));
}

function getRiskLevel(score) {
    if (score >= 70) return "povišen";
    if (score <= 35) return "nizak";
    return "srednji";
}

function getMarketState(score, avgCrypto24h, avgCrypto7d, avgCrypto30d) {
    if (score >= 70) return "risk-off";
    if (score <= 35 && avgCrypto24h > 0 && avgCrypto7d > 0 && avgCrypto30d > 0) return "risk-on";
    if (avgCrypto7d > 3) return "neutralno do umereno uzlaznog trenda";
    if (avgCrypto30d < -8) return "neutralno do oprezno na mesečnom nivou";
    if (avgCrypto7d < -3) return "neutralno do oprezno";
    return "neutralno";
}

function getMarketSignal(score, avgCrypto24h, avgCrypto7d, avgCrypto30d) {
    if (score >= 75) return "OPREZ / WAIT";
    if (score <= 35 && avgCrypto24h > 0 && avgCrypto7d > 0 && avgCrypto30d > 0) return "OPORAVAK";
    if (avgCrypto7d > 3 && score < 60) return "WAIT / DCA AKUMULACIJA";
    return "WAIT";
}

function getBelgradeDateTimeParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Belgrade",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).formatToParts(date);

    return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function createReportTimeMeta(date = new Date()) {
    const parts = getBelgradeDateTimeParts(date);
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    const time = `${parts.hour}:${parts.minute}:${parts.second}`;

    return {
        id: `${day}T${parts.hour}-${parts.minute}-${parts.second}-${String(date.getMilliseconds()).padStart(3, "0")}`,
        date: day,
        generatedAt: `${day} ${time}`,
        generatedAtIso: date.toISOString()
    };
}

function formatPrice(value, decimals = 0) {

    if (value === null || value === undefined || isNaN(value)) {
        return "—";
    }

    return Number(value).toLocaleString("sr-RS", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });

}

function formatPercent(value) {
    if (value === null || value === undefined || isNaN(value)) {
        return "—";
    }

    return Number(value).toLocaleString("sr-RS", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function generateDailyReport(i) {
  let marketState = "neutralno";
  let riskLevel = "srednji";
  let signal = "WAIT";

  if (i.btc.change24h < -3 && i.gold.change24h > 0 && i.sp500.change24h < 0) {
    marketState = "risk-off";
    riskLevel = "povišen";
    signal = "OPREZ / WAIT";
  }

  if (i.btc.price > 60000 && i.cryptoTotal.change24h > 0) {
    marketState = "neutralno do umereno uzlaznog trenda";
    signal = "WAIT / DCA AKUMULACIJA";
  }

  if (i.btc.change24h > 2 && i.sp500.change24h > 0 && i.gold.change24h < 0) {
    marketState = "risk-on";
    riskLevel = "srednji";
    signal = "OPORAVAK";
  }

  /*
  return {
    date: new Date().toISOString().slice(0, 10),
    marketState,
    riskLevel,
    signal,
    btc: i.btc,
    eth: i.eth,
    gold: i.gold,
    oil: i.oil,
    cryptoTotal: i.cryptoTotal,
    summary: `
BTC se trenutno kreće oko ${formatPrice(i.btc.price)} USD, uz dnevnu promenu od ${formatPercent(i.btc.change24h)}%.
ETH je na ${formatPrice(i.eth.price, 2)} USD, dok je ukupna kripto kapitalizacija oko ${i.cryptoTotal.value} T USD.
Zlato je ${i.gold.change24h > 0 ? "u rastu" : "u padu"}, što ukazuje na ${i.gold.change24h > 0 ? "povećan oprez investitora" : "slabljenje zaštitne tražnje"}.
Trenutno stanje tržišta je: ${marketState}. Rizik je ${riskLevel}. Signal: ${signal}.
    `.trim()
  };
  */

    return {
    date: new Date().toISOString().slice(0, 10),
    marketState,
    riskLevel,
    signal,
    btc: i.btc,
    eth: i.eth,
    gold: i.gold,
    oil: i.oil,
    cryptoTotal: i.cryptoTotal,
    summary: `
BTC se trenutno kreće oko ${formatPrice(i.btc.price)} USD, uz dnevnu promenu od ${formatPercent(i.btc.change24h)}%.
ETH je na ${formatPrice(i.eth.price, 2)} USD. 
Trenutno stanje tržišta je: ${marketState}. Rizik je ${riskLevel}. Signal: ${signal}.
    `.trim()
  };




}

function generateScoredDailyReport(i) {
    const { marketState, riskLevel, signal, avgCrypto7d, avgCrypto30d } = i.indicators;
    const riskIndex = i.indicators.riskIndex ?? i.indicators.riskScore;
    const timeMeta = createReportTimeMeta();

    return {
        id: timeMeta.id,
        date: timeMeta.date,
        generatedAt: timeMeta.generatedAt,
        generatedAtIso: timeMeta.generatedAtIso,
        marketState,
        riskLevel,
        signal,
        btc: i.btc,
        eth: i.eth,
        sol: i.sol,
        gold: i.gold,
        oil: i.oil,
        sp500: i.sp500,
        cryptoTotal: i.cryptoTotal,
        indicators: i.indicators,
        snapshot: {
            collectedAt: i.collectedAt,
            btc: i.btc,
            eth: i.eth,
            sol: i.sol,
            gold: i.gold,
            oil: i.oil,
            sp500: i.sp500,
            cryptoTotal: i.cryptoTotal
        },
        summary: `
BTC se trenutno kreće oko ${formatPrice(i.btc.price)} USD, uz dnevnu promenu od ${formatPercent(i.btc.change24h)}%.
ETH je na ${formatPrice(i.eth.price, 2)} USD, a SOL na ${formatPrice(i.sol.price, 2)} USD.
Prosečna 7d promena BTC/ETH/SOL je ${formatPercent(avgCrypto7d)}%, a indeks rizika je ${riskIndex}/100.
Prosečna 30d promena BTC/ETH/SOL je ${formatPercent(avgCrypto30d)}%.
Trenutno stanje tržišta je: ${marketState}. Rizik je ${riskLevel}. Signal: ${signal}.
        `.trim()
    };
}

app.get("/api/self-analysis/latest", async (req, res) => {
    const report = await getLatestReport();
    res.json(report);
});

app.get("/api/self-analysis/history", async (req, res) => {
    const reports = await getAllReports();
    res.json(reports);
});

app.get("/api/self-analysis/generate", async (req, res) => {
    const report = await analysisRunner.run();
    res.json(report);
});

app.get("/api/self-analysis/schedule", (req, res) => {
    const nextRun = typeof selfAnalysisCronTask.getNextRun === "function"
        ? selfAnalysisCronTask.getNextRun()
        : null;

    res.json({
        cron: SELF_ANALYSIS_CRON_EXPRESSION,
        timezone: SELF_ANALYSIS_CRON_TIMEZONE,
        serverNow: new Date().toISOString(),
        nextRun: nextRun ? nextRun.toISOString() : null
    });
});

app.get("/api/self-analysis/:id", async (req, res) => {
    const report = await getReportById(req.params.id);
    res.json(report);
});


const analysisRunner = createAnalysisRunner({
  readReports,
  generate: async () => generateScoredDailyReport(calculateIndicators(await fetchMarketData())),
  saveReport
});
let analysisRetryTimer = null;
const retryDailyAnalysis = () => analysisRunner.run(true)
  .catch(error => console.warn('Dnevna analiza nije generisana; novi pokušaj za minut:', error.message));
if (process.env.PORTFOLIO_TEST_MODE !== '1') {
  connectBinanceMarketStream();
  refreshMarketRest();
  restTimer = setInterval(refreshMarketRest, 10000);
  retryDailyAnalysis();
  analysisRetryTimer = setInterval(retryDailyAnalysis, 60000);
}
else selfAnalysisCronTask.stop();
return () => {
  selfAnalysisCronTask.stop();
  if (analysisRetryTimer) clearInterval(analysisRetryTimer);
  if (restTimer) clearInterval(restTimer);
  publicAgent.destroy();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (binanceWs) { binanceWs.removeAllListeners(); binanceWs.on('error', () => {}); binanceWs.terminate(); }
  for (const client of wss.clients) client.terminate();
  wss.close();
};
}
