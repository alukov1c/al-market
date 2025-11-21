// m.js — tri portfolija (indeksi [1], [2], [4]) + real-time osvežavanje na 3 s

// Koje indekse iz /api/accounts želimo:
const PORTFOLIO_CONFIGS = [


  {
    index: 2,
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
    index: 4,
    chartId: "chartPB",
    equityInputId: "procenatKapitalaPB",
    currencyInputId: "valutaPB",
    profitId: "lastProfitPB",
    dateId: "lastDatePB"
  }
];


// ovde ćemo čuvati Chart instance da možemo da ih osvežavamo
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
        if (equityInput)   equityInput.value   = "N/A (nema naloga sa indeksom " + index + ")";
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

      // Ako grafikon ZA OVAJ portfolio još ne postoji → kreiraj ga
      if (!charts[chartId]) {
        const ctx = canvas.getContext("2d");
        charts[chartId] = new Chart(ctx, {
          type: "doughnut",
          data: {
            labels: ["Kapital %", "Ostatak do 100%"],
            datasets: [{
              data: [equityPercent, rest]
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: true,
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

  } catch (err) {
    console.error("Greška u updatePortfolios():", err);
    // Po želji: jednom prikaži alert, ali ne svaki put
  }
}


function fmtNumber2(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

// Učitavanje poslednjih trejdova za indekse 1, 2, 4
async function updateLastTrades() {
  try {
    const res = await fetch("/api/last-trades");
    if (!res.ok) throw new Error("HTTP " + res.status);

    const data = await res.json();
    if (!data.ok || !Array.isArray(data.items)) {
      throw new Error("Neočekivan format /api/last-trades odgovora.");
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
  setInterval(updatePortfolios, 3000); // pa na svakih 3s

  updateLastTrades();  // poslednji trejd za sva tri portfolija
  // po želji može i periodično, npr. na 30 s da se API ne poziva često:
  setInterval(updateLastTrades, 30000);


}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
