// server.js — login → SESSION → get-my-accounts → real-time equity (CHF)

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import crypto from 'crypto';
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 8080;
const BASE = "https://www.myfxbook.com/api";

let cachedAccounts = [];
let cachedTs = 0;
let refreshing = false;
let backoffUntil = 0;
const CACHE_TTL_MS = 60000; // 60s umesto 15s


// indeks naloga se koristi u kod.js (INDEX = 2)
const ACCOUNT_INDEX = parseInt(process.env.ACCOUNT_INDEX || "2", 10);

// GLOBAL SESSION (samo u memoriji)
let SESSION = null;


const SESSION_FILE = ".myfxbook_session.json";

function loadSessionFromDisk() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const obj = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
      if (obj?.session) {
        SESSION = String(obj.session).trim();
        console.log("Loaded session from disk. Prefix:", SESSION.slice(0,6) + "…");
      }
    }
  } catch (e) {
    console.warn("Could not load session file:", e.message);
  }
}

function saveSessionToDisk() {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ session: SESSION, savedAt: Date.now() }, null, 2), "utf8");
  } catch (e) {
    console.warn("Could not save session file:", e.message);
  }
}

// pozvati na boot:
loadSessionFromDisk();



// equity tick (za graf + input)
/*
let lastEquityTick = {
  t: Date.now(),
  equity: null,
  currency: "CHF"
};
*/

// --------------------------------------------------
// LOGIN — ekvivalent curl "…/login.json?email=...&password=..."
// --------------------------------------------------
// Nova verzija

let lastLoginAttemptAt = 0;     // poslednji POKUŠAJ logina
let loginBlockedUntil = 0;      // backoff do kog se ne pokušava login
let loginInFlight = null;       // Promise za single-flight

const MIN_LOGIN_INTERVAL_MS = 60_000;      // 60s između pokušaja (povećati po potrebi)
const FORBIDDEN_BACKOFF_MS  = 12 * 60 * 60_000; // 12 * 60 min backoff na HTTP 403
const FAIL_BACKOFF_MS       = 5 * 60_000;  // 5 min backoff na druge greške

async function loginMyfxbook() {
  // Ako sesija postoji, ne raditi ništa
  if (SESSION) return SESSION;

  const now = Date.now();

  // Ako je backoff, ne pokušavati ponovo
  if (now < loginBlockedUntil) {
    throw new Error(`Login blocked by backoff until ${new Date(loginBlockedUntil).toISOString()}`);
  }

  // Single-flight: ako je login već u toku, sačekati
  if (loginInFlight) return loginInFlight;

  // Minimum interval između pokušaja
  if (now - lastLoginAttemptAt < MIN_LOGIN_INTERVAL_MS) {
    throw new Error("Previše login pokušaja u kratkom vremenu (rate limit u aplikaciji).");
  }

  lastLoginAttemptAt = now;

  loginInFlight = (async () => {
    const email    = process.env.MYFXBOOK_EMAIL;
    const password = process.env.MYFXBOOK_PASSWORD;

    if (!email || !password) {
      throw new Error("MYFXBOOK_EMAIL ili MYFXBOOK_PASSWORD nisu podešeni.");
    }

    const url = `${BASE}/login.json?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36",
        "Accept": "application/json,text/javascript,*/*;q=0.1",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      }
    });

    console.log("Login HTTP status:", res.status);

    // 403: najčešće WAF / previše pokušaja / zabranjen datacenter IP
    if (res.status === 403) {
      loginBlockedUntil = Date.now() + FORBIDDEN_BACKOFF_MS;
      throw new Error(`Login HTTP 403 → backoff ${Math.round(FORBIDDEN_BACKOFF_MS/60000)} min`);
    }

    if (!res.ok) {
      // ostale greške: uvođenje kraćeg backoff-a
      loginBlockedUntil = Date.now() + FAIL_BACKOFF_MS;
      throw new Error("Login HTTP error " + res.status);
    }

    const data = await res.json();
    console.log("Login JSON:", data);

    if (data.error) {
      // označeno je kao greška sa backoff-om
      loginBlockedUntil = Date.now() + FAIL_BACKOFF_MS;
      throw new Error("Login error: " + (data.message || "Unknown"));
    }

    if (!data.session) {
      loginBlockedUntil = Date.now() + FAIL_BACKOFF_MS;
      throw new Error("Login OK ali nema sesije u odgovoru.");
    }

    // VAŽNO: bez dekodovanja sesije
    SESSION = String(data.session).trim();
    saveSessionToDisk();
    console.log("SESSION prefix:", SESSION.slice(0, 6) + "…");
    return SESSION;
  })()
    .finally(() => {
      // obavezno resetovanje single-flight
      loginInFlight = null;
    });

  return loginInFlight;
}




// Pomoćna funkcija: parsiranje Myfxbook formata "MM/DD/YYYY HH:mm"
function parseMyfxbookDate(str) {
  if (!str) return null;

  const [datePart, timePart] = str.split(" ");
  if (!datePart || !timePart) return null;

  const [month, day, year] = datePart.split("/").map(Number);
  const [hour, minute]     = timePart.split(":").map(Number);

  //Korekcija: -1 sat
  return new Date(
    year,
    month - 1,
    day,
    (hour ?? 0) - 1,
    minute ?? 0,
    0
  );
}


function formatSerbianDate(dateObj) {
  if (!dateObj || !(dateObj instanceof Date)) return null;

  const dd = String(dateObj.getDate()).padStart(2, "0");
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const yyyy = dateObj.getFullYear();

  const hh = String(dateObj.getHours()).padStart(2, "0");
  const min = String(dateObj.getMinutes()).padStart(2, "0");

  return `${dd}.${mm}.${yyyy}. ${hh}:${min}h`;
}


// --------------------------------------------------
// GET-MY-ACCOUNTS — Korak 3 (bez encodeURIComponent za session)
// --------------------------------------------------
async function getMyAccounts() {
  // Ako nema sesije, prvo login (ali ako loginMyfxbook već ima backoff)
  if (!SESSION) {
    console.log("SESSION je null → loginMyfxbook()");
    await loginMyfxbook();
  }

  let attempt = 0;

  while (attempt < 2) {
    attempt++;

    const url = `${BASE}/get-my-accounts.json?session=${SESSION}`;
    console.log(">>> GET-MY-ACCOUNTS URL:", url);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json,text/javascript,*/*;q=0.1",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": "Node-Myfxbook-Client"
      }
    });

    if (!res.ok) {
      // Bez pokušaja relogin-a ako je 403 na accounts
      throw new Error(`get-my-accounts HTTP error ${res.status}`);
    }

    const data = await res.json();

    if (data?.error) {
      const msg = String(data.message || "").toLowerCase();

      // Samo 1 retry za invalid session
      if (msg.includes("invalid session") && attempt === 1) {
        console.warn("⚠ Invalid session → relogin jednom pa retry…");
        SESSION = null;
        await loginMyfxbook(); // sada je uključena zaštita backoff-om
        continue;
      }

      throw new Error("get-my-accounts error: " + (data.message || "Unknown"));
    }

    return data;
  }

  throw new Error("getMyAccounts failed after retry");
}



// helper: siguran wrap oko getMyAccounts da uvek vrati objekat {accounts:[]}
/*
async function getMyfxbookAccountsSafe() {
  const data = await getMyAccounts();
  if (!data || typeof data !== "object") {
    throw new Error("getMyfxbookAccountsSafe: getMyAccounts vratio neočekivan tip.");
  }
  if (!Array.isArray(data.accounts)) {
    console.warn("getMyfxbookAccountsSafe: data.accounts nije niz, kreiranje praznog niza.");
    return { accounts: [] };
  }
  return data;
}
*/

//dohvatanje istorije za konkretan nalog po ID
async function getHistoryForAccountId(accountId) {
  if (!SESSION) {
    await loginMyfxbook();
  }

  let url = `${BASE}/get-history.json?session=${SESSION}&id=${accountId}`;
  console.log(">>> GET-HISTORY URL:", url);

  let res = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json,text/javascript,*/*;q=0.1",
      "User-Agent": "Node-Myfxbook-Client"
    }
  });

  if (!res.ok) throw new Error(`get-history HTTP ${res.status}`);

  //privremeno uklanjanje prikaza JSON
  let data = await res.json();
  //console.log("get-history response:", data);

  // fallback za "Invalid session"
  if (data.error && (data.message || "").toLowerCase().includes("invalid session")) {
    console.warn("⚠ Invalid session u getHistoryForAccountId → relogin & retry…");
    SESSION = null;
    await loginMyfxbook();

    url = `${BASE}/get-history.json?session=${SESSION}&id=${accountId}`;
    console.log(">>> GET-HISTORY (after relogin) URL:", url);

    res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json,text/javascript,*/*;q=0.1",
        "User-Agent": "Node-Myfxbook-Client"
      }
    });

    if (!res.ok) throw new Error(`get-history HTTP ${res.status} after relogin`);

    data = await res.json();
    console.log("get-history after relogin:", data);

    if (data.error) {
      throw new Error("get-history posle relogina error: " + (data.message || "Unknown"));
    }
  }

  if (data.error) {
    throw new Error("get-history error: " + (data.message || "Unknown"));
  }

  // vraćanje niza trejdova
  return data.history || [];
}

// -----------------------------------------------------
//
//BINANCE
//
//------------------------------------------------------
async function getBinanceCapital() {
    try {
        const apiKey = process.env.BINANCE_API_KEY;
        const apiSecret = process.env.BINANCE_API_SECRET;

        if (!apiKey || !apiSecret) {
            console.warn("Binance API ključevi nisu definisani u .env!");
            return null;
        }

        const timestamp = Date.now();
        const recvWindow = 45000;

        const query = `timestamp=${timestamp}&recvWindow=${recvWindow}`;

        const signature = crypto
            .createHmac("sha256", apiSecret)
            .update(query)
            .digest("hex");

        const url = `https://api.binance.com/api/v3/account?${query}&signature=${signature}`;

        const res = await fetch(url, {
            method: "GET",
            headers: {
                "X-MBX-APIKEY": apiKey
            }
        });

        // DEBUG: detaljniji ispis zbog lakšeg praćenja grešaka
        if (!res.ok) {
            const txt = await res.text();
            console.warn("Binance HTTP error:", res.status, txt);
            return null;
        }

        const data = await res.json();
        if (!data.balances) return null;

        // -------------------------------------
        // UKUPNA VREDNOST PORTFOLIJA U USDT
        // -------------------------------------
        let totalUsdt = 0;

        for (const b of data.balances) {
            const free   = Number(b.free   || 0);
            const locked = Number(b.locked || 0);
            const total  = free + locked;

            if (total <= 0) continue;

            if (b.asset === "USDT") {
                totalUsdt += total;
            } else {
                // trenutna cena preko /ticker/price
                const priceRes = await fetch(
                    `https://api.binance.com/api/v3/ticker/price?symbol=${b.asset}USDT`
                );

                if (!priceRes.ok) continue;

                const priceData = await priceRes.json();
                const price = Number(priceData.price || 0);

                if (price > 0) {
                    totalUsdt += total * price;
                }
            }
        }

        return Number(totalUsdt.toFixed(2));

    } catch (e) {
        console.warn("Binance API error:", e.message);
        return null;
    }
}

// --------------------------------------------
// KONVERZIJA USDT → CHF preko Binance API
// --------------------------------------------
async function convertUsdtToChf(usdtAmount) {
    try {
        if (!usdtAmount || usdtAmount <= 0) return 0;

        // Binance par USDTCHF
        // Ako ne postoji, koristiti USDT → EUR → CHF
        const direct = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=USDCHF");
        
        if (direct.ok) {
            const dj = await direct.json();
            const chfPrice = Number(dj.price || 0);
            if (chfPrice > 0) {
                return Number((usdtAmount * chfPrice).toFixed(2));
            }
        }

        // fallback ako USDCHF ne postoji
        const eurPriceRes = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=EURCHF");
        const usdeurRes   = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=USDEUR");

        if (!eurPriceRes.ok || !usdeurRes.ok) return 0;

        const eurChf  = Number((await eurPriceRes.json()).price || 0);
        const usdEur  = Number((await usdeurRes.json()).price || 0);

        if (eurChf > 0 && usdEur > 0) {
            return Number((usdtAmount * usdEur * eurChf).toFixed(2));
        }

        return 0;

    } catch (err) {
        console.warn("convertUsdtToChf error:", err.message);
        return 0;
    }
}


// --------------------------------------------------
// PERIODIČNO OSVEŽAVANJE TRENUTNOG KAPITALA (CHF)
// --------------------------------------------------
// --------------------------------------------------
// SABIRANJE KAPITALA SA NALOGA [2] i [4]
// --------------------------------------------------
//
// + Binance
//
//---------------------------------------------------

let lastEquityTick = {
  t: Date.now(),
  equityChf: null,
  a: { index: 2, equity: null, currency: null },
  b: { index: 4, equity: null, currency: null },
  note: "init"
};

// Jednostavna FX mapa (primer). Kasnije može da se zameni realnim API-jem.
const fxToChf = {
  CHF: 1.0,
  USD: 0.88,  // primer
  EUR: 0.95,  // primer
  GBP: 1.10,  // primer
  RSD: 0.0082 // primer
};

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function convertToChf(amount, currency) {
  if (amount == null) return null;
  const cur = String(currency || "").toUpperCase().trim();
  const rate = fxToChf[cur];
  if (!rate) return null;
  return amount * rate;
}

async function refreshEquityTick() {
  try {
    await ensureAccountsCache(); // osvežiti cache po TTL-u
    const accounts = Array.isArray(cachedAccounts) ? cachedAccounts : [];

    // Ako cache prazan, bez spamovanja log-ovima
    if (!accounts.length) {
      lastEquityTick = {
        ...lastEquityTick,
        t: Date.now(),
        equityChf: null,
        note: "no accounts in cache"
      };
      return;
    }

    // Bezbedno uzimanje naloga po indeksima (mogu da ne postoje)
    const acc1 = accounts[2] || null;
    const acc2 = accounts[4] || null;

    const aEquity = acc1 ? toNumber(acc1.equity) : null;
    const aCurr   = acc1 ? (acc1.currency || null) : null;

    const bEquity = acc2 ? toNumber(acc2.equity) : null;
    const bCurr   = acc2 ? (acc2.currency || null) : null;

    // Konverzija u CHF (ako je već CHF, samo *1)
    const aChf = convertToChf(aEquity, aCurr);
    const bChf = convertToChf(bEquity, bCurr);

    // Sabrati samo ono što postoji
    const parts = [aChf, bChf].filter(v => typeof v === "number");
    const totalChf = parts.length ? Number(parts.reduce((s, v) => s + v, 0).toFixed(2)) : null;

    lastEquityTick = {
      t: Date.now(),
      equityChf: totalChf,
      a: { index: 2, equity: aEquity, currency: aCurr, chf: aChf != null ? Number(aChf.toFixed(2)) : null },
      b: { index: 4, equity: bEquity, currency: bCurr, chf: bChf != null ? Number(bChf.toFixed(2)) : null },
      note: totalChf == null ? "missing fx rate or missing equities" : "ok"
    };
  } catch (e) {
    console.warn("refreshEquityTick error:", e.message);
    lastEquityTick = {
      ...lastEquityTick,
      t: Date.now(),
      equityChf: null,
      note: "error: " + e.message
    };
  }
}

async function ensureAccountsCache() {
  const now = Date.now();
  if (now < loginBlockedUntil) return;
  if (now < backoffUntil) return;
  if (refreshing) return;
  if (cachedAccounts.length && (now - cachedTs) < CACHE_TTL_MS) return;

  refreshing = true;
  try {
    const data = await getMyAccounts();    // jedini poziv ka Myfxbook-u
    cachedAccounts = data.accounts || [];
    cachedTs = Date.now();
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("403")) {
      backoffUntil = Date.now() + 12 * 60 * 60 * 1000; // 12 * 60 min 
      console.warn("Myfxbook 403 → backoff 12 * 60 min");
    } else {
      backoffUntil = Date.now() + 5 * 60 * 1000; // 5 min za ostale greške
      console.warn("Myfxbook error → backoff 5 min:", msg);
    }
    // KLJUČNO: ne throw — samo izlaz
    return;
  } finally {
    refreshing = false;
  }
}

setInterval(ensureAccountsCache, 30);


// --------------------------------------------------
// STATIC — front-end (market.html, kod.js, m.html, m.js, stil.css)
// --------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/*
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "m1.html"));
});
*/


app.get("/m1", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "m1.html"));
});


// --------------------------------------------------
// /api/accounts — korišćenje getMyAccounts()
// --------------------------------------------------


app.get("/api/accounts", async (_req, res) => {
  await ensureAccountsCache();
  res.json(Array.isArray(cachedAccounts) ? cachedAccounts : []);
});

app.get("/api/status", (_req, res) => {
  const now = Date.now();
  const blockedUntil = Math.max(loginBlockedUntil || 0, backoffUntil || 0);

  let state = "ACTIVE";
  let message = null;

  if (!SESSION || !Array.isArray(cachedAccounts) || cachedAccounts.length === 0) {
    if (now < blockedUntil) {
      state = "STOPPED";
      message = "API je trenutno stopiran — podaci će se pojaviti automatski.";
    } else {
      state = "WAITING";
      message = "Čekanje na Myfxbook API…";
    }
  }

  res.json({
    state,
    message,
    now,
    blockedUntil,
    hasSession: !!SESSION,
    cachedCount: Array.isArray(cachedAccounts) ? cachedAccounts.length : 0,
    cachedTs
  });
});

// --------------------------------------------------
// /api/equity — koristi lastEquityTick (za polling)
// --------------------------------------------------
app.get("/api/equity", (_req, res) => {
  res.json(lastEquityTick);
});

// --------------------------------------------------
// /api/stream-equity — SSE stream za Chart.js
// --------------------------------------------------
app.get("/api/stream-equity", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // poslati trenutni tick odmah
  res.write(`data: ${JSON.stringify(lastEquityTick)}\n\n`);

  const intervalMs = 5000;
  const timer = setInterval(() => {
    res.write(`data: ${JSON.stringify(lastEquityTick)}\n\n`);
  }, intervalMs);

  req.on("close", () => {
    clearInterval(timer);
  });
});

//željeni indeksi portfolija (1, 2, 4)
//const LAST_TRADE_INDICES = [/*1,*/ 2, 4];

const LAST_TRADE_INDICES = [1, 2, 4];

function pickProfit(a) {
  // prioritet: profit => daily → monthly 
  const p = Number(a?.profit);
  if (Number.isFinite(p)) return p;

  const d = Number(a?.daily);
  if (Number.isFinite(d)) return d;

  const m = Number(a?.monthly);
  if (Number.isFinite(m)) return m;

  return null;
}

function pickDate(a) {
  // “poslednja promena” naloga (najkorisnije za UI)
  return a?.lastUpdateDate || a?.creationDate || null;
}

// --- History cache (da ne spamuje Myfxbook) ---
const HISTORY_TTL_MS = 60_000; // 60s dovoljno; po želji 2-5 min
const historyCache = new Map(); // accountId(string) -> { ts, items }

function isTradeAction(actionRaw) {
  const a = String(actionRaw || "").toLowerCase().trim();

  // izbaci depozite / povlačenja / balans akcije
  if (a.includes("deposit")) return false;
  if (a.includes("withdraw")) return false;
  if (a.includes("balance")) return false;
  if (a.includes("credit")) return false;
  if (a.includes("rebate")) return false;

  // trade akcije (mogu da se uključe i varijacije tipa "buy limit", "sell stop", itd.)
  return a.includes("buy") || a.includes("sell");
}

// Myfxbook get-history.json (vraća poslednjih ~50 transakcija) :contentReference[oaicite:1]{index=1}
// --- History cache (da ne spamuje Myfxbook) ---
//const HISTORY_TTL_MS = 60_000; // 60s (po želji 2-5 min)
//const historyCache = new Map(); // accountId -> { ts, items }

async function getHistoryCached(accountId) {
  const key = String(accountId);
  const now = Date.now();

  const hit = historyCache.get(key);
  if (hit && (now - hit.ts) < HISTORY_TTL_MS) return hit.items;

  //korišćenje postojećeg wrapper-a, bez apiGet()
  const items = await getHistoryForAccountId(key); // očekuje niz "history" zapisa
  const arr = Array.isArray(items) ? items : [];

  historyCache.set(key, { ts: now, items: arr });
  return arr;
}

/*
function pickLastClosedTrade(historyArr) {
  // filtriranje  trade-ove (buy/sell...) i vraćanje poslednjeg po closeTime
  const trades = historyArr.filter(t => isTradeAction(t.action));

  if (!trades.length) return null;

  // Myfxbook format je string, ali pošto su svi istog formata,
  // najjednostavnije: uzeti prvi nakon sortiranja po closeTime/opentime
  // (closeTime je najbolji za "zatvoren trade")
  trades.sort((a, b) => String(a.closeTime || "").localeCompare(String(b.closeTime || "")));
  return trades[trades.length - 1] || null;
}
*/

function pickLastClosedTrade(historyArr) {
  const trades = (historyArr || []).filter(tr => {
    const action = String(tr.action || "").toLowerCase();
    const symbol = String(tr.symbol || "").trim();

    // samo pravi trejdovi
    if (!symbol) return false;
    if (!action.includes("buy") && !action.includes("sell")) return false;

    // ukloniti deposit/withdraw/balance (dodatna sigurnost)
    if (action.includes("deposit") || action.includes("withdraw") || action.includes("balance")) return false;

    return true;
  });

  if (!trades.length) return null;

  let best = null;
  let bestTs = -1;

  for (const tr of trades) {
    const d = parseMyfxbookDate(tr.closeTime) || parseMyfxbookDate(tr.openTime);
    const ts = d ? d.getTime() : -1;
    if (ts > bestTs) {
      bestTs = ts;
      best = tr;
    }
  }

  return best;
}


//const LAST_TRADE_INDICES = [1, 2, 4];

app.get("/api/last-trades", async (_req, res) => {
  try {
    await ensureAccountsCache();
    const accounts = Array.isArray(cachedAccounts) ? cachedAccounts : [];

    const items = await Promise.all(
      LAST_TRADE_INDICES.map(async (index) => {
        const a = accounts[index];
        const accountId = a?.id;              // Myfxbook entity id (koristi se za get-history) :contentReference[oaicite:2]{index=2}
        const currency  = a?.currency ?? null;

        if (!accountId) {
          return { index, profit: null, date: null, currency, action: null, symbol: null };
        }

        const history = await getHistoryCached(accountId);
        const last = pickLastClosedTrade(history);

        return {
          index,
          profit: last?.profit ?? null,
          date:   last?.closeTime ?? null,    // zatvaranje pozicije
          currency,
          action: last?.action ?? null,       // Buy / Sell / Buy Limit ...
          symbol: last?.symbol ?? null
        };
      })
    );

    return res.json({ ok: true, ts: Date.now(), items });
  } catch (e) {
    return res.json({
      ok: false,
      ts: Date.now(),
      error: String(e?.message || e),
      items: []
    });
  }
});




app.post("/api/set-session", (req, res) => {
  const s = String(req.body?.session || "").trim();
  if (!s || s.length < 10) {
    return res.status(400).json({ ok: false, error: "Session missing/too short" });
  }
  SESSION = s;
  loginBlockedUntil = 0; // reset backoff kada korisnik ubaci novu sesiju
  backoffUntil = 0;
  saveSessionToDisk();
  res.json({ ok: true, sessionPrefix: SESSION.slice(0,6) + "…" });
});



// --------------------------------------------------
// POKRETANJE SERVERA
// --------------------------------------------------

app.listen(PORT, async () => {

  console.log(`Server je pokrenut na http://localhost:${PORT}`);
  console.log("Boot: pokretanje tajmera (best-effort).");

  // pokušati odmah sa osvežavanjem "cache" (ali bez rušenja)
  await ensureAccountsCache();

  // pokretanje timer-a uvek, čak i kad je login blokiran
  setInterval(async () => {
    await ensureAccountsCache();  // pokušaće login samo kad backoff istekne
    await refreshEquityTick();    // koristi se cachedAccounts (ako ih ima)
  }, 15000);

  console.log("Tick petlja je pokrenuta (15s).");

});




