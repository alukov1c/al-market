(() => {
  const instruments = {
    btc: { label: "BTC", unit: "USDT", source: "Binance", icon: "ico/bitcoin-btc-logo.png" },
    eth: { label: "ETH", unit: "USDT", source: "Binance", icon: "ico/ethereum-eth-logo.png" },
    xau: { label: "XAU", unit: "USD", source: "Gold API" }
  };
  const melodies = {
    napredak: { direction: "above", notes: [60, 64, 67, 72], beat: 0.24, wave: "sine" },
    zamah: { direction: "above", notes: [65, 69, 72, 69, 74, 77], beat: 0.18, wave: "triangle" },
    oprez: { direction: "below", notes: [65, 62, 60, 57], beat: 0.31, wave: "sine" },
    usporavanje: { direction: "below", notes: [64, 63, 59, 55, 52], beat: 0.26, wave: "triangle" }
  };
  function resolveMelody(tone, direction) {
    if (Object.hasOwn(melodies, tone) && melodies[tone].direction === direction) return tone;
    return direction === "below"
      ? "usporavanje"
      : (tone === "high" || tone === "clear" ? "zamah" : "napredak");
  }
  const melodyVolumes = () => form.querySelectorAll("[data-melody-volume]");
  const defaultVolumes = { napredak: 10, zamah: 5, oprez: 5, usporavanje: 10 };
  const volumeLevel = (value, tone) => [1, 5, 10].includes(Number(value)) ? Number(value) : defaultVolumes[tone];
  const storageKey = "al-market-price-alarms";
  const quotes = new Map();
  const format = new Intl.NumberFormat("sr-Latn-RS", { maximumFractionDigits: 6 });
  const get = id => document.getElementById(id);
  const settings = get("price-settings");
  const triggeredDetails = get("price-alert");
  const form = get("price-alarm-form");
  const fields = form.elements;
  const alarmList = get("alarm-list-dialog");
  const alarmCards = get("alarm-cards");
  const newAlarm = get("new-price-alarm");
  const alarmCardPrices = new Map();
  let returnToAlarmList = false;
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
  let soundEndsAt = 0;
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

  function paintPricePosition(dialog, quote, target, equalSide) {
    if (!quote || !Number.isFinite(target) || target <= 0) {
      delete dialog.dataset.pricePosition;
      return;
    }
    dialog.dataset.pricePosition = quote.price === target
      ? equalSide : quote.price > target ? "above" : "below";
  }

  const copyPrice = get("copy-alarm-price");
  copyPrice.addEventListener("click", () => {
    const quote = currentQuote(fields.symbol.value);
    if (!quote) return;
    fields.target.value = quote.price;
    renderQuote();
    fields.target.focus();
  });
  fields.target.addEventListener("input", renderQuote);
  for (const direction of fields.direction) direction.addEventListener("change", renderQuote);

  function renderQuote() {
    const symbol = fields.symbol.value;
    const quote = currentQuote(symbol);
    copyPrice.disabled = !quote;
    paintPricePosition(settings, quote, fields.target.valueAsNumber, fields.direction.value);
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
    fields.duration.value = item?.duration ?? 120;
    fields.tone.value = resolveMelody(item?.tone, fields.direction.value);
    for (const control of melodyVolumes()) {
      control.value = volumeLevel(item?.volumes?.[control.dataset.melodyVolume], control.dataset.melodyVolume);
    }
    syncToneControls();
    toggle.disabled = !item;
    remove.disabled = !item;
    toggle.textContent = item?.enabled ? "⏸ Deaktiviraj" : item?.paused ? "▶ Nastavi" : "▶ Aktiviraj";
    renderQuote();
  }

  function clearTriggeredAlarm(symbol) {
    if (currentAlert?.symbol !== symbol) return;
    stopSound();
    currentAlert = null;
    triggeredDetails.hidden = true;
    delete alarmList.dataset.pricePosition;
  }

  function syncAlertSoundButtons() {
    get("mute-price-alert").disabled = !oscillator;
    get("restart-price-alert").disabled = Boolean(oscillator) || !currentAlert?.sound || currentAlert?.pausedAt != null;
  }

  function stopSound() {
    clearTimeout(soundTimer);
    soundEndsAt = 0;
    if (oscillator) {
      oscillator.stop();
      oscillator.disconnect();
      oscillator = null;
    }
    syncAlertSoundButtons();
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

  function playMelody(tone, seconds, volume) {
    const { notes, beat, wave } = melodies[tone];
    const gain = audio.createGain();
    const output = audio.createGain();
    output.gain.value = volumeLevel(volume, tone);
    const node = audio.createOscillator();
    const start = audio.currentTime;
    const end = start + seconds;
    const cycle = beat * notes.length + 0.45;
    node.type = wave;
    gain.gain.value = 0;

    for (let offset = 0; offset < seconds; offset += cycle) {
      notes.forEach((note, index) => {
        const at = start + offset + index * beat;
        if (at >= end) return;
        const release = Math.min(at + beat * 0.9, end);
        node.frequency.setValueAtTime(440 * 2 ** ((note - 69) / 12), at);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.09, Math.min(at + 0.025, (at + release) / 2));
        gain.gain.linearRampToValueAtTime(0, release);
      });
    }

    node.connect(gain);
    gain.connect(output);
    output.connect(audio.destination);
    node.addEventListener("ended", () => {
      gain.disconnect();
      output.disconnect();
    }, { once: true });
    node.start(start);
    node.stop(end);
    return { node, output };
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

  function startSound(seconds, tone, volume) {
    stopPreview();
    if (audio?.state !== "running") return;
    oscillator = playMelody(tone, seconds, volume).node;
    syncAlertSoundButtons();
    soundEndsAt = Date.now() + seconds * 1000;
    soundTimer = setTimeout(stopSound, seconds * 1000);
  }

  function updateAlertElapsed() {
    if (!currentAlert || !alarmList.open) return;
    const elapsed = Math.max(0, Math.floor(((currentAlert.pausedAt ?? Date.now()) - currentAlert.triggeredAt) / 1000));
    const duration = [Math.floor(elapsed / 86400), Math.floor(elapsed / 3600) % 24,
      Math.floor(elapsed / 60) % 60, elapsed % 60];
    const date = new Date(currentAlert.activatedAt);
    const activated = [date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
    const clockText = parts => parts.map(part => String(part).padStart(2, "0")).join(":");
    get("price-alert-elapsed").textContent = "Od aktiviranja: " + clockText(duration) +
      " · Vreme aktiviranja: " + clockText(activated);
  }

  function renderAlert() {
    if (!currentAlert) return;
    const { symbol, trigger, target } = currentAlert;
    const quote = currentQuote(symbol);
    paintPricePosition(alarmList, quote, target, currentAlert.crossingSide);
    get("price-alert-current").textContent = quote ? priceText(quote.price, symbol) : "Nema sveže kotacije";
    const change = get("price-alert-change");
    const difference = quote ? quote.price - trigger : 0;
    change.textContent = quote ? (difference > 0 ? "+" : "") + priceText(difference, symbol) : "—";
    change.className = difference > 0 ? "change-up" : difference < 0 ? "change-down" : "";
  }

  function appendInstrument(label, symbol) {
    const instrument = instruments[symbol];
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
  }

  function showTriggeredAlarm(symbol, item, trigger, crossingSide) {
    stopPreview();
    stopSound();
    const activatedAt = Date.now();
    currentAlert = { ...item, symbol, trigger, crossingSide, activatedAt, triggeredAt: activatedAt };
    get("alert-sound-duration").value = item.duration;
    get("alert-sound-enabled").checked = item.sound;
    const { target, sound, duration, tone } = currentAlert;
    appendInstrument(get("price-alert-instrument"), symbol);
    get("price-alert-target").textContent = priceText(target, symbol);
    get("price-alert-trigger").textContent = priceText(trigger, symbol);
    renderAlert();
    triggeredDetails.hidden = false;
    openAlarmList();
    renderAlarmCards();
    syncAlertSoundButtons();
    const melody = resolveMelody(tone, crossingSide);
    if (sound) startSound(duration, melody, item.volumes?.[melody]);
  }

  function checkAlarm(symbol) {
    const item = alarms.get(symbol);
    const quote = currentQuote(symbol);
    if (!item?.enabled || !quote || quote.updatedAt < (item.armedAt ?? 0)) return;
    const previousSide = item.priceSide ?? (item.thresholdReached ? item.direction : null);
    const atTarget = quote.price === item.target;
    if (atTarget && item.atTarget) return;

    const side = atTarget
      ? (previousSide === "above" ? "below" : previousSide === "below" ? "above" : item.direction)
      : (quote.price > item.target ? "above" : "below");
    const trigger = previousSide !== null && side !== previousSide;
    if (side === item.priceSide && atTarget === item.atTarget) return;

    item.priceSide = side;
    item.atTarget = atTarget;
    delete item.thresholdReached;
    if (trigger) {
      item.hitCount = (item.hitCount ?? 0) + 1;
      const counter = side === "above" ? "riseCount" : "fallCount";
      item[counter] = (item[counter] ?? 0) + 1;
    }
    persist();
    if (trigger) showTriggeredAlarm(symbol, item, quote.price, side);
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
    if (goldRequest) return goldRequest;
    if (!((alarmList.open && alarms.has("xau")) || market.dataset.marketLayout === "gold" || alarms.get("xau")?.enabled || currentAlert?.symbol === "xau" ||
        (settings.open && fields.symbol.value === "xau"))) return;
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
        if (alarmList.open) updateAlarmCardPrices();
      });
    return goldRequest;
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

  const statusStrip = document.querySelector(".section-status-strip");
  const statusStripKey = "al-market-status-strip";
  let statusStripMode = "on";
  try {
    if (localStorage.getItem(statusStripKey) === "off") statusStripMode = "off";
  } catch { /* Keep the default if storage is unavailable. */ }
  statusStrip.hidden = statusStripMode === "off";
  for (const radio of settings.querySelectorAll('input[name="status-strip"]')) {
    radio.checked = radio.value === statusStripMode;
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      statusStrip.hidden = radio.value === "off";
      try { localStorage.setItem(statusStripKey, radio.value); }
      catch { /* The choice still applies to this page. */ }
    });
  }

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
    const previous = alarms.get(symbol);
    const direction = fields.direction.value;
    const sameThreshold = (previous?.enabled || previous?.paused) && previous.target === target && previous.direction === direction;
    if (!sameThreshold) clearTriggeredAlarm(symbol);
    const quote = currentQuote(symbol);
    const initialSide = quote ? (quote.price === target ? direction : quote.price > target ? "above" : "below") : null;
    alarms.set(symbol, { target, duration, direction,
      priceSide: sameThreshold ? (previous.priceSide ?? (previous.thresholdReached ? previous.direction : null)) : initialSide,
      atTarget: sameThreshold ? previous.atTarget : quote?.price === target,
      hitCount: sameThreshold ? (previous.hitCount ?? 0) : 0,
      riseCount: sameThreshold ? (previous.riseCount ?? 0) : 0,
      fallCount: sameThreshold ? (previous.fallCount ?? 0) : 0,
      sound: fields.sound.checked, tone: fields.tone.value,
      paused: sameThreshold && previous.paused,
      volumes: Object.fromEntries(Array.from(melodyVolumes(), control =>
        [control.dataset.melodyVolume, volumeLevel(control.value, control.dataset.melodyVolume)])), enabled: !(sameThreshold && previous.paused), armedAt: Date.now() });
    if (currentAlert?.symbol === symbol) {
      const item = alarms.get(symbol);
      applyAlertSoundSettings(item);
      get("alert-sound-duration").value = item.duration;
      get("alert-sound-enabled").checked = item.sound;
    }
    const saved = persist();
    if (saved) status.textContent = alarms.get(symbol).paused ? "Pauzirani alarm je sačuvan." : "Alarm je sačuvan i aktiviran.";
    if (returnToAlarmList) {
      get("alarm-list-status").textContent = saved ? status.textContent : "Promena važi dok je stranica otvorena.";
      settings.close();
    }
    renderForm();
    refreshGold();
  });
  toggle.addEventListener("click", () => {
    const item = alarms.get(fields.symbol.value);
    if (!item) return;
    if (item.paused) {
      toggleAlarmPause(fields.symbol.value);
      return;
    }
    item.enabled = !item.enabled;
    if (item.enabled) {
      item.armedAt = Date.now();
      delete item.thresholdReached;
      item.priceSide = null;
      item.atTarget = false;
      item.hitCount = 0;
      item.riseCount = 0;
      item.fallCount = 0;
      if (item.sound) prepareSound();
    }
    if (!item.enabled) clearTriggeredAlarm(fields.symbol.value);
    if (persist()) status.textContent = item.enabled ? "Alarm je aktiviran." : "Alarm je deaktiviran.";
    renderForm();
    refreshGold();
  });
  remove.addEventListener("click", () => {
    clearTriggeredAlarm(fields.symbol.value);
    alarms.delete(fields.symbol.value);
    if (persist()) status.textContent = "Alarm je obrisan.";
    renderForm();
  });



  function updateAlarmCardPrices() {
    if (!currentAlert) {
      const item = alarms.get(fields.symbol.value);
      paintPricePosition(alarmList, currentQuote(fields.symbol.value), item?.target, item?.direction);
    }
    for (const [symbol, { current, difference }] of alarmCardPrices) {
      const quote = currentQuote(symbol);
      current.textContent = quote ? priceText(quote.price, symbol) : "Nema sveže kotacije";
      const delta = quote ? quote.price - alarms.get(symbol).target : 0;
      difference.textContent = quote ? (delta > 0 ? "+" : "") + priceText(delta, symbol) : "—";
      difference.className = delta > 0 ? "change-up" : delta < 0 ? "change-down" : "";
    }
  }

  function toggleAlarmPause(symbol) {
    const item = alarms.get(symbol);
    const resuming = item.paused === true;
    item.paused = !resuming;
    item.enabled = resuming;
    if (resuming) {
      item.armedAt = Date.now();
      if (item.sound) prepareSound();
    }

    if (currentAlert?.symbol === symbol) {
      if (resuming && currentAlert.pausedAt != null) {
        currentAlert.triggeredAt += Date.now() - currentAlert.pausedAt;
        delete currentAlert.pausedAt;
        const remaining = currentAlert.remainingSound;
        delete currentAlert.remainingSound;
        if (remaining > 0) {
          const melody = resolveMelody(currentAlert.tone, currentAlert.crossingSide);
          startSound(remaining / 1000, melody, currentAlert.volumes?.[melody]);
        }
      } else if (!resuming) {
        currentAlert.pausedAt = Date.now();
        currentAlert.remainingSound = Math.max(0, soundEndsAt - currentAlert.pausedAt);
        stopSound();
      }
      syncAlertSoundButtons();
      updateAlertElapsed();
    }

    const saved = persist();
    const message = resuming ? "Alarm je nastavljen." : "Alarm je pauziran.";
    get("alarm-list-status").textContent = saved ? message : status.textContent;
    if (saved) status.textContent = message;
    renderForm();
    renderAlarmCards();
    refreshGold();
  }

  function renderAlarmCards() {
    if (!alarmList.open) return;
    alarmCards.replaceChildren();
    alarmCardPrices.clear();
    newAlarm.disabled = alarms.size === Object.keys(instruments).length;
    newAlarm.title = newAlarm.disabled ? "Već postoji po jedan alarm za svaki instrument." : "";
    if (!alarms.size) alarmCards.textContent = "Nema sačuvanih alarma.";
    for (const [symbol, item] of alarms) {
      const instrument = instruments[symbol];
      const card = document.createElement("article");
      card.className = "alarm-card";
      const title = document.createElement("strong");
      title.className = "alarm-card-title";
      appendInstrument(title, symbol);
      title.append((item.enabled ? " · aktivan" : item.paused ? " · pauziran" : " · neaktivan") + " · Dostizanja: " + (item.hitCount ?? 0));

      const prices = document.createElement("dl");
      prices.className = "alarm-card-prices";
      for (const label of ["Ciljna cena", "Trenutna cena", "Razlika od praga", "Prelazi naviše", "Prelazi naniže"]) {
        const name = document.createElement("dt");
        name.textContent = label;
        prices.append(name, document.createElement("dd"));
      }
      const [target, current, difference, rise, fall] = prices.querySelectorAll("dd");
      rise.textContent = item.riseCount ?? 0;
      fall.textContent = item.fallCount ?? 0;
      target.textContent = (item.direction === "above" ? "≥ " : "≤ ") + priceText(item.target, symbol);
      alarmCardPrices.set(symbol, { current, difference });

      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "✎";
      edit.setAttribute("aria-label", "Izmeni alarm za " + instrument.label);
      edit.addEventListener("click", () => editFromAlarmList(symbol));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "🗑";
      remove.setAttribute("aria-label", "Obriši alarm za " + instrument.label);
      remove.addEventListener("click", () => {
        clearTriggeredAlarm(symbol);
        alarms.delete(symbol);
        const saved = persist();
        get("alarm-list-status").textContent = saved ? "Alarm je obrisan." : "Promena važi dok je stranica otvorena.";
        renderAlarmCards();
        renderForm();
        (alarmCards.querySelector("button") ?? newAlarm).focus();
      });
      const pause = document.createElement("button");
      pause.type = "button";
      pause.disabled = !item.enabled && !item.paused;
      pause.textContent = item.enabled ? "⏸" : "▶";
      pause.title = (item.enabled ? "Pauziraj alarm za " : "Nastavi alarm za ") + instrument.label;
      pause.setAttribute("aria-label", pause.title);
      pause.dataset.pauseAlarm = symbol;
      pause.addEventListener("click", () => {
        toggleAlarmPause(symbol);
        alarmCards.querySelector('[data-pause-alarm="' + symbol + '"]')?.focus();
      });
      card.append(title, edit, remove, pause, prices);
      if (alarmCards.childElementCount) alarmCards.append(document.createElement("hr"));
      alarmCards.append(card);
    }
    updateAlarmCardPrices();
  }

  function editFromAlarmList(symbol, creating = false) {
    if (!symbol) return;
    returnToAlarmList = true;
    alarmList.close();
    fields.symbol.value = symbol;
    fields.symbol.disabled = !creating;
    for (const option of fields.symbol.options) option.disabled = creating && alarms.has(option.value);
    document.querySelector('[aria-controls="alarm-settings-panel"]').click();
    status.textContent = "";
    settings.showModal();
    renderForm();
    refreshGold();
  }

  const mobileAlarm = get("mobile-alarm-list");
  const mobileAlarmLayout = window.matchMedia("(max-width: 700px)");
  const refreshAlarms = get("refresh-price-alarms");
  const alarmListStatus = get("alarm-list-status");

  function positionAlarmRefresh() {
    if (mobileAlarmLayout.matches) alarmList.querySelector(".alarm-list-footer").append(refreshAlarms);
    else alarmListStatus.before(refreshAlarms);
  }

  mobileAlarmLayout.addEventListener("change", positionAlarmRefresh);
  positionAlarmRefresh();

  refreshAlarms.addEventListener("click", async () => {
    refreshAlarms.disabled = true;
    alarmListStatus.textContent = "Osvežavanje kotacija…";
    const results = await Promise.allSettled([
      fetch("/api/market", { cache: "no-store", signal: AbortSignal.timeout(12000) }).then(async response => {
        if (!response.ok) throw Error("Kotacije nisu dostupne");
        const market = await response.json();
        acceptQuote("btc", market.btc);
        acceptQuote("eth", market.eth);
      }),
      refreshGold()
    ]);
    renderAlert();
    updateAlarmCardPrices();
    const unavailable = results[0].status === "rejected" ||
      [...alarms.keys()].some(symbol => !currentQuote(symbol));
    alarmListStatus.textContent = unavailable ? "Neke sveže kotacije nisu dostupne." : "Kotacije su proverene.";
    refreshAlarms.disabled = false;
  });

  function openAlarmList() {
    if (!alarmList.open) {
      if (mobileAlarmLayout.matches) alarmList.show();
      else alarmList.showModal();
    }
    mobileAlarm.setAttribute("aria-expanded", "true");
    updateAlertElapsed();
  }

  alarmList.addEventListener("close", () => {
    if (!alarmList.open) mobileAlarm.setAttribute("aria-expanded", "false");
  });

  function toggleAlarmList() {
    if (alarmList.open) {
      alarmList.close();
      return;
    }
    get("alarm-list-status").textContent = "";
    openAlarmList();
    renderAlarmCards();
    refreshGold();
  }

  mobileAlarm.addEventListener("click", toggleAlarmList);
  get("open-alarm-list").addEventListener("click", toggleAlarmList);
  get("refresh-market-page").addEventListener("click", () => window.location.reload());
  newAlarm.addEventListener("click", () => {
    editFromAlarmList(Object.keys(instruments).find(symbol => !alarms.has(symbol)), true);
  });
  settings.addEventListener("close", () => {
    if (!returnToAlarmList) return;
    returnToAlarmList = false;
    fields.symbol.disabled = false;
    for (const option of fields.symbol.options) option.disabled = false;
    openAlarmList();
    renderAlarmCards();
    refreshGold();
  });

  for (const dialog of [settings, alarmList]) {
    dialog.querySelector(".alarm-close").addEventListener("click", () => dialog.close());
  }
  const soundOption = fields.sound;
  const previewButtons = form.querySelectorAll("[data-preview-tone]");
  const pauseButtons = form.querySelectorAll("[data-pause-tone]");
  function syncToneControls() {
    for (const row of form.querySelectorAll("[data-melody-direction]")) {
      row.hidden = row.dataset.melodyDirection !== fields.direction.value;
      row.querySelector("input").disabled = row.hidden || !soundOption.checked;
      row.querySelector("[data-preview-tone]").disabled = row.hidden || !soundOption.checked;
      row.querySelector("[data-melody-volume]").disabled = row.hidden || !soundOption.checked;
    }
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
    const volume = button.closest(".alarm-tone-row").querySelector("[data-melody-volume]");
    preview = { ...playMelody(tone, 3, volume.value), pause, tone };
    pause.disabled = false;
    previewTimer = setTimeout(stopPreview, 3000);
  }));
  melodyVolumes().forEach(control => control.addEventListener("change", () => {
    if (preview?.tone === control.dataset.melodyVolume) {
      preview.output.gain.setTargetAtTime(volumeLevel(control.value, control.dataset.melodyVolume), audio.currentTime, 0.02);
    }
  }));
  pauseButtons.forEach(button => button.addEventListener("click", stopPreview));
  for (const input of fields.direction) input.addEventListener("change", () => {
    stopPreview();
    fields.tone.value = resolveMelody(fields.tone.value, fields.direction.value);
    syncToneControls();
  });
  soundOption.addEventListener("change", () => {
    if (!soundOption.checked) stopPreview();
    syncToneControls();
  });
  settings.addEventListener("close", stopPreview);
  settings.querySelector(".market-settings-nav").addEventListener("click", stopPreview);
  const alertDuration = get("alert-sound-duration");
  const alertSound = get("alert-sound-enabled");

  function applyAlertSoundSettings(item) {
    const previousDuration = currentAlert.duration;
    const remaining = currentAlert.pausedAt != null ? currentAlert.remainingSound : Math.max(0, soundEndsAt - Date.now());
    Object.assign(currentAlert, { duration: item.duration, sound: item.sound, tone: item.tone, volumes: item.volumes });
    if (!item.sound) {
      currentAlert.remainingSound = 0;
      stopSound();
    } else if (remaining > 0 && previousDuration !== item.duration) {
      const adjusted = Math.max(0, remaining + (item.duration - previousDuration) * 1000);
      if (currentAlert.pausedAt != null) {
        currentAlert.remainingSound = adjusted;
      } else {
        stopSound();
        const melody = resolveMelody(item.tone, currentAlert.crossingSide);
        if (adjusted > 0) startSound(adjusted / 1000, melody, item.volumes?.[melody]);
      }
    }
    syncAlertSoundButtons();
  }

  function saveAlertSoundSettings() {
    const item = alarms.get(currentAlert?.symbol);
    if (!item) return;
    if (!alertDuration.checkValidity()) alertDuration.value = item.duration;
    item.duration = alertDuration.valueAsNumber;
    item.sound = alertSound.checked;
    applyAlertSoundSettings(item);
    persist();
    if (fields.symbol.value === currentAlert.symbol) {
      fields.duration.value = item.duration;
      fields.sound.checked = item.sound;
      syncToneControls();
    }
  }

  alertDuration.addEventListener("change", saveAlertSoundSettings);
  alertSound.addEventListener("change", saveAlertSoundSettings);
  get("mute-price-alert").addEventListener("click", stopSound);
  get("restart-price-alert").addEventListener("click", async () => {
    const event = currentAlert;
    if (!event?.sound || event.pausedAt != null || oscillator) return;
    const ready = await prepareSound();
    if (!ready || event !== currentAlert || !event.sound || event.pausedAt != null || oscillator) return;
    const melody = resolveMelody(event.tone, event.crossingSide);
    startSound(event.duration, melody, event.volumes?.[melody]);
  });

  window.addEventListener("market-prices", event => {
    acceptQuote("btc", event.detail.btc);
    acceptQuote("eth", event.detail.eth);
    if (settings.open) renderQuote();
    renderAlert();
    if (alarmList.open) updateAlarmCardPrices();
  });
  window.addEventListener("pointerdown", () => {
    if ([...alarms.values()].some(item => item.enabled && item.sound)) prepareSound();
  }, { once: true });
  setInterval(updateAlertElapsed, 1000);
  setInterval(refreshGold, 30000);
  refreshGold();
})();
