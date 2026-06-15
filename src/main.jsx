import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import "./styles.css";

const rupee = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
});
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function toRupees(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : null;
}

function pointMs(point) {
  const ts = Number(point?.ts ?? point?.timestamp);
  return Number.isFinite(ts) ? Math.floor(ts / 1_000_000) : null;
}

function pointNumber(point, rupeeValue = false) {
  const raw = point?.v ?? point?.value;
  const value = rupeeValue ? toRupees(raw) : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function deviceIdForPhone(phone) {
  return `Nubra-OSS-${digits(phone)}`;
}

function tvTime(ms) {
  return Math.floor(ms / 1000);
}

function formatIstTime(time) {
  const seconds = typeof time === "number" ? time : Date.UTC(time.year, time.month - 1, time.day) / 1000;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(seconds * 1000));
}

function extractSymbolData(data, symbol) {
  const result = data?.result?.[0]?.values || [];
  for (const entry of result) {
    if (entry[symbol]) return entry[symbol];
    const firstKey = Object.keys(entry)[0];
    if (firstKey) return entry[firstKey];
  }
  return null;
}

function makeChart(host, options = {}) {
  if (!window.LightweightCharts || !host) return null;
  return window.LightweightCharts.createChart(host, {
    layout: {
      background: { type: "solid", color: "#080b10" },
      textColor: "#9ca3af",
      fontFamily: "Inter, system-ui, sans-serif"
    },
    grid: {
      vertLines: { color: "rgba(255,255,255,0.045)" },
      horzLines: { color: "rgba(255,255,255,0.045)" }
    },
    rightPriceScale: {
      borderColor: "rgba(255,255,255,0.09)",
      scaleMargins: { top: 0.1, bottom: 0.12 }
    },
    timeScale: {
      borderColor: "rgba(255,255,255,0.09)",
      timeVisible: true,
      secondsVisible: true,
      rightOffset: 8,
      barSpacing: 7,
      tickMarkFormatter: formatIstTime
    },
    crosshair: {
      mode: window.LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: "#ff8a3d", style: 2, width: 1 },
      horzLine: { color: "#ff8a3d", style: 2, width: 1 }
    },
    localization: {
      locale: "en-IN",
      timeFormatter: formatIstTime
    },
    ...options
  });
}

function App() {
  const now = new Date();
  const [environment, setEnvironment] = createSignal("https://api.nubra.io");
  const [token, setToken] = createSignal(localStorage.getItem("nubraSessionToken") || "");
  const [deviceId, setDeviceId] = createSignal(localStorage.getItem("nubraDeviceId") || "");
  const [phone, setPhone] = createSignal(localStorage.getItem("nubraPhone") || "");
  const [authMethod, setAuthMethod] = createSignal(localStorage.getItem("nubraAuthMethod") || "otp");
  const [otp, setOtp] = createSignal("");
  const [mpin, setMpin] = createSignal("");
  const [flowId, setFlowId] = createSignal(sessionStorage.getItem("nubraFlowId") || "");
  const [loginStatus, setLoginStatus] = createSignal(token() ? "Session token loaded" : "Not logged in");
  const [section, setSection] = createSignal("rolling");
  const [busy, setBusy] = createSignal(false);
  const [toast, setToast] = createSignal("");
  const [drawerOpen, setDrawerOpen] = createSignal(false);

  const [symbol, setSymbol] = createSignal("NIFTY");
  const [instrumentType, setInstrumentType] = createSignal("INDEX");
  const [exchange, setExchange] = createSignal("NSE");
  const [interval, setIntervalValue] = createSignal("1m");
  const [startDate, setStartDate] = createSignal(toLocalInput(new Date(now.getTime() - 6 * 60 * 60 * 1000)));
  const [endDate, setEndDate] = createSignal(toLocalInput(now));
  const [spot, setSpot] = createSignal("--");
  const [change, setChange] = createSignal("--");
  const [chartStatus, setChartStatus] = createSignal("Idle");
  const [candleCount, setCandleCount] = createSignal(0);

  const [rollSymbol, setRollSymbol] = createSignal("NIFTY");
  const [rollType, setRollType] = createSignal("INDEX");
  const [rollExchange, setRollExchange] = createSignal("NSE");
  const [rollExpiry, setRollExpiry] = createSignal("");
  const [rollExpiries, setRollExpiries] = createSignal([]);
  const [rollStart, setRollStart] = createSignal(toLocalInput(new Date(now.getTime() - 30 * 60 * 1000)));
  const [rollEnd, setRollEnd] = createSignal(toLocalInput(now));
  const [rollStatus, setRollStatus] = createSignal("Idle");
  const [rollStats, setRollStats] = createSignal({
    spot: "--",
    strike: "--",
    bid: "--",
    ask: "--",
    points: "0",
    meta: "Lowest ATM +/-2 straddle, bid and ask, sampled at 1 second."
  });

  let priceChartHost;
  let rollChartHost;
  let priceChart;
  let candleSeries;
  let rollChart;
  let rollBidSeries;
  let rollAskSeries;

  const authed = createMemo(() => Boolean(token().trim() && deviceId().trim()));

  function resizeChart(chart, host) {
    if (!chart || !host) return;
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    chart.resize(width, height);
  }

  function resizeVisibleCharts() {
    resizeChart(priceChart, priceChartHost);
    resizeChart(rollChart, rollChartHost);
  }

  function queueChartResize() {
    requestAnimationFrame(() => {
      resizeVisibleCharts();
      requestAnimationFrame(resizeVisibleCharts);
    });
  }

  function saveAuthInputs() {
    localStorage.setItem("nubraDeviceId", deviceId().trim());
    localStorage.setItem("nubraPhone", phone().trim());
    localStorage.setItem("nubraAuthMethod", authMethod());
  }

  function authHeaders() {
    if (!authed()) throw new Error("Session token and device ID are required.");
    const rawToken = token().trim();
    return {
      Authorization: rawToken.startsWith("Bearer ") ? rawToken : `Bearer ${rawToken}`,
      "x-device-id": deviceId().trim(),
      "content-type": "application/json"
    };
  }

  async function nubraFetch(path, options = {}) {
    const target = new URL(path, `${environment()}/`);
    const response = await fetch(`/api/proxy?url=${encodeURIComponent(target.toString())}`, {
      method: options.method || "GET",
      headers: { ...authHeaders(), ...(options.headers || {}) },
      body: options.body
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      const detail = payload?.error || payload?.message || response.statusText;
      throw new Error(`${response.status}: ${detail}`);
    }
    return payload;
  }

  async function run(action) {
    setBusy(true);
    setToast("");
    try {
      await action();
    } catch (error) {
      setToast(error.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function startLogin() {
    const cleanPhone = digits(phone());
    if (cleanPhone.length < 10) throw new Error("Enter a valid Nubra phone number.");
    setPhone(cleanPhone);
    setDeviceId(deviceIdForPhone(cleanPhone));
    saveAuthInputs();
    setLoginStatus(authMethod() === "totp" ? "TOTP mode ready" : "Starting OTP login");
    const response = await fetch("/api/auth/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phone: cleanPhone,
        auth_method: authMethod(),
        environment: environment().includes("uat") ? "UAT" : "PROD"
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.message || "Unable to start Nubra login.");
    setFlowId(data.flow_id || "");
    sessionStorage.setItem("nubraFlowId", data.flow_id || "");
    if (data.device_id) {
      setDeviceId(data.device_id);
      localStorage.setItem("nubraDeviceId", data.device_id);
    }
    setLoginStatus(data.message || "Code sent. Verify and enter MPIN.");
  }

  async function verifyCode() {
    if (!flowId()) throw new Error("Start login first.");
    if (!otp().trim()) throw new Error("OTP or TOTP is required.");
    const endpoint = authMethod() === "totp" ? "/api/auth/verify-totp" : "/api/auth/verify-otp";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(authMethod() === "totp"
        ? { flow_id: flowId(), totp: otp().trim() }
        : { flow_id: flowId(), otp: otp().trim() })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.message || "Verification failed.");
    setLoginStatus(data.message || "Code verified. Enter MPIN.");
  }

  async function verifyMpin() {
    if (!flowId()) throw new Error("Start login first.");
    if (!mpin().trim()) throw new Error("MPIN is required.");
    const response = await fetch("/api/auth/verify-mpin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow_id: flowId(), mpin: mpin().trim() })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.message || "MPIN incorrect.");
    if (!data.access_token) throw new Error("Nubra did not return session_token.");
    setToken(data.access_token);
    localStorage.setItem("nubraSessionToken", data.access_token);
    if (data.device_id) {
      setDeviceId(data.device_id);
      localStorage.setItem("nubraDeviceId", data.device_id);
    }
    setOtp("");
    setMpin("");
    setFlowId("");
    sessionStorage.removeItem("nubraFlowId");
    setLoginStatus(data.message || "Logged in");
  }

  function initPriceChart() {
    if (priceChart || !priceChartHost) return;
    priceChart = makeChart(priceChartHost, { timeScale: { timeVisible: true, secondsVisible: false } });
    const options = {
      upColor: "#21d19f",
      downColor: "#ff5d67",
      borderUpColor: "#21d19f",
      borderDownColor: "#ff5d67",
      wickUpColor: "#21d19f",
      wickDownColor: "#ff5d67"
    };
    candleSeries = priceChart.addCandlestickSeries
      ? priceChart.addCandlestickSeries(options)
      : priceChart.addSeries(window.LightweightCharts.CandlestickSeries, options);
    queueChartResize();
  }

  async function loadSpotPrice() {
    setChartStatus("Spot");
    const suffix = exchange() === "BSE" ? "?exchange=BSE" : "";
    const data = await nubraFetch(`optionchains/${encodeURIComponent(symbol().trim().toUpperCase())}/price${suffix}`);
    const price = toRupees(data.price);
    setSpot(price == null ? "--" : rupee.format(price));
    setChange(Number.isFinite(data.change) ? `${number.format(data.change)}%` : "--");
    setChartStatus("Ready");
  }

  async function loadPriceChart() {
    initPriceChart();
    setChartStatus("Loading");
    const sym = symbol().trim().toUpperCase();
    const data = await nubraFetch("charts/timeseries", {
      method: "POST",
      body: JSON.stringify({
        query: [{
          exchange: exchange(),
          type: instrumentType(),
          values: [sym],
          fields: ["open", "high", "low", "close"],
          startDate: fromLocalInput(startDate()),
          endDate: fromLocalInput(endDate()),
          interval: interval(),
          intraDay: false,
          realTime: false
        }]
      })
    });
    const symbolData = extractSymbolData(data, sym);
    const byTs = new Map();
    for (const field of ["open", "high", "low", "close"]) {
      for (const point of (Array.isArray(symbolData?.[field]) ? symbolData[field] : [])) {
        const ts = pointMs(point);
        const value = pointNumber(point, true);
        if (!Number.isFinite(ts) || !Number.isFinite(value)) continue;
        const row = byTs.get(ts) || { time: tvTime(ts), open: null, high: null, low: null, close: null };
        row[field] = value;
        byTs.set(ts, row);
      }
    }
    const candles = [...byTs.values()]
      .filter((row) => [row.open, row.high, row.low, row.close].every(Number.isFinite))
      .sort((a, b) => a.time - b.time);
    candleSeries.setData(candles);
    resizeChart(priceChart, priceChartHost);
    priceChart.timeScale().fitContent();
    setCandleCount(candles.length);
    setChartStatus(candles.length ? "Ready" : "No data");
  }

  function normalizeStrike(value) {
    const rupeeValue = toRupees(value);
    return rupeeValue == null ? Number(value) : rupeeValue;
  }

  function optionRowSide(row) {
    return String(row.option_type || row.ot || row.side || "").toUpperCase();
  }

  async function rollingOptionRows() {
    const date = rollStart().slice(0, 10) || new Date().toISOString().slice(0, 10);
    const data = await nubraFetch(`refdata/refdata/${date}?exchange=${rollExchange()}`);
    const refRows = Array.isArray(data.refdata) ? data.refdata : [];
    const sym = rollSymbol().trim().toUpperCase();
    return refRows
      .filter((row) => {
        const asset = String(row.asset || "").toUpperCase();
        const dtype = String(row.derivative_type || "").toUpperCase();
        const side = optionRowSide(row);
        return asset === sym && dtype === "OPT" && (side === "CE" || side === "PE") && row.stock_name;
      })
      .map((row) => ({
        name: row.stock_name,
        expiry: String(row.expiry || ""),
        side: optionRowSide(row),
        strike: normalizeStrike(row.strike_price)
      }))
      .filter((row) => Number.isFinite(row.strike) && row.expiry);
  }

  async function loadRollingExpiries() {
    setRollStatus("Refdata");
    const rows = await rollingOptionRows();
    const expiries = [...new Set(rows.map((row) => row.expiry))].sort();
    if (!expiries.length) throw new Error("No option expiries found.");
    setRollExpiries(expiries);
    setRollExpiry((current) => current || expiries[0]);
    setRollStatus(`${expiries.length} expiries`);
  }

  function inferStrikeStep(strikes) {
    const unique = [...new Set(strikes)].sort((a, b) => a - b);
    let step = Infinity;
    for (let i = 1; i < unique.length; i++) {
      const diff = unique[i] - unique[i - 1];
      if (diff > 0) step = Math.min(step, diff);
    }
    return Number.isFinite(step) ? step : 50;
  }

  function nearestStrike(price, strikes, step) {
    const target = Math.round(price / step) * step;
    return strikes.reduce((best, strike) =>
      Math.abs(strike - target) < Math.abs(best - target) ? strike : best, strikes[0]);
  }

  async function fetchRollingSeries(names, start, end) {
    const seriesByName = new Map();
    const batchSize = 8;
    const total = Math.ceil(names.length / batchSize);
    for (let b = 0; b < total; b++) {
      const batch = names.slice(b * batchSize, (b + 1) * batchSize);
      setRollStatus(`Batch ${b + 1}/${total}`);
      const data = await nubraFetch("charts/timeseries", {
        method: "POST",
        body: JSON.stringify({
          query: [{
            exchange: rollExchange(),
            type: "OPT",
            values: batch,
            fields: ["l1bid", "l1ask"],
            startDate: start,
            endDate: end,
            interval: "1s",
            intraDay: false,
            realTime: false
          }]
        })
      });
      for (const entry of data?.result?.[0]?.values || []) {
        for (const [name, symData] of Object.entries(entry)) {
          seriesByName.set(name, {
            bid: (Array.isArray(symData?.l1bid) ? symData.l1bid : [])
              .map((p) => ({ ts: pointMs(p), v: pointNumber(p, true) }))
              .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.v))
              .sort((a, b) => a.ts - b.ts),
            ask: (Array.isArray(symData?.l1ask) ? symData.l1ask : [])
              .map((p) => ({ ts: pointMs(p), v: pointNumber(p, true) }))
              .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.v))
              .sort((a, b) => a.ts - b.ts)
          });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return seriesByName;
  }

  function advanceQuote(name, seriesByName, cursorByName, ts) {
    const series = seriesByName.get(name);
    if (!series) return { bid: 0, ask: 0 };
    const cursor = cursorByName.get(name) || { bidIndex: 0, askIndex: 0, bid: 0, ask: 0 };
    while (cursor.bidIndex < series.bid.length && series.bid[cursor.bidIndex].ts <= ts) {
      cursor.bid = series.bid[cursor.bidIndex].v;
      cursor.bidIndex += 1;
    }
    while (cursor.askIndex < series.ask.length && series.ask[cursor.askIndex].ts <= ts) {
      cursor.ask = series.ask[cursor.askIndex].v;
      cursor.askIndex += 1;
    }
    cursorByName.set(name, cursor);
    return cursor;
  }

  function initRollChart() {
    if (rollChart || !rollChartHost) return;
    rollChart = makeChart(rollChartHost);
    const bidOptions = { color: "#21d19f", lineWidth: 2, title: "Bid straddle" };
    const askOptions = { color: "#ffb15c", lineWidth: 2, title: "Ask straddle" };
    rollBidSeries = rollChart.addLineSeries
      ? rollChart.addLineSeries(bidOptions)
      : rollChart.addSeries(window.LightweightCharts.LineSeries, bidOptions);
    rollAskSeries = rollChart.addLineSeries
      ? rollChart.addLineSeries(askOptions)
      : rollChart.addSeries(window.LightweightCharts.LineSeries, askOptions);
    queueChartResize();
  }

  async function loadRollingStraddle() {
    initRollChart();
    const start = fromLocalInput(rollStart());
    const end = fromLocalInput(rollEnd());
    if (!start || !end) throw new Error("Rolling start and end are required.");

    setRollStatus("Spot");
    const sym = rollSymbol().trim().toUpperCase();
    const spotData = await nubraFetch("charts/timeseries", {
      method: "POST",
      body: JSON.stringify({
        query: [{
          exchange: rollExchange(),
          type: rollType(),
          values: [sym],
          fields: ["close"],
          startDate: start,
          endDate: end,
          interval: "1s",
          intraDay: false,
          realTime: false
        }]
      })
    });
    const spotSymbolData = extractSymbolData(spotData, sym);
    const spotPoints = (Array.isArray(spotSymbolData?.close) ? spotSymbolData.close : [])
      .map((p) => ({ ts: pointMs(p), spot: pointNumber(p, true) }))
      .filter((p) => Number.isFinite(p.ts) && p.spot > 0)
      .sort((a, b) => a.ts - b.ts);
    if (!spotPoints.length) throw new Error("No 1-second spot data returned.");

    setRollStatus("Refdata");
    let rows = await rollingOptionRows();
    if (!rollExpiry()) {
      const expiries = [...new Set(rows.map((row) => row.expiry))].sort();
      setRollExpiries(expiries);
      setRollExpiry(expiries[0] || "");
    }
    rows = rows.filter((row) => row.expiry === rollExpiry());
    if (!rows.length) throw new Error("No option rows found for selected expiry.");

    const strikes = [...new Set(rows.map((row) => row.strike))].sort((a, b) => a - b);
    const step = inferStrikeStep(strikes);
    const rowByKey = new Map(rows.map((row) => [`${row.strike}|${row.side}`, row]));
    const requiredStrikes = new Set();
    for (const point of spotPoints) {
      const atm = nearestStrike(point.spot, strikes, step);
      for (let offset = -2; offset <= 2; offset++) {
        requiredStrikes.add(nearestStrike(atm + offset * step, strikes, step));
      }
    }

    const optionNames = [];
    for (const strike of requiredStrikes) {
      const ce = rowByKey.get(`${strike}|CE`);
      const pe = rowByKey.get(`${strike}|PE`);
      if (ce) optionNames.push(ce.name);
      if (pe) optionNames.push(pe.name);
    }
    if (!optionNames.length) throw new Error("No CE/PE symbols found around ATM +/-2.");

    const seriesByName = await fetchRollingSeries([...new Set(optionNames)], start, end);
    const cursorByName = new Map();
    const bidLine = [];
    const askLine = [];
    const selected = [];

    for (const point of spotPoints) {
      const atm = nearestStrike(point.spot, strikes, step);
      let best = null;
      for (let offset = -2; offset <= 2; offset++) {
        const strike = nearestStrike(atm + offset * step, strikes, step);
        const ce = rowByKey.get(`${strike}|CE`);
        const pe = rowByKey.get(`${strike}|PE`);
        if (!ce || !pe) continue;
        const ceQuote = advanceQuote(ce.name, seriesByName, cursorByName, point.ts);
        const peQuote = advanceQuote(pe.name, seriesByName, cursorByName, point.ts);
        const bid = ceQuote.bid + peQuote.bid;
        const ask = ceQuote.ask + peQuote.ask;
        if (bid <= 0 || ask <= 0) continue;
        const mid = (bid + ask) / 2;
        if (!best || mid < best.mid) best = { strike, bid, ask, mid };
      }
      if (!best) continue;
      bidLine.push({ time: tvTime(point.ts), value: best.bid });
      askLine.push({ time: tvTime(point.ts), value: best.ask });
      selected.push({ ...point, ...best });
    }
    if (!selected.length) throw new Error("No complete bid/ask straddle points found.");

    rollBidSeries.setData(bidLine);
    rollAskSeries.setData(askLine);
    resizeChart(rollChart, rollChartHost);
    rollChart.timeScale().fitContent();
    const last = selected[selected.length - 1];
    setRollStats({
      spot: rupee.format(last.spot),
      strike: number.format(last.strike),
      bid: rupee.format(last.bid),
      ask: rupee.format(last.ask),
      points: String(selected.length),
      meta: `${sym} ${rollExpiry()} | 1s l1bid/l1ask | ${requiredStrikes.size} strikes | ${rollExchange()}`
    });
    setRollStatus("Ready");
  }

  onMount(() => {
    initPriceChart();
    initRollChart();
    window.addEventListener("resize", resizeVisibleCharts);
    queueChartResize();
  });

  createEffect(() => {
    section();
    queueChartResize();
  });

  return (
    <div class="min-h-screen bg-[#0B0E11] text-gray-200">
      <header class="flex items-center justify-between border-b border-slate-800/80 bg-[#12161A] px-3 py-2">
        <div class="flex min-w-0 items-center gap-3">
          <div class="grid h-8 w-8 place-items-center bg-cyan-500 font-black text-[#0B0E11]">N</div>
          <div class="min-w-0">
            <p class="text-[10px] font-bold uppercase tracking-normal text-cyan-400">Nubra Market Research</p>
            <h1 class="truncate text-sm font-semibold text-white">Options Intelligence Workstation</h1>
          </div>
        </div>

        <nav class="flex items-center border border-slate-800/80 bg-[#0B0E11] p-0.5 text-xs">
          <button
            class={`px-4 py-1.5 font-medium transition-colors ${section() === "rolling" ? "bg-gray-100 text-gray-950" : "text-gray-400 hover:text-white"}`}
            onClick={() => setSection("rolling")}
          >
            Rolling Straddle
          </button>
          <button
            class={`px-4 py-1.5 font-medium transition-colors ${section() === "market" ? "bg-gray-100 text-gray-950" : "text-gray-400 hover:text-white"}`}
            onClick={() => setSection("market")}
          >
            Market Chart
          </button>
        </nav>

        <div class="flex items-center gap-2">
          <button class="terminal-button-secondary" onClick={() => setDrawerOpen(true)}>
            Session
          </button>
          <div class="flex items-center gap-2 border border-slate-800/80 bg-[#161A1E] px-3 py-1.5 text-xs font-medium text-gray-300">
            <span class={`h-2 w-2 ${authed() ? "bg-emerald-400" : "bg-orange-400"}`}></span>
            {authed() ? "Session ready" : "Session needed"}
          </div>
        </div>
      </header>

      <Show when={drawerOpen()}>
        <div class="fixed inset-0 z-40 bg-black/50" onClick={() => setDrawerOpen(false)}></div>
      </Show>

      <aside class={`fixed inset-y-0 left-0 z-50 w-[360px] border-r border-gray-800 bg-[#12161A] shadow-2xl transition-transform duration-200 ${drawerOpen() ? "translate-x-0" : "-translate-x-full"}`}>
        <div class="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div>
            <p class="text-[10px] font-bold uppercase text-cyan-400">Connection</p>
            <h2 class="text-sm font-semibold text-white">Nubra Session</h2>
          </div>
          <button class="terminal-button-secondary px-2" onClick={() => setDrawerOpen(false)}>Close</button>
        </div>

        <div class="space-y-5 p-4">
          <section class="space-y-3">
            <label class="grid gap-1 text-[11px] font-medium text-gray-400">
              Environment
              <select class="terminal-input" value={environment()} onInput={(e) => setEnvironment(e.currentTarget.value)}>
                <option value="https://api.nubra.io">Production</option>
                <option value="https://uatapi.nubra.io">UAT</option>
              </select>
            </label>
            <label class="grid gap-1 text-[11px] font-medium text-gray-400">
              Session token
              <input class="terminal-input" type="password" value={token()} onInput={(e) => {
                setToken(e.currentTarget.value);
                localStorage.setItem("nubraSessionToken", e.currentTarget.value);
              }} placeholder="Bearer session token" />
            </label>
            <label class="grid gap-1 text-[11px] font-medium text-gray-400">
              Device ID
              <input class="terminal-input" value={deviceId()} onInput={(e) => {
                setDeviceId(e.currentTarget.value);
                localStorage.setItem("nubraDeviceId", e.currentTarget.value);
              }} placeholder="Nubra-OSS-..." />
            </label>
          </section>

          <section class="space-y-3 border-t border-gray-800 pt-4">
            <div class="grid grid-cols-2 gap-2">
              <label class="grid gap-1 text-[11px] font-medium text-gray-400">
                Method
                <select class="terminal-input" value={authMethod()} onInput={(e) => setAuthMethod(e.currentTarget.value)}>
                  <option value="otp">SMS OTP</option>
                  <option value="totp">TOTP</option>
                </select>
              </label>
              <label class="grid gap-1 text-[11px] font-medium text-gray-400">
                Phone
                <input class="terminal-input" value={phone()} onInput={(e) => setPhone(e.currentTarget.value)} placeholder="Registered phone" />
              </label>
            </div>
            <button class="terminal-button w-full" onClick={() => run(startLogin)} disabled={busy()}>Start Login</button>
            <div class="grid grid-cols-2 gap-2">
              <label class="grid gap-1 text-[11px] font-medium text-gray-400">
                OTP / TOTP
                <input class="terminal-input" value={otp()} onInput={(e) => setOtp(e.currentTarget.value)} inputmode="numeric" />
              </label>
              <label class="grid gap-1 text-[11px] font-medium text-gray-400">
                MPIN
                <input class="terminal-input" type="password" value={mpin()} onInput={(e) => setMpin(e.currentTarget.value)} inputmode="numeric" />
              </label>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button class="terminal-button-secondary" onClick={() => run(verifyCode)} disabled={busy()}>Verify Code</button>
              <button class="terminal-button-secondary" onClick={() => run(verifyMpin)} disabled={busy()}>Verify MPIN</button>
            </div>
            <p class="text-xs leading-5 text-gray-400">{loginStatus()}</p>
          </section>
        </div>
      </aside>

      <main class="flex min-h-[calc(100vh-49px)] flex-col">
        <Show when={toast()}>
          <div class="border-b border-red-900/60 bg-red-950/30 px-3 py-2 text-xs font-medium text-red-200">{toast()}</div>
        </Show>

        <Show when={section() === "rolling"}>
          <section class="flex flex-wrap items-center gap-2 border-b border-slate-800/80 bg-[#151A20] px-3 py-2 text-xs">
            <label class="terminal-label">
              Underlying
              <input class="terminal-input w-28" value={rollSymbol()} onInput={(e) => setRollSymbol(e.currentTarget.value.toUpperCase())} />
            </label>
            <label class="terminal-label">
              Type
              <select class="terminal-input w-24" value={rollType()} onInput={(e) => setRollType(e.currentTarget.value)}>
                <option value="INDEX">INDEX</option>
                <option value="STOCK">STOCK</option>
              </select>
            </label>
            <label class="terminal-label">
              Exchange
              <select class="terminal-input w-20" value={rollExchange()} onInput={(e) => setRollExchange(e.currentTarget.value)}>
                <option value="NSE">NSE</option>
                <option value="BSE">BSE</option>
              </select>
            </label>
            <label class="terminal-label">
              Expiry
              <select class="terminal-input w-32" value={rollExpiry()} onInput={(e) => setRollExpiry(e.currentTarget.value)}>
                <option value="">Auto</option>
                <For each={rollExpiries()}>{(expiry) => <option value={expiry}>{expiry}</option>}</For>
              </select>
            </label>
            <label class="terminal-label">
              Start
              <input class="terminal-input w-44" type="datetime-local" value={rollStart()} onInput={(e) => setRollStart(e.currentTarget.value)} />
            </label>
            <label class="terminal-label">
              End
              <input class="terminal-input w-44" type="datetime-local" value={rollEnd()} onInput={(e) => setRollEnd(e.currentTarget.value)} />
            </label>
            <div class="ml-auto flex items-center gap-2">
              <button class="terminal-button-secondary" onClick={() => run(loadRollingExpiries)} disabled={busy()}>Load Expiries</button>
              <button class="terminal-button" onClick={() => run(loadRollingStraddle)} disabled={busy()}>Plot Rolling</button>
            </div>
          </section>

          <section class="grid grid-cols-4 border-b border-gray-800 bg-[#11161B] px-4 py-2">
            <Metric label="Spot" value={rollStats().spot} />
            <Metric label="Selected strike" value={rollStats().strike} />
            <Metric label="Bid straddle" value={rollStats().bid} />
            <Metric label="Ask straddle" value={rollStats().ask} />
          </section>

          <section class="flex items-center justify-between border-b border-slate-800/80 bg-[#0E1217] px-3 py-2">
            <div>
              <h2 class="text-sm font-semibold text-white">Rolling Straddle</h2>
              <p class="font-mono text-[11px] text-gray-500">{rollStats().meta}</p>
            </div>
            <div class="font-mono text-[11px] text-gray-400">Status: <span class="text-white">{rollStatus()}</span></div>
          </section>

          <div class="chart-surface flex-1" ref={(el) => { rollChartHost = el; initRollChart(); queueChartResize(); }}></div>
        </Show>

        <Show when={section() === "market"}>
          <section class="flex flex-wrap items-center gap-2 border-b border-slate-800/80 bg-[#151A20] px-3 py-2 text-xs">
            <label class="terminal-label">
              Symbol
              <input class="terminal-input w-28" value={symbol()} onInput={(e) => setSymbol(e.currentTarget.value.toUpperCase())} />
            </label>
            <label class="terminal-label">
              Type
              <select class="terminal-input w-24" value={instrumentType()} onInput={(e) => setInstrumentType(e.currentTarget.value)}>
                <option value="INDEX">INDEX</option>
                <option value="STOCK">STOCK</option>
                <option value="FUT">FUT</option>
                <option value="OPT">OPT</option>
              </select>
            </label>
            <label class="terminal-label">
              Exchange
              <select class="terminal-input w-20" value={exchange()} onInput={(e) => setExchange(e.currentTarget.value)}>
                <option value="NSE">NSE</option>
                <option value="BSE">BSE</option>
              </select>
            </label>
            <label class="terminal-label">
              Interval
              <select class="terminal-input w-20" value={interval()} onInput={(e) => setIntervalValue(e.currentTarget.value)}>
                <option value="1s">1s</option>
                <option value="1m">1m</option>
                <option value="3m">3m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1h">1h</option>
                <option value="1d">1d</option>
              </select>
            </label>
            <label class="terminal-label">
              Start
              <input class="terminal-input w-44" type="datetime-local" value={startDate()} onInput={(e) => setStartDate(e.currentTarget.value)} />
            </label>
            <label class="terminal-label">
              End
              <input class="terminal-input w-44" type="datetime-local" value={endDate()} onInput={(e) => setEndDate(e.currentTarget.value)} />
            </label>
            <div class="ml-auto flex items-center gap-2">
              <button class="terminal-button-secondary" onClick={() => run(loadSpotPrice)} disabled={busy()}>Spot</button>
              <button class="terminal-button" onClick={() => run(loadPriceChart)} disabled={busy()}>Load Chart</button>
            </div>
          </section>

          <section class="grid grid-cols-4 border-b border-gray-800 bg-[#11161B] px-4 py-2">
            <Metric label="Spot" value={spot()} />
            <Metric label="Change" value={change()} />
            <Metric label="Candles" value={String(candleCount())} />
            <Metric label="Status" value={chartStatus()} />
          </section>

          <section class="flex items-center justify-between border-b border-slate-800/80 bg-[#0E1217] px-3 py-2">
            <div>
              <h2 class="text-sm font-semibold text-white">Market Chart</h2>
              <p class="font-mono text-[11px] text-gray-500">{symbol()} {interval()} price candles in IST</p>
            </div>
            <div class="font-mono text-[11px] text-gray-400">Session: <span class="text-white">{authed() ? "READY" : "MISSING"}</span></div>
          </section>

          <div class="chart-surface flex-1" ref={(el) => { priceChartHost = el; initPriceChart(); queueChartResize(); }}></div>
        </Show>
      </main>
    </div>
  );
}

function Panel(props) {
  return (
    <section class="border border-gray-800 bg-[#12161A]">
      <div class="border-b border-gray-800 px-3 py-2">
        <div>
          <h3 class="text-sm font-semibold text-white">{props.title}</h3>
          <p class="font-mono text-[11px] text-gray-500">{props.subtitle}</p>
        </div>
      </div>
      {props.children}
    </section>
  );
}

function Metric(props) {
  return (
    <div class="min-w-0 px-3 first:pl-0">
      <div class="flex min-w-0 items-baseline gap-2">
        <span class="metric-label">{props.label}</span>
        <strong class="metric-value">{props.value}</strong>
      </div>
    </div>
  );
}

render(() => <App />, document.getElementById("root"));
