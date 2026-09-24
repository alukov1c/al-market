(() => {
  const $ = id => document.getElementById(id);
  const charts = {};
  let combined;
  let lastSample = null;
  const labels = { waiting: 'Čekanje terminala', error: 'Podaci nisu dostupni', stale: 'Podaci su zastareli', disconnected: 'Terminal nije povezan', offline: 'Server nije dostupan' };
  const number = value => Number.isFinite(value) ? value.toFixed(2) : '—';

  // Preuzimanje izgleda postojećih input polja iz stil.css i primena na textarea elemente.
  function styleFields() {
    const probe = document.createElement('input');
    probe.type = 'text'; probe.readOnly = true;
    $('portfolioA').append(probe);
    const css = getComputedStyle(probe);
    const properties = ['width', 'height', 'box-sizing', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'padding', 'margin', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'color', 'background-color'];
    document.querySelectorAll('#portfolio textarea').forEach(field => {
      properties.forEach(property => field.style.setProperty(property, css.getPropertyValue(property)));
      field.style.resize = 'none'; field.style.overflow = 'hidden'; field.style.verticalAlign = 'middle';
    });
    probe.remove();
  }
  function clearChart(id) {
    if (charts[id]) { charts[id].data.datasets[0].data = []; charts[id].update('none'); }
  }
  function renderPortfolio(p) {
    const suffix = p.id === 'A' ? 'PA' : 'PB';
    const chartId = p.id === 'A' ? 'chartP2' : 'chartPB';
    const available = p.state === 'live';
    const status = labels[p.state] || '—';
    $('procenatKapitala' + suffix).value = available ? number(p.level) + (p.level === null ? '' : ' %') : '—';
    $('procenatKapitala' + suffix).title = available ? 'Nivo = equity / balance × 100' : status;
    $('valuta' + suffix).value = p.currency || '—';
    $('jacinaPozicije' + p.id).value = available && p.strength !== null ? number(p.strength) + ' %' : '—';
    $('jacinaPozicije' + p.id).title = 'Jačina = equity / zbir tržišnih vrednosti otvorenih pozicija × 100, u valuti računa.';
    const profit = $('lastProfit' + suffix);
    const date = $('lastDate' + suffix);
    profit.style.color = '#6b7280'; profit.style.fontWeight = 'bold';
    if (!available) {
      profit.textContent = status;
      date.textContent = p.exportedAt ? 'Podaci: ' + new Date(p.exportedAt).toLocaleString('sr-Latn-RS') : '—';
      clearChart(chartId); return;
    }
    if (p.lastTrade) {
      const value = p.lastTrade.adjustedProfit;
      if (!Number.isFinite(value)) {
        profit.textContent = 'Ponovo dodati izvoznik v1.11 na grafikon';
        const [day, time] = p.lastTrade.closedAt.split(' ');
        date.textContent = day.split('.').reverse().join('.') + '. ' + time;
      } else {
      profit.textContent = (value > 0 ? '+' : '') + number(value) + ' ' + p.currency;
      profit.style.color = value > 0 ? '#16a34a' : value < 0 ? '#dc2626' : '#6b7280';
      const [day, time] = p.lastTrade.closedAt.split(' ');
      date.textContent = day.split('.').reverse().join('.') + '. ' + time;
      date.title = 'Vreme brokera; poslednja zatvorena trgovina iz History / All History.';
      profit.title = 'Profit ' + number(p.lastTrade.profit) + ' + swap (' + number(p.lastTrade.swap) + ')';
      }
    } else {
      profit.textContent = p.historyAvailable ? 'Nema zapisa u istoriji' : 'Istorija nije dostupna'; date.textContent = '—';
    }
    if (!window.Chart) { $(chartId).title = 'Biblioteka grafikona nije učitana'; return; }
    const data = p.level === null ? [] : [Math.max(0, p.level), Math.max(0, 100 - p.level)];
    if (!charts[chartId]) charts[chartId] = new Chart($(chartId), {
      type: 'doughnut', data: { labels: ['Nivo %', 'Ostatak do 100%'], datasets: [{ data }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: {
        legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: context => `${context.label}: ${number(context.parsed)} %` } }
      } }
    });
    else { charts[chartId].data.datasets[0].data = data; charts[chartId].update('none'); }
  }
  function renderCombined(p) {
    if (!window.Chart) return;
    if (!combined) combined = new Chart($('chartPortfolioInfo'), {
      type: 'scatter', data: { datasets: [{ label: 'Ukupno (CHF)', data: [], showLine: false, stepped: true, borderWidth: 2, tension: 0, pointRadius: 2, pointHoverRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, parsing: false,
        plugins: { tooltip: { enabled: false }, legend: { display: true } },
        scales: { x: { type: 'time', time: { unit: 'minute' }, title: { display: true, text: 'Vreme' } }, y: { title: { display: false }, ticks: { display: false } } }
      }
    });
    const series = combined.data.datasets[0];
    series.label = p.value === null ? 'Ukupno (CHF) — čekanje podataka / kursa' : 'Ukupno (CHF)';
    if (p.value !== null && p.sampledAt !== lastSample) {
      series.data.push({ x: p.sampledAt, y: p.value }); lastSample = p.sampledAt;
      combined.options.scales.y.suggestedMin = p.value - 5; combined.options.scales.y.suggestedMax = p.value + 5;
    }
    series.data = series.data.filter(point => point.x >= Date.now() - 12 * 3600000).slice(-14400);
    combined.update('none');
  }
  async function refresh() {
    try {
      const response = await fetch('/api/portfolios', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw Error('Server');
      const data = await response.json();
      data.portfolios.forEach(renderPortfolio);
      try { renderCombined(data.combined); }
      catch { $('chartPortfolioInfo').title = 'Grafikon nije dostupan; proveriti učitavanje Chart.js vremenskog adaptera.'; }
    } catch {
      ['A', 'B'].forEach(id => renderPortfolio({ id, state: 'offline' }));
      if (combined) { combined.data.datasets[0].label = 'Ukupno (CHF) — server nije dostupan'; combined.update('none'); }
    } finally { setTimeout(refresh, 3000); }
  }
  styleFields(); window.addEventListener('resize', styleFields); refresh();
})();
