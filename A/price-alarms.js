(() => {
  const instruments = {
    btc: { label: "BTC", unit: "USDT", source: "Binance", icon: "ico/bitcoin-btc-logo.png" },
    eth: { label: "ETH", unit: "USDT", source: "Binance", icon: "ico/ethereum-eth-logo.png" },
    xau: { label: "XAU", unit: "USD", source: "Gold API" }
  };
  const tones = { soft: 440, clear: 660, high: 880 };
  const storageKey = "al-market-price-alarms";
  const quotes = new Map();
  const alerts = [];
  const format = new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 6 });
  const get = id => document.getElementById(id);
  const settings = get("price-settings");
  const alert = get("price-alert");
  const form = get("price-alarm-form");
  const fields = form.elements;
  const market = get("market");
  const marketSection = get("market-section");
  const marketLink = document.querySelector('.section-nav a[href="#market-section"]');
  const layoutKey = "al-market-instrument-layout";
  const status = get("alarm-settings-status");
  const toggle = form.querySelector('[data-alarm-action="toggle"]');
  const remove = form.querySelector('[data-alarm-action="delete"]');

  const alarms = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    for (const symbol of Object.keys(instruments)) {
      const item = saved?.[symbol];
      if (item && Number.isFinite(item.target) && item.target > 0 &&
          ["above", "below"].includes(item.direction) &&
          Number.isInteger(item.duration) && item.duration >= 1 && item.duration <= 120) {
        alarms.set(symbol, item);
      }
    }
  } catch {
    status.textContent = "Sačuvana podešavanja nisu dostupna.";
  }

  let currentAlert = null;
  let audio = null;
  let oscillator = null;
  let soundTimer = null;
  let goldRequest = null;
  let preview = null;
  let previewTimer;
  let previewGeneration = 0;

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(alarms)));
      return true;
    } catch {
      status.textContent = "Promene važe dok je ova stranica otvorena.";
      return false;
    }
  }

  function priceText(value, symbol) {
    return format.format(value) + " " + instruments[symbol].unit;
  }

  function currentQuote(symbol) {
    const quote = quotes.get(symbol);
    const maxAge = symbol === "xau" ? 120000 : 30000;
    return quote && quote.updatedAt >= Date.now() - maxAge ? quote : null;
  }

  function renderQuote() {
    const symbol = fields.symbol.value;
    const quote = currentQuote(symbol);
    const source = instruments[symbol].source;
    get("alarm-quote").textContent = quote
      ? source + " · " + priceText(quote.price, symbol)
      : source + " · nema sveže kotacije";
  }

  function renderForm() {
    const item = alarms.get(fields.symbol.value);
    fields.target.value = item?.target ?? "";
    fields.direction.value = item?.direction ?? "above";
    fields.sound.checked = item?.sound ?? true;
    syncToneControls();
    fields.duration.value = item?.duration ?? 120;
    fields.tone.value = Object.hasOwn(tones, item?.tone) ? item.tone : "soft";
    toggle.disabled = !item;
    remove.disabled = !item;
    toggle.textContent = item?.enabled ? "⏸ Deaktiviraj" : "▶ Aktiviraj";
    renderQuote();
  }

  function stopSound() {
    clearTimeout(soundTimer);
    if (oscillator) {
      oscillator.stop();
      oscillator.disconnect();
      oscillator = null;
    }
    get("mute-price-alert").disabled = true;
  }

  function prepareSound() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return Promise.resolve(false);
    try {
      audio ??= new Audio();
      return audio.resume().then(() => audio.state === "running", () => false);
    } catch {
      return Promise.resolve(false);
    }
  }

  function createTone(tone) {
    const gain = audio.createGain();
    gain.gain.value = 0.075;
    const node = audio.createOscillator();
    node.frequency.value = Object.hasOwn(tones, tone) ? tones[tone] : tones.soft;
    node.connect(gain);
    gain.connect(audio.destination);
    node.addEventListener("ended", () => gain.disconnect(), { once: true });
    node.start();
    return node;
  }

  function stopPreview() {
    previewGeneration++;
    clearTimeout(previewTimer);
    if (preview) {
      preview.node.stop();
      preview.pause.disabled = true;
      preview = null;
    }
  }

  function startSound(seconds, tone) {
    stopPreview();
    if (audio?.state !== "running") return;
    oscillator = createTone(tone);
    get("mute-price-alert").disabled = false;
    soundTimer = setTimeout(stopSound, seconds * 1000);
  }

  function renderAlert() {
    if (!currentAlert) return;
    const { symbol, trigger } = currentAlert;
    const quote = currentQuote(symbol);
    get("price-alert-current").textContent = quote ? priceText(quote.price, symbol) : "Nema sveže kotacije";
    const change = get("price-alert-change");
    const difference = quote ? quote.price - trigger : 0;
    change.textContent = quote ? (difference > 0 ? "+" : "") + priceText(difference, symbol) : "—";
    change.className = difference > 0 ? "change-up" : difference < 0 ? "change-down" : "";
  }

  function showNextAlert() {
    if (currentAlert || !alerts.length) return;
    currentAlert = alerts.shift();
    const { symbol, target, trigger, sound, duration, tone } = currentAlert;
    const instrument = instruments[symbol];
    const label = get("price-alert-instrument");
    label.replaceChildren();
    if (instrument.icon) {
      const icon = document.createElement("img");
      icon.src = instrument.icon;
      icon.alt = "";
      icon.className = "coin-icon";
      label.append(icon);
    } else {
      const icon = document.createElement("span");
      icon.textContent = "●";
      icon.className = "alarm-gold";
      icon.setAttribute("aria-hidden", "true");
      label.append(icon);
    }
    label.append(" " + instrument.label);
    get("price-alert-target").textContent = priceText(target, symbol);
    get("price-alert-trigger").textContent = priceText(trigger, symbol);
    renderAlert();
    alert.showModal();
    get("mute-price-alert").disabled = true;
    if (sound) startSound(duration, tone);
  }

  function checkAlarm(symbol) {
    const item = alarms.get(symbol);
    const quote = currentQuote(symbol);
    if (!item?.enabled || !quote || quote.updatedAt < (item.armedAt ?? 0)) return;
    const reached = item.direction === "above" ? quote.price >= item.target : quote.price <= item.target;
    if (!reached) return;
    item.enabled = false;
    persist();
    alerts.push({ ...item, symbol, trigger: quote.price });
    if (settings.open && fields.symbol.value === symbol) renderForm();
    showNextAlert();
  }

  function acceptQuote(symbol, quote) {
    if (!Number.isFinite(quote?.price) || quote.price <= 0 ||
        !Number.isFinite(quote.updatedAt) || quote.updatedAt > Date.now() + 5000 ||
        quote.updatedAt <= (quotes.get(symbol)?.updatedAt ?? 0)) return;
    quotes.set(symbol, quote);
    checkAlarm(symbol);
  }

  function applyMarketLayout(layout) {
    market.dataset.marketLayout = layout;
    const gold = layout === "gold";
    marketSection.querySelectorAll("[data-market-analysis]").forEach(item => {
      item.hidden = item.dataset.marketAnalysis !== (gold ? "xau" : "sol");
    });
    const names = gold ? "BTC, XAU i ETH" : "BTC, ETH i SOL";
    marketLink.title = names + " · Live i analiza";
    marketLink.querySelector("span").textContent = marketLink.title;
    marketSection.setAttribute("aria-label", names + ", Live i analiza");
    marketSection.dispatchEvent(new Event("market-layout-change"));
    refreshGold();
  }

  function refreshGold() {
    if (goldRequest || !(market.dataset.marketLayout === "gold" || alarms.get("xau")?.enabled || currentAlert?.symbol === "xau" ||
        alerts.some(item => item.symbol === "xau") || (settings.open && fields.symbol.value === "xau"))) return;
    goldRequest = fetch("/api/market/xau", { signal: AbortSignal.timeout(12000) })
      .then(response => response.ok ? response.json() : null)
      .then(quote => acceptQuote("xau", quote))
      .catch(() => {})
      .finally(() => {
        goldRequest = null;
        const gold = currentQuote("xau");
        marketSection.dispatchEvent(new CustomEvent("gold-quote-status", { detail: Boolean(gold) }));
        marketSection.dispatchEvent(new CustomEvent("gold-quote", { detail: gold }));
        renderQuote();
        renderAlert();
      });
  }

  const categories = settings.querySelectorAll(".market-settings-nav button");
  categories.forEach(button => button.addEventListener("click", () => {
    categories.forEach(category => {
      const selected = category === button;
      if (selected) category.setAttribute("aria-current", "true");
      else category.removeAttribute("aria-current");
      get(category.getAttribute("aria-controls")).hidden = !selected;
    });
  }));
  const layouts = settings.querySelectorAll('input[name="market-layout"]');
  let layout = "gold";
  try {
    if (localStorage.getItem(layoutKey) === "crypto") layout = "crypto";
  } catch { /* Use the default when storage is unavailable. */ }
  layouts.forEach(radio => {
    radio.checked = radio.value === layout;
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      try { localStorage.setItem(layoutKey, radio.value); }
      catch { /* The choice still applies to this page. */ }
      applyMarketLayout(radio.value);
    });
  });
  applyMarketLayout(layout);

  get("open-price-settings").addEventListener("click", () => {
    settings.showModal();
    renderForm();
    refreshGold();
  });
  fields.symbol.addEventListener("change", () => {
    stopPreview();
    status.textContent = "";
    renderForm();
    refreshGold();
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    const symbol = fields.symbol.value;
    const target = fields.target.valueAsNumber;
    const duration = fields.duration.valueAsNumber;
    if (!Number.isFinite(target) || target <= 0 || !Number.isInteger(duration) || duration < 1 || duration > 120) return;
    if (fields.sound.checked) prepareSound();
    alarms.set(symbol, { target, duration, direction: fields.direction.value,
      sound: fields.sound.checked, tone: fields.tone.value, enabled: true, armedAt: Date.now() });
    if (persist()) status.textContent = "Alarm je sačuvan i aktiviran.";
    renderForm();
    refreshGold();
  });
  toggle.addEventListener("click", () => {
    const item = alarms.get(fields.symbol.value);
    if (!item) return;
    item.enabled = !item.enabled;
    if (item.enabled) {
      item.armedAt = Date.now();
      if (item.sound) prepareSound();
    }
    if (persist()) status.textContent = item.enabled ? "Alarm je aktiviran." : "Alarm je deaktiviran.";
    renderForm();
    refreshGold();
  });
  remove.addEventListener("click", () => {
    alarms.delete(fields.symbol.value);
    if (persist()) status.textContent = "Alarm je obrisan.";
    renderForm();
  });

  for (const dialog of [settings, alert]) {
    dialog.querySelector(".alarm-close").addEventListener("click", () => dialog.close());
  }
  const soundOption = fields.sound;
  const previewButtons = form.querySelectorAll("[data-preview-tone]");
  const pauseButtons = form.querySelectorAll("[data-pause-tone]");
  function syncToneControls() {
    for (const input of fields.tone) input.disabled = !soundOption.checked;
    for (const button of previewButtons) button.disabled = !soundOption.checked;
  }

  previewButtons.forEach(button => button.addEventListener("click", async () => {
    stopPreview();
    const generation = previewGeneration;
    const ready = await prepareSound();
    if (generation !== previewGeneration || !settings.open || !soundOption.checked) return;
    if (!ready) {
      status.textContent = "Pregledač trenutno ne može da pusti probni ton.";
      return;
    }
    const tone = button.dataset.previewTone;
    const pause = form.querySelector('[data-pause-tone="' + tone + '"]');
    preview = { node: createTone(tone), pause };
    pause.disabled = false;
    previewTimer = setTimeout(stopPreview, 3000);
  }));
  pauseButtons.forEach(button => button.addEventListener("click", stopPreview));
  soundOption.addEventListener("change", () => {
    if (!soundOption.checked) stopPreview();
    syncToneControls();
  });
  settings.addEventListener("close", stopPreview);
  settings.querySelector(".market-settings-nav").addEventListener("click", stopPreview);
  get("mute-price-alert").addEventListener("click", stopSound);
  alert.addEventListener("close", () => {
    stopSound();
    currentAlert = null;
    showNextAlert();
  });

  window.addEventListener("market-prices", event => {
    acceptQuote("btc", event.detail.btc);
    acceptQuote("eth", event.detail.eth);
    if (settings.open) renderQuote();
    renderAlert();
  });
  window.addEventListener("pointerdown", () => {
    if ([...alarms.values()].some(item => item.enabled && item.sound)) prepareSound();
  }, { once: true });
  setInterval(refreshGold, 30000);
  refreshGold();
})();
