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
let marginA = 16.74; //28.1.2026.

//let T_A_CHF = 5183.41; //24.12.2025. => trzisteA = 343,05
//let T_A_CHF = 5309.61; //31.12.2025.
//let T_A_CHF = 6399.78; //od 12.1.2026. 20:35h
//let T_A_CHF = 5987.62; //21.1.2026.
let T_A_CHF = 5877.84; //28.1.2026. 11:14h

let trzisteA = T_A_CHF / marginA;

//------------------------------------------------
//------  -------   --------   -------   -------
//------------------------------------------------

//let marginB = 6.15; //do 23.12.2025. 08:47h
//let marginB = 73.23; //od 23.12.2025. 08:47h
//let marginB = 6.04; //od 24.12.2025. 00:41h
//let marginB = 78.06; //od 21.1.2026. 14:55h
let marginB = 81.10; //28.1.2026.

//let T_B_AUD = 2586.64; //24.12.2025.
//let T_B_AUD = 2627.57; //31.12.2025.
//let T_B_AUD = 2734.51; //12.1.2026. 20:36h
//let T_B_AUD = 1.48 * (2 * 893.49 + 4861.87); //9840.298;
let T_B_AUD = 1.427 * (2 * 893.17 + 5278.04); //28.1.2025. 11:17h => 10,080.87
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

      const equityInput   = document.getElementById(equityInputId);
      const currencyInput = document.getElementById(currencyInputId);
      const canvas        = document.getElementById(chartId);

      if (index < 0 || index >= accounts.length) {
        if (equityInput)   equityInput.value   = "N/A (čekanje servera #" + index + ")";
        if (currencyInput) currencyInput.value = "";
        return;
      }

      const acc = accounts[index];

      const equityPercentRaw = Number(acc.equityPercent || 0);
      const equityPercent    = Number(equityPercentRaw.toFixed(2));
      const currency         = acc.currency || "";

      if (equityInput)   equityInput.value   = fmtPercent(equityPercent);
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
              tooltip: {enabled: false},
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
        if (el) el.value = jacina.toFixed(2) + " ± 2%";

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
                  tooltip: {enabled: false},
                  legend: {display: true},
                },
                scales: {
                    x: {

                        type: "time",
                        time: { unit: "minute" },
                        title: { display: true, text: "Vreme" }

                    },
                    y: {
                        title: /* { display: true, text: "CHF" }, */ {display: false},
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
      const dateEl   = document.getElementById(cfg.dateId);

      if (profitEl) profitEl.textContent = "Myfxbook privremeno blokira API — podaci će se pojaviti automatski";
      if (dateEl)   //dateEl.textContent   = "—"; 

      if (item.date) {
        const d = new Date(item.date);
        dateEl.textContent = formatSerbianDate(d);
      } else {
        dateEl.textContent = "—";
      }

    });
    return;
  }


    // data.items: [{ index, profit, date, currency }, ...]
    data.items.forEach(item => {
      const cfg = PORTFOLIO_CONFIGS.find(c => c.index === item.index);
      if (!cfg) return;

      const profitEl = document.getElementById(cfg.profitId);
      const dateEl   = document.getElementById(cfg.dateId);

    if (profitEl) {
    if (item.profit == null) {
        profitEl.textContent = "—";
        profitEl.style.color = "#6b7280"; // sivo
    } else {
        const profitNum = Number(item.profit);
        const curr      = item.currency || "";

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



// Pokretanje na load + interval na 3 s
function init() {


  updatePortfolios();              // prvo odmah
  setInterval(updatePortfolios, 10000); // pa na svakih 10s

  updateLastTrades();  // poslednji trejd za sva tri portfolija
  // po želji može i periodično, npr. na 30 s da se API ne poziva često:
  setInterval(updateLastTrades, 30000);


}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
