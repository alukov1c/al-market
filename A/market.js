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
    setLiveStatus(false);

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
  let freshCount = 0;
  MARKET_SYMBOLS.forEach(symbol => {
    const item = market[symbol];
    const fresh = item && typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0 &&
      Date.now() - (item.updatedAt ?? market.t) < 30000;
    if (!fresh) {
      analysisState[`${symbol}Current`] = null;
      updateMarketInstrument(symbol, null, null);
      return;
    }
    freshCount++;
    updateMarketInstrument(symbol, item.price, item.changePercent);
    analysisState[`${symbol}Current`] = item.price;
  });
  setLiveStatus(freshCount === MARKET_SYMBOLS.length);
}
setInterval(() => {
  if (analysisState.lastMarketTick) updateMarketStateFromTick(analysisState.lastMarketTick);
}, 5000);

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

const tradingViewCharts = {
    xau: {
        title: "Grafik - Zlato - XAU",
        analysisTitle: "XAU tehnička analiza",
        analysisEnglishTitle: "XAUUSD Analysis on TradingView",
        symbol: "OANDA:XAUUSD",
        href: "https://www.tradingview.com/symbols/XAUUSD/?exchange=OANDA",
        label: "XAU grafik"
    },
    xbr: {
        title: "Grafik - Nafta - XBR",
        analysisTitle: "XBR tehnička analiza",
        analysisEnglishTitle: "XBRUSD Analysis on TradingView",
        analysisUnavailable: true,
        symbol: "ICMARKETS:XBRUSD",
        href: "https://www.tradingview.com/symbols/XBRUSD/?exchange=ICMARKETS",
        label: "XBR grafik"
    },
    total: {
        title: "Grafik - Crypto Total Market Cap - TOTAL ",
        analysisTitle: "TOTAL tehnička analiza",
        analysisEnglishTitle: "TOTAL Analysis on TradingView",
        symbol: "CRYPTOCAP:TOTAL",
        href: "https://www.tradingview.com/symbols/TOTAL/?exchange=CRYPTOCAP",
        label: "Kripto TOTAL"
    },
    btc: {
        title: "Grafik - BTC",
        analysisTitle: "BTC tehnička analiza",
        analysisEnglishTitle: "BTCUSD Analysis on TradingView",
        symbol: "BITSTAMP:BTCUSD",
        href: "https://www.tradingview.com/symbols/BTCUSD/?exchange=BITSTAMP",
        label: "BTC grafik"
    },
    eth: {
        title: "Grafik - ETH",
        analysisTitle: "ETH tehnička analiza",
        analysisEnglishTitle: "ETHUSD Analysis on TradingView",
        symbol: "COINBASE:ETHUSD",
        href: "https://www.tradingview.com/symbols/ETHUSD/?exchange=COINBASE",
        label: "ETH grafik"
    },
    sol: {
        title: "Grafik - Solana",
        analysisTitle: "SOL tehnička analiza",
        analysisEnglishTitle: "SOLUSDT Analysis on TradingView",
        symbol: "BINANCE:SOLUSDT",
        href: "https://www.tradingview.com/symbols/SOLUSDT/?exchange=BINANCE",
        label: "SOL grafik"
    },
    chf: {
        title: "Forex - Grafik - CHF",
        analysisTitle: "CHF tehnička analiza",
        analysisEnglishTitle: "CHFUSD Analysis on TradingView",
        symbol: "FX_IDC:CHFUSD",
        href: "https://www.tradingview.com/symbols/CHFUSD/?exchange=FX_IDC",
        label: "CHF grafik"
    },
    aud: {
        title: "Forex - Grafik - AUD",
        analysisTitle: "AUD tehnička analiza",
        analysisEnglishTitle: "AUDUSD Analysis on TradingView",
        symbol: "OANDA:AUDUSD",
        href: "https://www.tradingview.com/symbols/AUDUSD/?exchange=OANDA",
        label: "AUD grafik"
    },
    nvda: {
        title: "Berza - Grafik - NVIDIA",
        analysisTitle: "NVIDIA tehnička analiza",
        analysisEnglishTitle: "NVDA Analysis on TradingView",
        symbol: "NASDAQ:NVDA",
        href: "https://www.tradingview.com/symbols/NVDA/?exchange=NASDAQ",
        label: "NVIDIA grafik"
    }
};

const tradingViewChartPanes = new Map();
const technicalAnalysisPanes = new Map();
let tradingViewBackgroundLoadStarted = false;
let technicalAnalysisBackgroundLoadStarted = false;
let activeTradingViewChartKey = "xau";

function createTradingViewChart(chartKey) {
    const chart = tradingViewCharts[chartKey];
    const chartHost = document.querySelector("#activeTradingViewChart");
    const isCompactTablet = window.matchMedia(
        "(min-width: 701px) and (max-width: 1366px) and (max-height: 900px)"
    ).matches;

    if (!chart || !chartHost) return Promise.resolve(null);
    if (tradingViewChartPanes.has(chartKey)) {
        return Promise.resolve(tradingViewChartPanes.get(chartKey));
    }

    const chartPane = document.createElement("div");
    chartPane.className = "tradingview-chart-pane is-preloading";
    chartPane.dataset.chart = chartKey;

    const widgetContainer = document.createElement("div");
    widgetContainer.className = "tradingview-widget-container";

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";

    const copyright = document.createElement("div");
    copyright.className = "tradingview-widget-copyright";

    const link = document.createElement("a");
    link.href = chart.href;
    link.rel = "noopener nofollow";
    link.target = "_blank";

    const label = document.createElement("span");
    label.className = "blue-text";
    label.textContent = chart.label;
    link.appendChild(label);
    copyright.appendChild(link);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.textContent = JSON.stringify({
        allow_symbol_change: true,
        calendar: false,
        details: false,
        hide_side_toolbar: true,
        hide_top_toolbar: false,
        hide_legend: false,
        hide_volume: false,
        hotlist: false,
        interval: "D",
        locale: "en",
        save_image: true,
        style: "1",
        symbol: chart.symbol,
        theme: "light",
        timezone: "Etc/UTC",
        backgroundColor: "#ffffff",
        gridColor: "rgba(46, 46, 46, 0.06)",
        watchlist: [],
        withdateranges: false,
        compareSymbols: [],
        studies: [],
        width: "100%",
        height: isCompactTablet ? 390 : 500
    });

    const chartLoaded = new Promise((resolve) => {
        const finishLoading = () => {
            chartPane.dataset.loaded = "true";
            chartPane.classList.remove("is-preloading");
            chartPane.hidden = chartKey !== activeTradingViewChartKey;
            resolve(chartPane);
        };

        script.addEventListener("load", finishLoading, { once: true });
        script.addEventListener("error", finishLoading, { once: true });
        setTimeout(finishLoading, 2500);
    });

    widgetContainer.append(widget, copyright, script);
    chartPane.appendChild(widgetContainer);
    chartHost.appendChild(chartPane);
    tradingViewChartPanes.set(chartKey, chartPane);

    return chartLoaded;
}

async function loadTradingViewChartsInBackground(activeChartKey) {
    if (tradingViewBackgroundLoadStarted) return;
    tradingViewBackgroundLoadStarted = true;

    for (const chartKey of Object.keys(tradingViewCharts)) {
        if (chartKey === activeChartKey) continue;
        await createTradingViewChart(chartKey);
    }
}

async function showTradingViewChart(chartKey) {
    const chart = tradingViewCharts[chartKey];
    const chartHost = document.querySelector("#activeTradingViewChart");
    const chartTitle = document.querySelector("#activeChartTitle");

    if (!chart || !chartHost || !chartTitle) return;

    activeTradingViewChartKey = chartKey;
    chartTitle.textContent = chart.title;
    chartHost.setAttribute("aria-busy", "true");

    const chartPane = await createTradingViewChart(chartKey);

    if (chartKey !== activeTradingViewChartKey) return;

    tradingViewChartPanes.forEach((pane, paneKey) => {
        pane.classList.remove("is-preloading");
        pane.hidden = paneKey !== chartKey;
    });

    chartHost.setAttribute("aria-busy", "false");
    loadTradingViewChartsInBackground(chartKey);
}

function createTechnicalAnalysis(chartKey) {
    const chart = tradingViewCharts[chartKey];
    const analysisHost = document.querySelector("#activeTechnicalAnalysis");

    if (!chart || !analysisHost) return null;
    if (technicalAnalysisPanes.has(chartKey)) {
        return technicalAnalysisPanes.get(chartKey);
    }

    const analysisPane = document.createElement("div");
    analysisPane.className = "technical-analysis-pane";
    analysisPane.dataset.chart = chartKey;
    analysisPane.hidden = chartKey !== activeTradingViewChartKey;

    if (chart.analysisUnavailable) {
        const message = document.createElement("div");
        message.className = "technical-analysis-unavailable";
        message.textContent = "Tehnička analiza za XBR nije dostupna. Za sve ostale instrumente jeste. ";
        analysisPane.appendChild(message);
        analysisHost.appendChild(analysisPane);
        technicalAnalysisPanes.set(chartKey, analysisPane);
        return analysisPane;
    }

    const analysisWidget = document.createElement("tv-technical-analysis");
    analysisWidget.setAttribute("symbol", chart.analysisSymbol || chart.symbol);

    const copyright = document.createElement("div");
    copyright.className = "technical-analysis-copyright";

    const link = document.createElement("a");
    link.href = chart.analysisHref || chart.href;
    link.rel = "noopener nofollow";
    link.target = "_blank";

    const label = document.createElement("span");
    label.className = "blue-text";
    label.textContent = chart.analysisTitle;
    label.appendChild(document.createComment(` ${chart.analysisEnglishTitle} `));
    link.appendChild(label);
    copyright.appendChild(link);

    analysisPane.append(analysisWidget, copyright);
    analysisHost.appendChild(analysisPane);
    technicalAnalysisPanes.set(chartKey, analysisPane);

    return analysisPane;
}

function loadTechnicalAnalysisInBackground(activeChartKey) {
    if (technicalAnalysisBackgroundLoadStarted) return;
    technicalAnalysisBackgroundLoadStarted = true;

    Object.keys(tradingViewCharts).forEach((chartKey) => {
        if (chartKey !== activeChartKey) createTechnicalAnalysis(chartKey);
    });
}

function showTechnicalAnalysis(chartKey) {
    const chart = tradingViewCharts[chartKey];
    const analysisTitle = document.querySelector("#technicalAnalysisTitle");

    if (!chart || !analysisTitle) return;

    analysisTitle.textContent = chart.analysisTitle;
    createTechnicalAnalysis(chartKey);

    technicalAnalysisPanes.forEach((pane, paneKey) => {
        pane.hidden = paneKey !== chartKey;
    });

    loadTechnicalAnalysisInBackground(chartKey);
}

function getZonedTime(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(date);

    return Object.fromEntries(
        parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
    );
}

function getMarketStatus(date) {
    const newYork = getZonedTime(date, "America/New_York");
    const utc = getZonedTime(date, "UTC");
    const newYorkMinutes = Number(newYork.hour) * 60 + Number(newYork.minute);
    const utcMinutes = Number(utc.hour) * 60 + Number(utc.minute);
    const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const newYorkDay = weekdayIndex[newYork.weekday];
    const utcDay = weekdayIndex[utc.weekday];
    const dateKey = `${newYork.year}-${newYork.month}-${newYork.day}`;
    const nasdaqHolidays2026 = new Set([
        "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
        "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"
    ]);
    const nasdaqEarlyClose2026 = new Set(["2026-11-27", "2026-12-24"]);
    const isForexOpen = (newYorkDay === 0 && newYorkMinutes >= 17 * 60)
        || (newYorkDay >= 1 && newYorkDay <= 4)
        || (newYorkDay === 5 && newYorkMinutes < 17 * 60);
    const isGoldOpen = (newYorkDay === 0 && newYorkMinutes >= 18 * 60)
        || (newYorkDay >= 1 && newYorkDay <= 4
            && (newYorkMinutes < 17 * 60 || newYorkMinutes >= 18 * 60))
        || (newYorkDay === 5 && newYorkMinutes < 17 * 60);
    const isBrentOpen = (utcDay === 0 && utcMinutes >= 22 * 60)
        || (utcDay >= 1 && utcDay <= 4 && utcMinutes < 22 * 60)
        || (utcDay === 5 && utcMinutes < 22 * 60);
    const nasdaqClose = nasdaqEarlyClose2026.has(dateKey) ? 13 * 60 : 16 * 60;
    const isNasdaqOpen = newYorkDay >= 1 && newYorkDay <= 5
        && !nasdaqHolidays2026.has(dateKey)
        && newYorkMinutes >= 9 * 60 + 30
        && newYorkMinutes < nasdaqClose;

    return {
        gold: isGoldOpen,
        brent: isBrentOpen,
        crypto: true,
        forex: isForexOpen,
        nasdaq: isNasdaqOpen
    };
}

function updateMarketStatusMessage(chartKey, leadText) {
    const message = document.querySelector("#marketStatusMessage");
    const chartLabels = { nvda: "NVIDIA" };
    const marketLeadTexts = {
        xau: "Tržište zlata je otvoreno",
        xbr: "Tržište nafte je otvoreno",
        total: "Kripto tržište je otvoreno (24/7)",
        btc: "Kripto tržište je otvoreno (24/7)",
        eth: "Kripto tržište je otvoreno (24/7)",
        sol: "Kripto tržište je otvoreno (24/7)",
        chf: "Forex tržište je otvoreno",
        aud: "Forex tržište je otvoreno",
        nvda: getMarketStatus(new Date()).nasdaq
            ? "Nasdaq berza je otvorena"
            : "Nasdaq berza je zatvorena"
    };

    if (!message || !chartKey) return;
    message.dataset.leadText = leadText || marketLeadTexts[chartKey] || "Tržište je otvoreno";
    if (!message.dataset.leadText) return;

    const chartLabel = chartLabels[chartKey] || chartKey.toUpperCase();
    message.textContent = `${message.dataset.leadText} — prikazan je ${chartLabel} grafikon.`;
}

function initMarketStatusBar(activateDefaultChart, hasManualSelection) {
    const clock = document.querySelector("#marketStatusClock");
    const message = document.querySelector("#marketStatusMessage");
    const items = Array.from(document.querySelectorAll("[data-market-status]"));

    if (!clock || !message || !items.length) return;

    const clockFormatter = new Intl.DateTimeFormat("sr-RS", {
        timeZone: "Europe/Belgrade",
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    });
    let previousGoldStatus = null;

    const updateStatus = () => {
        const now = new Date();
        const status = getMarketStatus(now);
        const belgrade = getZonedTime(now, "Europe/Belgrade");
        const isWeekend = belgrade.weekday === "Sat" || belgrade.weekday === "Sun";

        clock.dateTime = now.toISOString();
        clock.textContent = clockFormatter.format(now);

        items.forEach((item) => {
            const isOpen = status[item.dataset.marketStatus];
            item.classList.toggle("is-open", isOpen);
            item.title = isOpen ? "Tržište je aktivno" : "Tržište nije aktivno";
        });

        const activeChartKey = document.querySelector(".chart-symbol.is-active")?.dataset.chart;
        if (activeChartKey === "nvda") updateMarketStatusMessage(activeChartKey);

        if (previousGoldStatus === null) {
            if (isWeekend || !status.gold) {
                activateDefaultChart("total");
                updateMarketStatusMessage("total", "Kripto tržište je otvoreno (24/7)");
            } else {
                activateDefaultChart("xau");
                updateMarketStatusMessage("xau", "Tržište zlata je otvoreno");
            }
        } else if (!previousGoldStatus && status.gold && !hasManualSelection()) {
            activateDefaultChart("xau");
            updateMarketStatusMessage("xau", "Tržište zlata je otvoreno");
        }

        previousGoldStatus = status.gold;
    };

    updateStatus();
    window.setInterval(updateStatus, 1000);
}

const forexSessions = {
    sydney: {
        label: "Sidnej",
        timeZone: "Australia/Sydney",
        openMinutes: 7 * 60,
        closeMinutes: 16 * 60
    },
    tokyo: {
        label: "Tokio",
        timeZone: "Asia/Tokyo",
        openMinutes: 9 * 60,
        closeMinutes: 18 * 60
    },
    london: {
        label: "London",
        timeZone: "Europe/London",
        openMinutes: 8 * 60,
        closeMinutes: 17 * 60
    },
    newYork: {
        label: "Njujork",
        timeZone: "America/New_York",
        openMinutes: 8 * 60,
        closeMinutes: 17 * 60
    }
};

function isForexSessionOpen(date, session) {
    const zonedTime = getZonedTime(date, session.timeZone);
    const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = weekdayIndex[zonedTime.weekday];
    const minutes = Number(zonedTime.hour) * 60 + Number(zonedTime.minute);

    return day >= 1 && day <= 5
        && minutes >= session.openMinutes
        && minutes < session.closeMinutes;
}

function getForexSessionCloseCountdown(date, session) {
    const zonedTime = getZonedTime(date, session.timeZone);
    const currentSeconds = Number(zonedTime.hour) * 3600
        + Number(zonedTime.minute) * 60
        + date.getSeconds();
    const remainingSeconds = Math.max(0, session.closeMinutes * 60 - currentSeconds);
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;

    return [hours, minutes, seconds]
        .map((value) => String(value).padStart(2, "0"))
        .join(":");
}

function formatForexCountdown(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [hours, minutes, seconds]
        .map((value) => String(value).padStart(2, "0"))
        .join(":");
}

function findNextForexSessionOpen(date, session) {
    const searchStep = 30 * 60 * 1000;
    let closedTime = date.getTime();
    let openTime = closedTime + searchStep;

    while (!isForexSessionOpen(new Date(openTime), session)) {
        closedTime = openTime;
        openTime += searchStep;
    }

    while (openTime - closedTime > 1000) {
        const middleTime = Math.floor((closedTime + openTime) / 2000) * 1000;

        if (isForexSessionOpen(new Date(middleTime), session)) {
            openTime = middleTime;
        } else {
            closedTime = middleTime;
        }
    }

    return openTime;
}

function initForexSessions() {
    const section = document.querySelector(".forex-sessions-section");
    const localClock = document.querySelector("#forexLocalClock");
    const utcClock = document.querySelector("#forexUtcClock");
    const summary = document.querySelector("#forexSessionsSummary");

    if (!section || !localClock || !utcClock || !summary) return;

    const localFormatter = new Intl.DateTimeFormat("sr-RS", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    });
    const utcFormatter = new Intl.DateTimeFormat("sr-RS", {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    });
    const sessionClockFormatters = Object.fromEntries(
        Object.entries(forexSessions).map(([key, session]) => [
            key,
            new Intl.DateTimeFormat("sr-RS", {
                timeZone: session.timeZone,
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23"
            })
        ])
    );
    const nextSessionOpenTimes = new Map();

    const updateSessions = () => {
        const now = new Date();
        const openSessions = [];

        localClock.dateTime = now.toISOString();
        localClock.textContent = localFormatter.format(now);
        utcClock.dateTime = now.toISOString();
        utcClock.textContent = `${utcFormatter.format(now)} UTC`;

        Object.entries(forexSessions).forEach(([key, session]) => {
            const card = section.querySelector(`[data-forex-session="${key}"]`);
            if (!card) return;

            const isOpen = isForexSessionOpen(now, session);
            const state = card.querySelector(".forex-session-state strong");
            const clock = card.querySelector("[data-session-clock]");
            const countdown = card.querySelector("[data-session-countdown]");

            card.classList.toggle("is-open", isOpen);
            card.setAttribute(
                "aria-label",
                `${session.label} sesija je ${isOpen ? "otvorena" : "zatvorena"}`
            );
            state.textContent = isOpen ? "Otvorena" : "Zatvorena";
            clock.dateTime = now.toISOString();
            clock.textContent = sessionClockFormatters[key].format(now);

            if (isOpen) {
                nextSessionOpenTimes.delete(key);
                countdown.textContent = `Zatvara se za ${getForexSessionCloseCountdown(now, session)}`;
            } else {
                let nextOpenTime = nextSessionOpenTimes.get(key);

                if (!nextOpenTime || nextOpenTime <= now.getTime()) {
                    nextOpenTime = findNextForexSessionOpen(now, session);
                    nextSessionOpenTimes.set(key, nextOpenTime);
                }

                const remainingSeconds = Math.max(
                    0,
                    Math.ceil((nextOpenTime - now.getTime()) / 1000)
                );
                countdown.textContent = `Otvara se za ${formatForexCountdown(remainingSeconds)}`;
            }

            countdown.hidden = false;

            if (isOpen) openSessions.push(session.label);
        });

        summary.textContent = openSessions.length
            ? `Aktivne sesije: ${openSessions.join(", ")}.`
            : "Trenutno nema aktivnih glavnih forex sesija.";
    };

    updateSessions();
    window.setInterval(updateSessions, 1000);
}

function initTradingViewChartSwitcher() {
    const menu = document.querySelector(".chart-symbol-menu");

    if (!menu) return;

    const tabs = Array.from(menu.querySelectorAll(".chart-symbol"));
    let hasManualChartSelection = false;

    const activateTab = (tab, isManual = false) => {
        if (!tab) return;
        if (isManual) hasManualChartSelection = true;

        tabs.forEach((item) => {
            const isActive = item === tab;
            item.classList.toggle("is-active", isActive);
            item.setAttribute("aria-selected", String(isActive));
            item.tabIndex = isActive ? 0 : -1;
        });

        showTradingViewChart(tab.dataset.chart);
        showTechnicalAnalysis(tab.dataset.chart);
        updateMarketStatusMessage(tab.dataset.chart);
    };

    menu.addEventListener("click", (event) => {
        const tab = event.target.closest(".chart-symbol");
        if (tab) activateTab(tab, true);
    });

    menu.addEventListener("keydown", (event) => {
        const currentIndex = tabs.indexOf(document.activeElement);
        if (currentIndex < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

        event.preventDefault();
        let nextIndex = currentIndex;

        if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;

        tabs[nextIndex].focus();
        activateTab(tabs[nextIndex], true);
    });

    initMarketStatusBar(
        (chartKey) => activateTab(tabs.find((tab) => tab.dataset.chart === chartKey)),
        () => hasManualChartSelection
    );
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTradingViewChartSwitcher, { once: true });
    document.addEventListener("DOMContentLoaded", initForexSessions, { once: true });
} else {
    initTradingViewChartSwitcher();
    initForexSessions();
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
    text.style.opacity = '1';

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

  document.getElementById("analysisDate").textContent = `Datum poslednje analize: ${reportDate}`;
  document.getElementById("marketState").textContent = report.marketState;
  document.getElementById("riskLevel").textContent = report.riskLevel;
  document.getElementById("marketSignal").textContent = report.signal;
  document.getElementById("analysisSummary").textContent = report.summary;
}

let autoAnalysisCountdownTimer = null;
let autoAnalysisScheduleRefreshTimer = null;
let autoAnalysisApproxTimeTimer = null;
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

  if (autoAnalysisApproxTimeTimer) {
    clearInterval(autoAnalysisApproxTimeTimer);
  }

  const approxTime = document.getElementById("autoAnalysisApproxTime");

  if (approxTime) {
    approxTime.classList.remove("is-hidden");
    autoAnalysisApproxTimeTimer = setInterval(() => {
      approxTime.classList.toggle("is-hidden");
    }, 5000);
  }

  autoAnalysisCountdownTimer = setInterval(updateAutoAnalysisCountdown, 1000);
  autoAnalysisScheduleRefreshTimer = setInterval(refreshAutoAnalysisSchedule, 60 * 1000);
}

loadLatestAnalysis();
loadAnalysisHistory();
startAutoAnalysisCountdown();



