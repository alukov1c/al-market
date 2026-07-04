// m.js — tri portfolija (indeksi [1], [3]) + real-time osvežavanje na 3 s

// Koje indekse iz /api/accounts želimo:
const PORTFOLIO_CONFIGS = [


  {
    index: 0,
    chartId: "chartP2",
    equityInputId: "procenatKapitalaPA",
    currencyInputId: "valutaPA",
    profitId: "lastProfitPA",
    dateId: "lastDatePA"
  },

  /*
{
  index: 1,
  chartId: "chartPI",
  equityInputId: "procenatKapitalaPI",
  currencyInputId: "valutaPI",
  profitId: "lastProfitPI",
  dateId: "lastDatePI"
},
*/

  {
    index: 2,
    chartId: "chartPB",
    equityInputId: "procenatKapitalaPB",
    currencyInputId: "valutaPB",
    profitId: "lastProfitPB",
    dateId: "lastDatePB"
  }
];

const PORT_A = {
  index: 0,
  chartId: "chartP2",
  equityInputId: "procenatKapitalaPA",
  currencyInputId: "valutaPA",
  profitId: "lastProfitPA",
  dateId: "lastDatePA",
  jacinaId: "jacinaPozicijeA"
};

const PORT_B = {
  index: 2,
  chartId: "chartPB",
  equityInputId: "procenatKapitalaPB",
  currencyInputId: "valutaPB",
  profitId: "lastProfitPB",
  dateId: "lastDatePB",
  jacinaId: "jacinaPozicijeB"
};

const PORTFOLIOS = [PORT_A, PORT_B];


//let marginA = 107.52; //do 22.12.2025.
//let marginA = 73.25; //od 22.12.2025. 15:25h
//let marginA = 50.53; //od 22.12.2025. uveče

//const trzisteA = 290;
//const trzisteB = 290;

//let marginA = 15.11; //od 24.12.2025 01:45h
//let marginA = 16.64; //od 12.1.2026. 17:02h
//let marginA = 16.4; //21.1.2026.
//let marginA = 16.74; //28.1.2026.
//let marginA = 18.42; //18.2.2026.
//let marginA = 18.8; //17.4.2026. //22:00h
let marginA = 17.69; //4.5.2026. //20:58h

//let T_A_CHF = 5183.41; //24.12.2025. => trzisteA = 343,05
//let T_A_CHF = 5309.61; //31.12.2025.
//let T_A_CHF = 6399.78; //od 12.1.2026. 20:35h
//let T_A_CHF = 5987.62; //21.1.2026.
//let T_A_CHF = 5877.84; //28.1.2026. 11:14h
//let T_A_CHF = 0.77268 * (6615.6 + 0.17 * 1938); //18.2.2026. 21:04h => 5,336.31
//let T_A_CHF = 0.78130 * (77515.78 * 0.10 + 2432.39 * 0.17); //17.4.2026. 22:04h => 6,379.38
let T_A_CHF = 0.78384 * (80088 * 0.09 + 2358.80 * 0.17); //4.5.2026. 20:57h => 5,964.17

let trzisteA = T_A_CHF / marginA;

//------------------------------------------------
//------  -------   --------   -------   -------
//------------------------------------------------

//let marginB = 6.15; //do 23.12.2025. 08:47h
//let marginB = 73.23; //od 23.12.2025. 08:47h
//let marginB = 6.04; //od 24.12.2025. 00:41h
//let marginB = 78.06; //od 21.1.2026. 14:55h
//let marginB = 81.10; //28.1.2026.
//let marginB = 83.51; //18.2.2026.
//let marginB = 71.83; //17.4.2026. //22:07h
//let marginB = 135.98; //4.5.2026. //21:10h
let marginB = 133.73; //5.5.2026. //17:12h

//let T_B_AUD = 2586.64; //24.12.2025.
//let T_B_AUD = 2627.57; //31.12.2025.
//let T_B_AUD = 2734.51; //12.1.2026. 20:36h
//let T_B_AUD = 1.48 * (2 * 893.49 + 4861.87); //9840.298;
//let T_B_AUD = 1.427 * (2 * 893.17 + 5278.04); //28.1.2025. 11:17h => 10,080.87
//let T_B_AUD = 1.420 * (2 * 0.01 * 66175.10 + 4984.22); //18.2.2026. 21:07h =>  8,956.97
//let T_B_AUD = (1 / 0.71704) * (77606.54 * 0.02 + 4847.52); //17.4.2026. 22:09h => 8,925.10
//let T_B_AUD = (1 / 0.71714) * (80055.92 * 0.03 + 4519.17 * 2); //4.5.2026. 21:13h => 15,952.28
let T_B_AUD = (1 / 0.71922) * (81530.93 * 0.02 + 4580.99 * 2) //5.5.2026. 17:14h => 15,005.98;

let trzisteB = T_B_AUD / marginB;

let chartPortfolioInfo = null;


function calcJacina(equity, margin, trziste) {
  if (margin <= 0) return 0;
  const pozicija = equity / margin;
  return (pozicija / trziste) * 100;   // procenat
}


// ovde se čuvaju Chart instance da bi mogle da se osvežavaju
const charts = {};

function fmtPercent(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return n.toFixed(2) + " %";
}

async function updatePortfolios() {
  try {
    const res = await fetch("/api/accounts");
    if (!res.ok) throw new Error("HTTP " + res.status);

    const accounts = await res.json();
    if (!Array.isArray(accounts)) {
      throw new Error("Neočekivan format /api/accounts odgovora.");
    }

    PORTFOLIO_CONFIGS.forEach((cfg) => {
      const { index, chartId, equityInputId, currencyInputId } = cfg;

      const equityInput = document.getElementById(equityInputId);
      const currencyInput = document.getElementById(currencyInputId);
      const canvas = document.getElementById(chartId);

      if (index < 0 || index >= accounts.length) {
        if (equityInput) equityInput.value = "N/A (čekanje servera #" + index + ")";
        if (currencyInput) currencyInput.value = "";
        return;
      }

      const acc = accounts[index];

      const equityPercentRaw = Number(acc.equityPercent || 0);
      const equityPercent = Number(equityPercentRaw.toFixed(2));
      const currency = acc.currency || "";

      if (equityInput) equityInput.value = fmtPercent(equityPercent);
      if (currencyInput) currencyInput.value = currency;

      if (!canvas || !canvas.getContext) return;

      const rest = Math.max(0, 100 - equityPercent);

      // Ako grafikon ZA OVAJ portfolio još ne postoji → kreirati
      if (!charts[chartId]) {
        const ctx = canvas.getContext("2d");
        charts[chartId] = new Chart(ctx, {
          type: "doughnut",
          data: {
            labels: ["Nivo %", "Ostatak do 100%"],
            datasets: [{
              data: [equityPercent, rest]
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              tooltip: { enabled: false },
              legend: {
                display: true /* true */,
                position: "bottom"
              },
              tooltip: {
                callbacks: {
                  label: (context) => {
                    const label = context.label || "";
                    const value = context.parsed;
                    return `${label}: ${value.toFixed(2)} %`;
                  }
                }
              }
            },
            cutout: "60%"
          }
        });
      } else {
        // ako već postoji → samo ažuriraj podatke i refresuj
        const chart = charts[chartId];
        chart.data.datasets[0].data = [equityPercent, rest];
        chart.update("none"); // bez animacije da ne treperi
      }
    });

    // --- sabiranje kapitala A + B i slanje na grafik portfolioInfo ---

    let equityA = 0;
    let equityB = 0;

    PORTFOLIOS.forEach(cfg => {
      const acc = accounts[cfg.index];
      if (!acc) return;

      let eq = Number(acc.equity || 0);
      //let eq = Number(parseFloat(acc.equity).toFixed(4));

      const curr = (acc.currency || "").toUpperCase();
      if (curr === "AUD") {
        eq = eq * 0.54; // konverzija AUD → CHF
      }

      if (cfg.index === 0) equityA = eq;
      if (cfg.index === 2) equityB = eq;
    });

    const totalChf = equityA + equityB;

    // UPDATE LINE CHART
    updatePortfolioInfoChart(totalChf);

    // --- računanje jačine pozicije A i B ---
    PORTFOLIOS.forEach(cfg => {
      const acc = accounts[cfg.index];
      if (!acc) return;

      const equity = Number(acc.equity || 0);

      let marginVal = 0;
      if (cfg.index === 0) {

        marginVal = marginA;
        trziste = trzisteA;

      }
      if (cfg.index === 2) {

        marginVal = marginB;
        trziste = trzisteB;


      };

      const jacina = calcJacina(equity, marginVal, trziste);
      const el = document.getElementById(cfg.jacinaId);
      if (el) el.value = jacina.toFixed(2) + " ± 2 %";

    });

  } catch (err) {
    console.error("Greška u updatePortfolios():", err);
    // Po želji: jednom prikazati alert, ali ne svaki put
  }
}

function fmtNumber2(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

// Line chart: Portfolio A + Portfolio B (equity zbir u CHF)
function updatePortfolioInfoChart(totalChf) {
  const canvas = document.getElementById("chartPortfolioInfo");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d");
  const now = new Date();

  // Ako chart već postoji → obrisati ga pre pravljenja novog
  if (!chartPortfolioInfo) {
    chartPortfolioInfo = new Chart(ctx, {
      type: "scatter",
      data: {
        datasets: [{

          label: "Ukupno (CHF)",
          data: [{ x: now, y: totalChf }],
          showLine: false,
          stepped: true,
          borderWidth: 2,
          tension: 0 /* 0.25 */,
          pointRadius: 2,
          pointHoverRadius: 4

        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        plugins: {
          tooltip: { enabled: false },
          legend: { display: true },
        },
        scales: {
          x: {

            type: "time",
            time: { unit: "minute" },
            title: { display: true, text: "Vreme" }

          },
          y: {
            title: /* { display: true, text: "CHF" }, */ { display: false },
            ticks: {
              display: false,
            },
            /* grid: {display: false} */

            suggestedMin: totalChf - 5,
            suggestedMax: totalChf + 5

          }
        }
      }
    });
    return;
  }

  // BEZ NOVOG KREIRANJA – samo update postojećeg grafikona
  const data = chartPortfolioInfo.data.datasets[0].data;

  data.push({ x: now, y: totalChf });

  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  while (data.length && +data[0].x < cutoff) data.shift();

  chartPortfolioInfo.update("none");
}


// Učitavanje poslednjih trejdova za indekse 1 i 3
async function updateLastTrades() {
  try {
    const res = await fetch("/api/last-trades");
    if (!res.ok) throw new Error("HTTP " + res.status);

    const data = await res.json();

    // uvek se očekuje items kao niz (server ga već šalje), ali bez rušenja UI
    if (!data || !Array.isArray(data.items)) {
      console.warn("last-trades: loš JSON shape", data);
      return;
    }

    if (!data.ok) {
      // Myfxbook privremeno blokira / nema history / backoff itd.
      data.items.forEach(item => {
        const cfg = PORTFOLIO_CONFIGS.find(c => c.index === item.index);
        if (!cfg) return;

        const profitEl = document.getElementById(cfg.profitId);
        const dateEl = document.getElementById(cfg.dateId);

        if (profitEl) profitEl.textContent = "Myfxbook privremeno blokira API — podaci će se pojaviti automatski";
        if (dateEl) {
          if (item.date) {
            const d = new Date(item.date);
            const dd = String(d.getDate()).padStart(2, "0");
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const yyyy = d.getFullYear();
            const hh = String(d.getHours()).padStart(2, "0");
            const min = String(d.getMinutes()).padStart(2, "0");
            dateEl.textContent = `${dd}.${mm}.${yyyy}. ${hh}:${min}h`;
          } else {
            dateEl.textContent = "—";
          }
        }

      });
      return;
    }


    // data.items: [{ index, profit, date, currency }, ...]
    data.items.forEach(item => {
      const cfg = PORTFOLIO_CONFIGS.find(c => c.index === item.index);
      if (!cfg) return;

      const profitEl = document.getElementById(cfg.profitId);
      const dateEl = document.getElementById(cfg.dateId);

      if (profitEl) {
        if (item.profit == null) {
          profitEl.textContent = "—";
          profitEl.style.color = "#6b7280"; // sivo
        } else {
          const profitNum = Number(item.profit);
          const curr = item.currency || "";

          // Format broja
          const formatted = fmtNumber2(Math.abs(profitNum));

          if (profitNum > 0) {

            profitEl.textContent = `+${formatted} ${curr}`;
            profitEl.style.color = "#16a34a"; // green-600
            profitEl.style.fontWeight = 'bold';

          } else if (profitNum < 0) {

            profitEl.textContent = `-${formatted} ${curr}`;
            profitEl.style.color = "#dc2626"; // red-600
            profitEl.style.fontWeight = 'bold';

          } else {

            profitEl.textContent = `0.00 ${curr}`;
            profitEl.style.color = "#6b7280"; // neutralno sivo
            profitEl.style.fontWeight = 'bold';

          }
        }
      }


      if (dateEl) {
        dateEl.textContent = item.date || "—";
      }
    });



  } catch (err) {
    console.error("Greška u updateLastTrades():", err);
  }
}

//////////////////////////////////////////////
//////////////////////////////////////////////
///////           Market           ///////////
//////////////////////////////////////////////
//////////////////////////////////////////////

function formatMarketPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "Cena...";
  return n.toLocaleString("sr-RS", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function getAdjustedMarketPrice(symbol, rawPrice) {

  const price = Number(rawPrice);
  if (!Number.isFinite(price)) return null;

  if (symbol === "btc") return price - 70 + 70;
  if (symbol === "eth") return price - 3 + 3;
  if (symbol === "sol") return price;

  return price;

}

function updateMarketInstrument(symbol, price, changePercent) {

  const priceEl = document.querySelector(`#${symbol}Price .price-value`);
  const changeEl = document.querySelector(`#${symbol}Change .change-value`);

  if (!priceEl || !changeEl) return;

  const adjustedPrice = getAdjustedMarketPrice(symbol, price);

  if (!Number.isFinite(adjustedPrice) || adjustedPrice <= 0) {
    priceEl.textContent = "—";
  } else {
    priceEl.textContent = adjustedPrice.toLocaleString("sr-RS", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  changeEl.classList.remove("change-up", "change-down", "change-flat");

  if (!Number.isFinite(changePercent)) {
    changeEl.textContent = "—";
    changeEl.classList.add("change-flat");
    return;
  }

  const pct = Number(changePercent);
  const prefix = pct > 0 ? "+" : "";

  changeEl.textContent = `${prefix}${pct.toFixed(2)}%`;

  if (pct > 0) {
    changeEl.classList.add("change-up");
  } else if (pct < 0) {
    changeEl.classList.add("change-down");
  } else {
    changeEl.classList.add("change-flat");
  }

}

async function loadInitialMarket() {
  try {
    const res = await fetch("/api/market");
    if (!res.ok) throw new Error("HTTP " + res.status);

    const data = await res.json();

    updateMarketStateFromTick(data);

    refreshMarketAnalysis();
  } catch (err) {
    console.error("Greška u loadInitialMarket():", err);
  }
}

function initMarketSocket() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}`);

  socket.addEventListener("open", () => {

    console.log("Market WebSocket povezan.");
    setLiveStatus(true);

  });

  socket.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type !== "market" || !msg.data) return;

      updateMarketStateFromTick(msg.data);

      refreshMarketAnalysis();

    } catch (err) {
      console.error("WS message parse error:", err);
    }
  });

  socket.addEventListener("close", () => {

    console.warn("Market WebSocket zatvoren. Reconnect za 3s...");
    setLiveStatus(false);
    setTimeout(initMarketSocket, 3000);

  });

  socket.addEventListener("error", (err) => {

    console.error("Market WebSocket greška:", err);
    setLiveStatus(false);

  });

}

// Pokretanje na load + interval na 3 s
function init() {

  updatePortfolios();              // prvo odmah
  setInterval(updatePortfolios, 10000); // pa na svakih 10s

  updateLastTrades();  // poslednji trejd za sva tri portfolija
  // po želji može i periodično, npr. na 30 s da se API ne poziva često:
  setInterval(updateLastTrades, 30000);

  loadInitialMarket();
  load7dBasePrices();
  load30dBasePrices();
  initMarketSocket();

}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}


let btnDan = document.querySelector('#btnDan');
let btnPlus = document.querySelector('#btnPlus');
let btnMinus = document.querySelector('#btnMinus');
let btnNoc = document.querySelector('#btnNoc');

let market = document.querySelector('#market');
let coinIcons = document.querySelectorAll('.coin-icon');

let naslovBTC = document.querySelector('#naslovBTC');
let naslovETH = document.querySelector('#naslovETH');

let ethPrice = document.querySelector('#ethPrice');

let marketZoom = 0;

/* 
btnDan.addEventListener('click', () => {

  console.log('Dnevna tema!');
  document.body.style.backgroundColor = "white";
  document.body.style.color = "rgba(0, 0, 0, 0.8)";
});
*/

function keepMarketPosition(callback) {

  const rect = market.getBoundingClientRect();
  const offsetTop = rect.top;

  callback();

  requestAnimationFrame(() => {
    const newRect = market.getBoundingClientRect();
    const delta = newRect.top - offsetTop;

    window.scrollBy(0, delta);
  });

}

btnPlus.addEventListener('click', () => {

  keepMarketPosition(() => {

    if (window.innerWidth <= 700) {

      market.style.fontSize = '18px';
      setCoinIconSize('16px');

    } else {

      if (marketZoom === 0) {

        market.style.fontSize = 'xx-large';

        setCoinIconSize('25px');

        marketZoom = 1;


      } else if ((window.innerWidth >= 701) && (window.innerWidth <= 1000)) {

        if (marketZoom === 0) {

          market.style.fontSize = 'xx-large';

          setCoinIconSize('25px');

          marketZoom = 1;

        } else {

          market.style.fontSize = '40px';

          setCoinIconSize('36px');

          marketZoom = 2;

          /*
          if(marketZoom === 2){
  
            naslovBTC.innerHTML = 'BTC';
            naslovETH.innerHTML = 'ETH';
            //ethPrice = ethPrice + '/n';
  
          } else {
  
            naslovBTC.innerHTML = 'Bitkoin - BTC';
            naslovETH.innerHTML = 'Eterijum - ETH';
  
          }
        */


        }
      }

      else {

        market.style.fontSize = 'xxx-large';

        setCoinIconSize('36px');

        marketZoom = 2;

      }

      //market.style.fontSize = 'xx-large';
    }

  });


});

btnMinus.addEventListener('click', () => {

  if (window.innerWidth <= 700) {
    market.style.fontSize = '14px';
  } else {
    market.style.fontSize = 'smaller';
  }

  setCoinIconSize('18px');

  marketZoom = 0;

});

/*
btnNoc.addEventListener('click', () => {

  console.log('Noćna tema');
  document.body.style.backgroundColor = "rgba(20, 20, 20, 0.8)";
  document.body.style.color = "white";

});
*/


/////////////////////////////////////////
/////////////////////////////////////////
////////proračun volatilnosti////////////
/////////////////////////////////////////
/////////////////////////////////////////

function updateVolatilityLabel(level, elementId = "volatility7dText") {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.classList.remove("vol-high", "vol-medium", "vol-low");

  if (level === "visoka") {
    el.textContent = "visoka";
    el.classList.add("vol-high");
  } else if (level === "umerena") {
    el.textContent = "umerena";
    el.classList.add("vol-medium");
  } else {
    el.textContent = "niska";
    el.classList.add("vol-low");
  }
}

function refreshVolatility(period = "7d", elementId = "volatility7dText") {
  const moves = MARKET_SYMBOLS
    .map(symbol => getChangePercent(symbol, period))
    .filter(Number.isFinite);

  if (moves.length === 0) return;

  const maxAbsMove = Math.max(...moves.map(value => Math.abs(value)));

  if (maxAbsMove >= 8) {
    updateVolatilityLabel("visoka", elementId);
  } else if (maxAbsMove >= 3) {
    updateVolatilityLabel("umerena", elementId);
  } else {
    updateVolatilityLabel("niska", elementId);
  }
}

/////////////////////////////////////////
/////////////////////////////////////////
////////proračun volatilnosti////////////
/////////////////////////////////////////
/////////////////////////////////////////


//-------------------------------------//

//////////////////////////////////////////
//////////////////////////////////////////
/////////analiza-u-realnom-vremenu////////
//////////////////////////////////////////
//////////////////////////////////////////


const analysisState = {
  btcCurrent: null,
  ethCurrent: null,
  solCurrent: null,
  btc7dBase: null,
  eth7dBase: null,
  sol7dBase: null,
  btc30dBase: null,
  eth30dBase: null,
  sol30dBase: null,
  lastMarketTick: null
};

const MARKET_SYMBOLS = ["btc", "eth", "sol"];

function setCoinIconSize(size) {
  coinIcons.forEach(icon => {
    icon.style.width = size;
    icon.style.height = size;
  });
}

function updateMarketStateFromTick(market) {
  if (!market) return;

  analysisState.lastMarketTick = market;

  MARKET_SYMBOLS.forEach(symbol => {
    const item = market[symbol];
    const price = Number(item?.price);

    if (!item || !Number.isFinite(price)) return;

    updateMarketInstrument(symbol, price, Number(item.changePercent));
    analysisState[`${symbol}Current`] = price;
  });
}

function formatPercentSR(value) {
  return Number(value).toLocaleString("sr-RS", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + "%";
}

function updateAnalysisItem(symbol, pct, period = "7d") {

  const pctEl = document.getElementById(`${symbol}${period}Change`);
  const trendEl = document.getElementById(period === "7d" ? `${symbol}TrendText` : `${symbol}${period}TrendText`);

  if (!pctEl || !trendEl || !Number.isFinite(pct)) return;

  pctEl.classList.remove("change-up", "change-down", "change-flat");

  if (pct > 0) {
    trendEl.textContent = "porasla je";
    pctEl.textContent = `+${formatPercentSR(pct)}`;
    pctEl.classList.add("change-up");
  } else if (pct < 0) {
    trendEl.textContent = "opala je";
    pctEl.textContent = formatPercentSR(pct);
    pctEl.classList.add("change-down");
  } else {
    trendEl.textContent = "ostala nepromenjena";
    pctEl.textContent = formatPercentSR(pct);
    pctEl.classList.add("change-flat");
  }

}

function getChangePercent(symbol, period) {
  const current = analysisState[`${symbol}Current`];
  const base = analysisState[`${symbol}${period}Base`];

  if (!Number.isFinite(current) || !Number.isFinite(base) || base <= 0) {
    return null;
  }

  return ((current - base) / base) * 100;
}

function get7dChangePercent(symbol) {
  return getChangePercent(symbol, "7d");
}

function get30dChangePercent(symbol) {
  return getChangePercent(symbol, "30d");
}

function refreshMarketAnalysis() {
  MARKET_SYMBOLS.forEach(symbol => {
    const pct7d = get7dChangePercent(symbol);
    const pct30d = get30dChangePercent(symbol);

    if (Number.isFinite(pct7d)) updateAnalysisItem(symbol, pct7d, "7d");
    if (Number.isFinite(pct30d)) updateAnalysisItem(symbol, pct30d, "30d");
  });

  refreshVolatility("7d", "volatility7dText");
  refreshVolatility("30d", "volatility30dText");

}

async function load7dBasePrices() {

  try {
    const res = await fetch("/api/market-7d");
    if (!res.ok) throw new Error("HTTP " + res.status);

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "market-7d error");

    analysisState.btc7dBase = Number(data.btcBase);
    analysisState.eth7dBase = Number(data.ethBase);
    analysisState.sol7dBase = Number(data.solBase);

    refreshMarketAnalysis();
  } catch (err) {
    console.error("Greška u load7dBasePrices():", err);
  }

}

async function load30dBasePrices() {

  try {
    const res = await fetch("/api/market-30d");
    if (!res.ok) throw new Error("HTTP " + res.status);

    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "market-30d error");

    analysisState.btc30dBase = Number(data.btcBase);
    analysisState.eth30dBase = Number(data.ethBase);
    analysisState.sol30dBase = Number(data.solBase);

    refreshMarketAnalysis();
  } catch (err) {
    console.error("Greška u load30dBasePrices():", err);
  }

}


////////////////////////////////////////////////////////
////////////////////////////////////////////////////////
////////////////////////////////////////////////////////
//////////////TradingView optimizacija//////////////////
////////////////////////////////////////////////////////
////////////////////////////////////////////////////////

/* ==============================
   Lazy Loading TradingView optimizacija učitavanja widget-a
============================== */

class LazyLoad extends HTMLElement {

    connectedCallback() {

        if (this.dataset.loaded === "true")
            return;

        this.setAttribute("aria-busy", "true");
        this.dataset.state = "waiting";
        LazyLoad.register(this);

        LazyLoad.scheduleBufferLoad();

    }

    disconnectedCallback() {

        LazyLoad.instances = LazyLoad.instances.filter(element => element !== this);

    }

    static register(element) {

        if (!LazyLoad.instances.includes(element)) {
            LazyLoad.instances.push(element);
        }

        LazyLoad.instances.sort(LazyLoad.comparePosition);

        if (LazyLoad.bufferStarted) {
            LazyLoad.enqueue(element);
        }

    }

    static comparePosition(a, b) {

        if (a === b)
            return 0;

        const order = a.compareDocumentPosition(b);
        return order & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;

    }

    static scheduleBufferLoad() {

        if (LazyLoad.bufferScheduled)
            return;

        LazyLoad.bufferScheduled = true;

        const startAfterPaint = () => {

            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    window.setTimeout(() => LazyLoad.enqueueBufferedWidgets(), 150);
                });
            });

        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", startAfterPaint, { once: true });
        } else {
            startAfterPaint();
        }

    }

    static enqueueBufferedWidgets() {

        LazyLoad.bufferStarted = true;

        LazyLoad.instances
            .slice()
            .sort(LazyLoad.comparePosition)
            .forEach(element => LazyLoad.enqueue(element));

    }

    static enqueue(element) {

        if (element.dataset.loaded === "true" || element.dataset.queued === "true")
            return;

        element.dataset.queued = "true";
        element.dataset.state = "queued";
        LazyLoad.queue.push(element);
        LazyLoad.queue.sort((a, b) => {
            const order = a.compareDocumentPosition(b);
            return order & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
        });

        LazyLoad.processQueue();

    }

    static async processQueue() {

        if (LazyLoad.isLoading)
            return;

        const element = LazyLoad.queue.shift();

        if (!element)
            return;

        LazyLoad.isLoading = true;
        await element.loadContent();
        LazyLoad.isLoading = false;
        LazyLoad.processQueue();

    }

    async loadContent() {

        const template = this.querySelector("template");

        if (!template) {
            this.finishLoading();
            return;
        }

        this.dataset.state = "loading";

        const fragment = template.content.cloneNode(true);
        const scripts = Array.from(fragment.querySelectorAll("script"));
        const scriptLoads = [];

        scripts.forEach((oldScript) => {

            const script = document.createElement("script");

            Array.from(oldScript.attributes).forEach((attr) => {
                script.setAttribute(attr.name, attr.value);
            });

            script.textContent = oldScript.textContent;

            scriptLoads.push(new Promise((resolve) => {
                script.addEventListener("load", resolve, { once: true });
                script.addEventListener("error", resolve, { once: true });
            }));

            oldScript.replaceWith(script);

        });

        this.appendChild(fragment);
        template.remove();

        await Promise.race([
            Promise.all(scriptLoads),
            new Promise(resolve => setTimeout(resolve, 1200))
        ]);

        this.finishLoading();

    }

    finishLoading() {

        this.dataset.loaded = "true";
        this.dataset.state = "loaded";
        this.setAttribute("aria-busy", "false");
        delete this.dataset.queued;

    }


}

LazyLoad.queue = [];
LazyLoad.instances = [];
LazyLoad.isLoading = false;
LazyLoad.bufferScheduled = false;
LazyLoad.bufferStarted = false;

if (!customElements.get("lazy-load")) {
    customElements.define("lazy-load", LazyLoad);
}



//////////////////////////////////////////
//////////////////////////////////////////
/////////analiza-u-realnom-vremenu////////
//////////////////////////////////////////
//////////////////////////////////////////

function setLiveStatus(isOnline) {

  const el = document.getElementById("liveStatus");
  const text = el?.querySelector(".live-text");

  if (!el || !text) return;

  el.classList.remove("live-on", "live-off");

  if (isOnline) {

    el.classList.add("live-on");
    text.textContent = "Live (24/7)";

  } else {

    el.classList.add("live-off");
    text.textContent = "Offline";
    text.style.opacity = '0.5';

  }

}

//////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////
/////////self-analysis - A-L market analitički mehanizam/////////
////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////

async function loadLatestAnalysis() {
  const res = await fetch("/api/self-analysis/latest");
  const report = await res.json();
  renderAnalysis(report);
}

async function loadAnalysisHistory() {
  const res = await fetch("/api/self-analysis/history");
  const reports = await res.json();

  const select = document.getElementById("analysisHistorySelect");
  select.innerHTML = "";

  reports.forEach(report => {
    const option = document.createElement("option");
    option.value = report.id || report.generatedAt || report.date;
    option.textContent = report.generatedAt
      ? `${report.generatedAt} | ${report.signal}`
      : `${report.date} | ${report.signal}`;
    select.appendChild(option);
  });

  select.onchange = async () => {
    const res = await fetch(`/api/self-analysis/${encodeURIComponent(select.value)}`);
    const report = await res.json();
    renderAnalysis(report);
  };
}

async function generateSelfAnalysisNow() {

    await sendMarketSnapshotToServer();

    const res = await fetch("/api/self-analysis/generate");
    const report = await res.json();

    renderAnalysis(report);
    await loadAnalysisHistory();
}

function renderAnalysis(report) {
  const reportDate = report.generatedAt || report.date;

  document.getElementById("analysisDate").textContent = `Datum: ${reportDate}`;
  document.getElementById("marketState").textContent = report.marketState;
  document.getElementById("riskLevel").textContent = report.riskLevel;
  document.getElementById("marketSignal").textContent = report.signal;
  document.getElementById("analysisSummary").textContent = report.summary;
}

let autoAnalysisCountdownTimer = null;
let autoAnalysisScheduleRefreshTimer = null;
let autoAnalysisScheduleLabelInterval = null;
let nextAutoAnalysisAtMs = null;
let serverClockOffsetMs = 0;

function formatCountdownTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

function getFallbackNextAutoAnalysisTime(now = new Date()) {
  const nextAnalysis = new Date(now);
  nextAnalysis.setHours(8, 0, 0, 0);

  if (nextAnalysis <= now) {
    nextAnalysis.setDate(nextAnalysis.getDate() + 1);
  }

  return nextAnalysis;
}

async function refreshAutoAnalysisSchedule() {
  try {
    const res = await fetch("/api/self-analysis/schedule", { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`Schedule API error: ${res.status}`);
    }

    const schedule = await res.json();
    const serverNowMs = Date.parse(schedule.serverNow);
    const nextRunMs = Date.parse(schedule.nextRun);

    if (Number.isFinite(serverNowMs)) {
      serverClockOffsetMs = serverNowMs - Date.now();
    }

    if (Number.isFinite(nextRunMs)) {
      nextAutoAnalysisAtMs = nextRunMs;
    }
  } catch (err) {
    console.warn("Nije moguće učitati cron raspored automatske analize:", err);

    if (!nextAutoAnalysisAtMs) {
      nextAutoAnalysisAtMs = getFallbackNextAutoAnalysisTime().getTime();
      serverClockOffsetMs = 0;
    }
  }

  updateAutoAnalysisCountdown();
}

function updateAutoAnalysisCountdown() {
  const countdown = document.getElementById("autoAnalysisCountdown");

  if (!countdown) {
    return;
  }

  const nowMs = Date.now() + serverClockOffsetMs;
  const targetMs = nextAutoAnalysisAtMs && nextAutoAnalysisAtMs > nowMs
    ? nextAutoAnalysisAtMs
    : getFallbackNextAutoAnalysisTime(new Date(nowMs)).getTime();
  const remainingSeconds = Math.max(0, Math.floor((targetMs - nowMs) / 1000));

  countdown.textContent = formatCountdownTime(remainingSeconds);
}

function startAutoAnalysisCountdown() {
  refreshAutoAnalysisSchedule();
  updateAutoAnalysisCountdown();

  if (autoAnalysisCountdownTimer) {
    clearInterval(autoAnalysisCountdownTimer);
  }

  if (autoAnalysisScheduleRefreshTimer) {
    clearInterval(autoAnalysisScheduleRefreshTimer);
  }

  if (autoAnalysisScheduleLabelInterval) {
    clearInterval(autoAnalysisScheduleLabelInterval);
  }

  const scheduleLabel = document.getElementById("autoAnalysisScheduleLabel");

  if (scheduleLabel) {
    let showCronLabel = true;
    scheduleLabel.textContent = "prema cron rasporedu";

    autoAnalysisScheduleLabelInterval = setInterval(() => {
      showCronLabel = !showCronLabel;
      scheduleLabel.textContent = showCronLabel ? "sinhronizovano sa serverom" : "~8 AM";
    }, 5000);
  }

  autoAnalysisCountdownTimer = setInterval(updateAutoAnalysisCountdown, 1000);
  autoAnalysisScheduleRefreshTimer = setInterval(refreshAutoAnalysisSchedule, 60 * 1000);
}

function readMarketSnapshot() {
  const snapshot = {
    collectedAt: new Date().toISOString()
  };

  MARKET_SYMBOLS.forEach(symbol => {
    const tick = analysisState.lastMarketTick?.[symbol] || {};
    const price = Number(analysisState[`${symbol}Current`]);
    const change24h = Number(tick.changePercent);
    const change7d = get7dChangePercent(symbol);
    const change30d = get30dChangePercent(symbol);

    snapshot[symbol] = {
      price: Number.isFinite(price) ? price : null,
      change24h: Number.isFinite(change24h) ? change24h : null,
      base7d: Number.isFinite(analysisState[`${symbol}7dBase`]) ? analysisState[`${symbol}7dBase`] : null,
      change7d: Number.isFinite(change7d) ? change7d : null,
      base30d: Number.isFinite(analysisState[`${symbol}30dBase`]) ? analysisState[`${symbol}30dBase`] : null,
      change30d: Number.isFinite(change30d) ? change30d : null
    };
  });

  return snapshot;
}

async function sendMarketSnapshotToServer() {
  const marketData = readMarketSnapshot();

  await fetch("/api/market-snapshot", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(marketData)
  });
}

loadLatestAnalysis();
loadAnalysisHistory();
startAutoAnalysisCountdown();

setTimeout(sendMarketSnapshotToServer, 3000);
setInterval(sendMarketSnapshotToServer, 5 * 60 * 1000);
