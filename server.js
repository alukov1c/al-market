// server.js — login → SESSION → get-my-accounts → real-time equity (CHF)

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import crypto from 'crypto';

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
const CACHE_TTL_MS = 15000; // 15s


// indeks naloga se koristi u kod.js (INDEX = 2)
const ACCOUNT_INDEX = parseInt(process.env.ACCOUNT_INDEX || "2", 10);

// GLOBAL SESSION (samo u memoriji)
let SESSION = null;

// equity tick (za graf + input)
let lastEquityTick = {
  t: Date.now(),
  equity: null,
  currency: "CHF"
};

// --------------------------------------------------
// LOGIN — ekvivalent curl "…/login.json?email=...&password=..."
// --------------------------------------------------
// Nova verzija

let lastLoginTime = 0;

async function loginMyfxbook() {

  const now = Date.now();
  if (now - lastLoginTime < 10000) {
    throw new Error("Previše login pokušaja u kratkom vremenu");
  }

  lastLoginTime = now;

  const email    = process.env.MYFXBOOK_EMAIL;
  const password = process.env.MYFXBOOK_PASSWORD;

  const url = `${BASE}/login.json?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36",
      "Accept": "application/json"
    }
  });

  console.log("Login HTTP status:", res.status);

  if (!res.ok) {
    throw new Error("Login HTTP error " + res.status);
  }

  const data = await res.json();
  console.log("Login JSON:", data);

  if (data.error) {
    throw new Error("Login error: " + data.message);
  }

  SESSION = decodeURIComponent(data.session);
  console.log("SESSION =", SESSION);

  return SESSION;
}



// Pomoćna funkcija: parsiranje Myfxbook formata "MM/DD/YYYY HH:mm"
function parseMyfxbookDate(str) {
  if (!str) return null;
  const [datePart, timePart] = str.split(" ");
  if (!datePart || !timePart) return null;
  const [month, day, year] = datePart.split("/").map(Number);
  const [hour, minute]      = timePart.split(":").map(Number);
  return new Date(year, month - 1, day, hour - 1 || 0, minute || 0);
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
  // Ako nema sesije, prvo login
  if (!SESSION) {
    console.log("SESSION je null → loginMyfxbook()");
    await loginMyfxbook();
  }

  let url = `${BASE}/get-my-accounts.json?session=${SESSION}`;
  console.log(">>> GET-MY-ACCOUNTS URL:", url);

  let res = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json,text/javascript,*/*;q=0.1",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Connection": "keep-alive",
      "User-Agent": "Node-Myfxbook-Client"
    }
  });

  if (!res.ok) {
    throw new Error(`get-my-accounts HTTP error ${res.status}`);
  }

  let data = await res.json();
  //////////////////////////////////////
  ///////////////////////////////////////
  //JSON - portfolio
  ///////////////////////////////////////
  ///////////////////////////////////////
  //console.log("get-my-accounts response JSON:", data);

  // Jednostavan retry za "Invalid session"
  if (data.error && (data.message || "").toLowerCase().includes("invalid session")) {
    console.warn("⚠ Invalid session u getMyAccounts() → Relogin i ponovni pokušaj je u toku…");

    SESSION = null;
    await loginMyfxbook();

    url = `${BASE}/get-my-accounts.json?session=${SESSION}`;
    //console.log(">>> GET-MY-ACCOUNTS (after relogin) URL:", url);

    res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json,text/javascript,*/*;q=0.1",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Connection": "keep-alive",
        "User-Agent": "Node-Myfxbook-Client"
      }
    });

    if (!res.ok) {
      throw new Error(`get-my-accounts HTTP error ${res.status} posle relogina`);
    }

    data = await res.json();
    console.log("get-my-accounts response after relogin:", data);

    if (data.error) {
      throw new Error("get-my-accounts posle relogina error: " + (data.message || "Unknown"));
    }
  }

  if (data.error) {
    throw new Error("get-my-accounts error: " + (data.message || "Unknown"));
  }

  return data; // { error:false, accounts:[...] }
}


// helper: siguran wrap oko getMyAccounts da uvek vrati objekat {accounts:[]}
async function getMyfxbookAccountsSafe() {
  const data = await getMyAccounts();
  if (!data || typeof data !== "object") {
    throw new Error("getMyfxbookAccountsSafe: getMyAccounts vratio neočekivan tip.");
  }
  if (!Array.isArray(data.accounts)) {
    console.warn("getMyfxbookAccountsSafe: data.accounts nije niz, pravim prazan niz.");
    return { accounts: [] };
  }
  return data;
}



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

  // vraćamo niz trejdova
  return data.history || [];
}



//poslednji trejd za nalog po indeksu -> /api/accounts
// poslednji *pravi trejd* za nalog po indeksu -> /api/accounts
async function getLastTradeByIndex(index) {
  // 1) dohvati naloge preko getMyAccounts()
  const accData  = await getMyfxbookAccountsSafe(); // vidi helper ispod
  const accounts = accData.accounts || [];

  if (!Array.isArray(accounts) || !accounts.length) {
    throw new Error("getLastTradeByIndex: nema naloga u accounts.");
  }

  if (index < 0 || index >= accounts.length) {
    throw new Error(`getLastTradeByIndex: indeks ${index} je van opsega (0..${accounts.length - 1}).`);
  }

  const account   = accounts[index];
  const accountId = account.id;
  if (!accountId) {
    throw new Error(`getLastTradeByIndex: nalog[${index}] nema id.`);
  }

  // 2) dohvati kompletnu istoriju za taj nalog
  const history = await getHistoryForAccountId(accountId);
  if (!Array.isArray(history) || !history.length) {
    console.warn(`getLastTradeByIndex: nema history zapisa za nalog index=${index}, id=${accountId}.`);
    return null;
  }

  // 3) FILTRIRANJE — ostaju samo "pravi" trejdovi (buy/sell), bez Deposit/Withdrawal/Balance
  const onlyTrades = history.filter(tr => {
    const action = (tr.action || "").toLowerCase();
    const symbol = (tr.symbol || "").trim();

    // ignorisi zapise bez simbola (tipično depoziti, transferi, sl.)
    if (!symbol) return false;

    // zadrži samo stavke koje u action imaju "buy" ili "sell"
    if (!action.includes("buy") && !action.includes("sell")) return false;

    return true;
  });

  if (!onlyTrades.length) {
    console.warn(`getLastTradeByIndex: nema pravih buy/sell trejdova za nalog index=${index}, id=${accountId}.`);
    return null;
  }

  // 4) sortiraj po closeTime (fallback na openTime) i uzmi poslednji
  const withParsed = onlyTrades.map(tr => {
    const close = parseMyfxbookDate(tr.closeTime);
    const open  = parseMyfxbookDate(tr.openTime);
    return { ...tr, _ts: close ? close.getTime() : (open ? open.getTime() : 0) };
  });

  withParsed.sort((a, b) => a._ts - b._ts);
  const last = withParsed[withParsed.length - 1];

  return last;
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

        // Binance par USDTCHF MORA DA POSTOJI
        // Ako ne postoji, koristi USDT → EUR → CHF
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
async function refreshEquityTick() {
  try {
    await ensureAccountsCache();               // osveži cache po TTL-u
    const accounts = cachedAccounts || [];

    if (accounts.length <= 4) {
      console.warn("refreshEquityTick: nema dovoljno naloga u cache-u.");
      return;
    }

    const acc1 = accounts[2];
    const acc2 = accounts[4];

    // ... isto kao sad računanje totalChf
  } catch (e) {
    console.warn("refreshEquityTick error:", e.message);
  }
}


async function ensureAccountsCache() {
  const now = Date.now();
  if (now < backoffUntil) return;          // ako smo blokirani, ne zovi Myfxbook
  if (refreshing) return;                  // spreči paralelne pozive
  if (cachedAccounts.length && (now - cachedTs) < CACHE_TTL_MS) return; // cache validan

  refreshing = true;
  try {
    const data = await getMyAccounts();    // JEDINI poziv ka Myfxbook-u
    cachedAccounts = data.accounts || [];
    cachedTs = Date.now();
  } catch (e) {
    // Ako 403 → pauza 5 minuta
    if (String(e.message || e).includes("403")) {
      backoffUntil = Date.now() + 5 * 60 * 1000;
      console.warn("Myfxbook 403 → backoff 5min");
    }
    throw e;
  } finally {
    refreshing = false;
  }
}



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
// /api/accounts — koristi getMyAccounts()
// --------------------------------------------------
/*
app.get("/api/accounts", async (_req, res) => {
  try {
    const data = await getMyAccounts();
    res.json(data.accounts || []);
  } catch (e) {
    console.error(">>> /api/accounts ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});
*/

app.get("/api/accounts", async (_req, res) => {
  try {
    await ensureAccountsCache();
    res.json(cachedAccounts);
  } catch (e) {
    console.error("GET /api/accounts error:", e?.stack || e?.message);
    res.status(500).json({ error: String(e?.message || e) });
  }
});


// opcioni debug endpoint
/*
app.get("/api/debug-accounts", async (_req, res) => {
  try {
    const data = await getMyAccounts();
    res.json(data);
  } catch (e) {
    console.error(">>> /api/debug-accounts ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});
*/

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

  // pošalji trenutni tick odmah
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
const LAST_TRADE_INDICES = [/*1,*/ 2, 4];

app.get("/api/last-trades", async (_req, res) => {
  try {
    await ensureAccountsCache();
    const accounts = cachedAccounts || [];

    // ako nema naloga, vrati prazan rezultat umesto da pokušava login
    if (!accounts.length) {
      return res.json({ ok: false, reason: "No cached accounts (Myfxbook blocked?)", items: [] });
    }

    // ... dalje koristi accounts[index] umesto getMyfxbookAccountsSafe()
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});





// --------------------------------------------------
// START SERVER
// --------------------------------------------------
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("Na početku: loginMyfxbook() + prvi refreshEquityTick…");

  try {
    await loginMyfxbook();
    await refreshEquityTick();
    // periodično osvežavanje equity-ja (isto 15 s kao kod.js polling)
    setInterval(refreshEquityTick, 15000);
    console.log("Equity tick refresher pokrenut na 15 s.");
  } catch (e) {
    console.error("Init error:", e.message);
  }
});
