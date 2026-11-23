/* Refood Training — client
   Stato salvato in localStorage: chiudere il browser non perde nulla.
   Modalità nativa: 1 Top Set + Back-off con calcolo automatico (step minimo 2.5 kg). */

// Funziona sia su Vercel (/api/sheets) sia su Netlify (/.netlify/functions/sheets).
const API = location.hostname.includes("netlify")
  ? "/.netlify/functions/sheets"
  : "/api/sheets";
const LS = "refood.training.v2";

const DB = { esercizi: [], sessioni: [], log: [], eventi: [] };
let S = {
  day: null,
  view: "allenamento",
  sets: {},      // "A-01:1" -> true
  reps: {},      // "A-01:1" -> 7
  kg: {},        // "A-01"   -> 22.5 (Top Set o carico fisso)
  boKg: {},      // "A-01"   -> override manuale kg back-off (opzionale)
  mode: {},      // "A-01"   -> "flat" se l'utente passa a carico fisso
  boPct: 12.5,   // riduzione carico back-off di default (-12.5%)
  boStep: 2.5,   // peso minimo disponibile (2.5 kg)
  rpe: 7, sonno: "Buono", stress: "Medio", note: "",
  tStart: 0, tAcc: 0, tRun: false,
  rest: {},      // "A-01"   -> timestamp fine
};

/* ---------------- persistenza ---------------- */
const save = () => {
  S.savedAt = Date.now();
  localStorage.setItem(LS, JSON.stringify(S));
};
function load() {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return;
    const p = JSON.parse(raw);
    const eta = p.savedAt ? Date.now() - p.savedAt : 0;
    if (eta > 16 * 3600 * 1000) return localStorage.removeItem(LS);
    S = {
      ...S,
      ...p,
      boKg: p.boKg || {},
      mode: p.mode || {},
      boPct: typeof p.boPct === "number" ? p.boPct : 12.5,
      boStep: typeof p.boStep === "number" ? p.boStep : 2.5,
    };
  } catch (e) { localStorage.removeItem(LS); }
}

/* ---------------- utilità ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
const fmtKg = (v) => {
  const n = Math.round(num(v) * 100) / 100;
  return String(n);
};
const nSerie = (e) => Math.max(1, parseInt(String(e["Serie target"]).split("-").pop()) || 4);
const isTopBo = (e) => nSerie(e) >= 2 && S.mode[e.ID] !== "flat";

// "5-7" -> 7 ; "12" -> 12 ; "max" -> null
function topReps(e) {
  const t = String(e["Ripetizioni target"] || "").trim();
  if (/max/i.test(t)) return null;
  const nums = t.match(/\d+/g);
  return nums ? Math.max(...nums.map(Number)) : null;
}
function botReps(e) {
  const nums = String(e["Ripetizioni target"] || "").match(/\d+/g);
  return nums ? Math.min(...nums.map(Number)) : 8;
}
// Range consigliato per le serie di back-off in base al range del Top Set
function boRange(e) {
  const t = String(e["Ripetizioni target"] || "").trim();
  if (/max/i.test(t)) return t;
  const b = botReps(e), tp = topReps(e) || b;
  if (tp <= 8) return "8-10";
  if (tp <= 10) return "10-12";
  if (tp <= 12) return "12-15";
  return t;
}
function boBotReps(e) {
  const nums = String(boRange(e)).match(/\d+/g);
  return nums ? Math.min(...nums.map(Number)) : botReps(e);
}

// Calcolo automatico del carico di back-off arrotondato allo step minimo (2.5 kg).
// Garantisce sempre almeno uno step sotto il Top Set quando topKg > step,
// e non scende mai sotto step (o 0 se esercizio a corpo libero).
function calcBackoff(topKg, pctVal = S.boPct, step = S.boStep) {
  const kg = num(topKg);
  if (kg <= 0) return 0;
  if (kg <= step) return Math.round(kg * 100) / 100;
  const raw = kg * (1 - pctVal / 100);
  let rounded = Math.round(raw / step) * step;
  if (rounded >= kg) {
    rounded = Math.floor((kg - 1e-9) / step) * step;
  }
  return Math.max(step, Math.round(rounded * 100) / 100);
}
function currentBoKg(id, topKg) {
  if (S.boKg[id] !== undefined && S.boKg[id] !== null && S.boKg[id] !== "") {
    return num(S.boKg[id]);
  }
  return calcBackoff(topKg, S.boPct, S.boStep);
}

function secs(t) {
  t = String(t || "").trim();
  const m = t.match(/(\d+)\s*'/), s = t.match(/'\s*(\d+)/);
  if (m) return (+m[1]) * 60 + (s ? +s[1] : 0);
  const n = parseInt(t); return isNaN(n) ? 90 : n;
}
const hhmmss = (t) => [Math.floor(t / 3600), Math.floor(t % 3600 / 60), t % 60]
  .map((x) => String(x).padStart(2, "0")).join(":");

// Epley: stima del massimale da una serie. Serie sotto le 12 reps, oltre perde precisione.
const e1rm = (kg, reps) => (reps > 0 && reps <= 12) ? kg * (1 + reps / 30) : kg;

// Parser universale per Log_v2: legge sia il vecchio formato ("8-8-8-7")
// sia il nuovo formato Top Set + Back-off ("7 | 9-9-8 @20").
function parseLogEntry(kgVal, repsStr) {
  const topKg = num(kgVal);
  const raw = String(repsStr || "").trim();

  if (raw.includes("|")) {
    const [tsPart = "", boPart = ""] = raw.split("|").map((s) => s.trim());
    const tsMatch = tsPart.match(/\d+/);
    const tsRep = tsMatch ? parseInt(tsMatch[0], 10) : null;

    const kgMatch = boPart.match(/@\s*([\d.,]+)/);
    const boKg = kgMatch ? num(kgMatch[1]) : calcBackoff(topKg, 12.5, 2.5);

    const boClean = boPart.replace(/@.*$/, "").replace(/BO\s*\([^)]*\)\s*:?/i, "").replace(/BO:?/i, "").trim();
    const boReps = boClean
      ? boClean.split("-").map((x) => parseInt(x, 10)).filter((x) => !isNaN(x))
      : [];

    const allReps = [...(tsRep !== null ? [tsRep] : []), ...boReps];
    const volume =
      (tsRep !== null ? topKg * tsRep : 0) +
      boReps.reduce((a, r) => a + boKg * r, 0);
    const e1rms = [
      ...(tsRep !== null ? [e1rm(topKg, tsRep)] : []),
      ...boReps.map((r) => e1rm(boKg, r)),
    ];

    return {
      isTopBo: true,
      raw,
      topKg,
      tsRep,
      boKg,
      boReps,
      reps: allReps,
      tot: allReps.reduce((a, b) => a + b, 0),
      serie: allReps.length,
      volume,
      best: Math.max(...e1rms, 0),
    };
  }

  const reps = raw.split("-").map((x) => parseInt(x, 10)).filter((x) => !isNaN(x));
  const tot = reps.reduce((a, b) => a + b, 0);
  return {
    isTopBo: false,
    raw,
    topKg,
    tsRep: reps[0] ?? null,
    boKg: null,
    boReps: reps.slice(1),
    reps,
    tot,
    serie: reps.length,
    volume: topKg * tot,
    best: Math.max(...reps.map((r) => e1rm(topKg, r)), 0),
  };
}

function toast(msg, err) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 4200);
}

/* ---------------- dati derivati ---------------- */
function lastPerf(id) {
  const rows = DB.log.filter((r) => r.Esercizio === id);
  if (!rows.length) return null;
  const r = rows[rows.length - 1];
  const parsed = parseLogEntry(r.KG, r["Reps fatte"]);
  return { kg: parsed.topKg, reps: r["Reps fatte"], data: r.Data, parsed };
}
function lastReadapt(id) {
  const rows = DB.eventi.filter((e) =>
    String(e.Tipo).toUpperCase() === "RIADATTAMENTO" && e.Esercizio === id);
  if (!rows.length) return null;
  return rows.sort((a, b) => String(a.Data_inizio).localeCompare(String(b.Data_inizio))).pop();
}
// il riferimento per la prossima seduta: riadattamento se più recente dell'ultimo log
function baseline(id) {
  const p = lastPerf(id), r = lastReadapt(id);
  if (r && (!p || String(r.Data_inizio).slice(0, 10) >= String(p.data).slice(0, 10))) {
    const parsed = parseLogEntry(r.KG, r.Reps);
    return {
      kg: num(r.KG),
      reps: r.Reps,
      data: String(r.Data_inizio).slice(0, 10),
      reset: true,
      note: r.Note,
      parsed,
    };
  }
  return p ? { ...p, reset: false } : null;
}

// Ripetizioni della serie i (0-based): quello che vedi è quello che viene salvato.
function repsFor(ex, i, base) {
  const k = `${ex.ID}:${i + 1}`;
  if (S.reps[k] !== undefined && S.reps[k] !== null && S.reps[k] !== "") return S.reps[k];

  const p = base && base.parsed ? base.parsed : null;
  if (isTopBo(ex)) {
    if (i === 0) {
      if (p && p.tsRep !== null) return p.tsRep;
      return botReps(ex);
    }
    // Serie di back-off (i >= 1)
    if (p && p.isTopBo && p.boReps.length) {
      return p.boReps[i - 1] ?? p.boReps[p.boReps.length - 1] ?? boBotReps(ex);
    }
    return boBotReps(ex);
  }

  const prev = p ? p.reps : [];
  return prev[i] ?? prev[prev.length - 1] ?? botReps(ex);
}

// Regola di progressione:
// - Se l'ultima seduta era Top+BO (o siamo in Top+BO): sali appena il Top Set chiude il massimo del range!
// - Se era carico fisso: sali quando TUTTE le serie chiudono al massimo del range.
function shouldIncrease(ex, base) {
  if (!base || base.reset || !base.parsed) return false;
  const top = topReps(ex); if (!top) return false;
  const p = base.parsed;
  if (p.isTopBo) {
    return p.tsRep !== null && p.tsRep >= top;
  }
  if (p.reps.length < nSerie(ex)) return false;
  return p.reps.every((r) => r >= top);
}

/* ---------------- render: allenamento ---------------- */
function viewAllenamento() {
  const schede = [...new Set(DB.esercizi.map((e) => e.Scheda))].filter(Boolean);
  if (!S.day || !schede.includes(S.day)) S.day = schede[0];
  const list = DB.esercizi.filter((e) => e.Scheda === S.day)
    .sort((a, b) => (+a.Ordine || 0) - (+b.Ordine || 0));

  const days = schede.map((s) => {
    const letter = s.split(" ")[0];
    const giorno = (DB.esercizi.find((e) => e.Scheda === s) || {}).Giorno || "";
    return `<button data-day="${esc(s)}" class="${s === S.day ? "on" : ""}">
      <b>${esc(letter)}</b><span>${esc(giorno.slice(0, 3))}</span></button>`;
  }).join("");

  const title = S.day.replace(/^[A-D]\s*-\s*/, "");
  const pctOpts = [10, 12.5, 15].map((p) =>
    `<button data-bopct="${p}" class="${S.boPct === p ? "on" : ""}">−${p}%</button>`
  ).join("");

  return `
  <div class="days">${days}</div>
  <h2>${esc(title)}</h2>
  <p class="sub">${list.length} esercizi · ${list.reduce((a, e) => a + nSerie(e), 0)} serie totali</p>
  <div class="timerbar">
    <button id="tToggle" class="${S.tRun ? "" : "go"}">${S.tRun ? "Metti in pausa" : "Avvia allenamento"}</button>
    <button id="tReset">Azzera</button>
  </div>
  <div class="bobar">
    <span class="bolbl">Back-off auto <small>(step ${fmtKg(S.boStep)} kg)</small></span>
    <div class="bopills">${pctOpts}</div>
  </div>
  ${list.map(exCard).join("")}
  <div class="card">
    <h2 style="font-size:21px">Chiudi la seduta</h2>
    <label class="f">Sforzo percepito (RPE)</label>
    <div class="range"><input type="range" min="1" max="10" value="${S.rpe}" id="fRpe"><b id="fRpeV">${S.rpe}</b></div>
    <label class="f">Sonno</label>
    <select class="f" id="fSonno">${["Pessimo", "Scarso", "Medio", "Buono", "Ottimo"]
      .map((o) => `<option ${o === S.sonno ? "selected" : ""}>${o}</option>`).join("")}</select>
    <label class="f">Stress</label>
    <select class="f" id="fStress">${["Basso", "Medio", "Alto"]
      .map((o) => `<option ${o === S.stress ? "selected" : ""}>${o}</option>`).join("")}</select>
    <label class="f">Note</label>
    <textarea class="f" id="fNote" placeholder="Com'è andata? Cosa cambiare la prossima volta?">${esc(S.note)}</textarea>
    <button class="btn primary" id="btnSave">Salva allenamento</button>
    <button class="btn danger" id="btnClear">Svuota la seduta</button>
  </div>`;
}

function exCard(ex) {
  const id = ex.ID, n = nSerie(ex), base = baseline(id);
  const tsMode = isTopBo(ex);
  const up = shouldIncrease(ex, base);
  const def = base ? base.kg : 0;
  const kg = S.kg[id] !== undefined ? S.kg[id] : def;
  const changed = Math.abs(num(kg) - num(def)) > 1e-9;

  const boAuto = calcBackoff(kg, S.boPct, S.boStep);
  const boVal = currentBoKg(id, kg);
  const boManual = S.boKg[id] !== undefined && Math.abs(num(S.boKg[id]) - boAuto) > 1e-9;

  let done = 0;
  const sets = Array.from({ length: n }, (_, i) => {
    const k = `${id}:${i + 1}`, on = !!S.sets[k];
    if (on) done++;
    const dflt = repsFor(ex, i, base);
    const isTs = tsMode && i === 0;
    const isBo = tsMode && i > 0;
    const lbl = isTs ? "TOP SET" : isBo ? `BO ${i}` : `Serie ${i + 1}`;
    return `<div class="set ${isTs ? "ts" : ""} ${isBo ? "bo" : ""} ${on ? "on" : ""}">
      <label>${lbl}</label>
      <input type="number" inputmode="numeric" value="${dflt}" data-rep="${k}">
      <button class="chk" data-set="${k}">${on ? "✓" : "○"}</button>
    </div>`;
  }).join("");

  let prevLine;
  if (base && base.reset) {
    prevLine = `<div class="prev warn">Riadattamento del ${esc(base.data)} — riparti da ${fmtKg(base.kg)} kg · ${esc(base.reps)}${base.note ? ` · ${esc(base.note)}` : ""}</div>`;
  } else if (base && base.parsed && base.parsed.isTopBo) {
    const p = base.parsed;
    const pezzi = [];
    if (p.tsRep !== null) pezzi.push(`TS ${fmtKg(p.topKg)} kg × ${p.tsRep}`);
    if (p.boReps.length) pezzi.push(`BO ${fmtKg(p.boKg)} kg × ${p.boReps.join("-")}`);
    prevLine = `<div class="prev">Ultima volta (${esc(base.data)}): ${esc(pezzi.join(" · "))}</div>`;
  } else if (base) {
    prevLine = `<div class="prev">Ultima volta (${esc(base.data)}): ${fmtKg(base.kg)} kg · ${esc(base.reps)}</div>`;
  } else {
    prevLine = `<div class="prev none">Mai registrato — trova il carico oggi</div>`;
  }

  const top = topReps(ex);
  const kgCls = base && base.reset ? "reset" : (up && !changed ? "up" : "");
  const kgLbl = base && base.reset
    ? (tsMode ? "TOP SET — riparti" : "KG — riparti da qui")
    : (up && !changed
      ? (tsMode ? `TOP SET — sali (${top} ok)` : `KG — sali, chiuse a ${top}`)
      : (tsMode ? "TOP SET (KG)" : "KG"));

  const diffKg = Math.round((num(kg) - boVal) * 100) / 100;
  const boSub = num(kg) > 0
    ? (boManual
      ? `BACK-OFF · manuale (auto ${fmtKg(boAuto)})`
      : `BACK-OFF · −${fmtKg(diffKg)} kg (auto)`)
    : "BACK-OFF (KG)";

  const target = tsMode
    ? [`1 Top Set (${ex["Ripetizioni target"]}) + ${n - 1} Back-off (${boRange(ex)})`,
      ex.Recupero ? `rec ${ex.Recupero}` : ""].filter(Boolean).join(" · ")
    : [`${ex["Serie target"]}×${ex["Ripetizioni target"]}`,
      ex.Recupero ? `rec ${ex.Recupero}` : ""].filter(Boolean).join(" · ");

  const modeBtn = n >= 2
    ? `<button class="modebtn ${tsMode ? "on" : ""}" data-mode="${esc(id)}" title="Alterna tra Top Set + Back-off e carico fisso">${tsMode ? "Top+BO" : "Fisso"}</button>`
    : "";

  const footHtml = tsMode
    ? `<div class="foot bo-grid">
        <div class="kg ts-box ${kgCls}">
          <span>${esc(kgLbl)}</span>
          <input type="number" step="any" inputmode="decimal" value="${kg}" data-kg="${esc(id)}">
        </div>
        <div class="kg bo-box ${boManual ? "manual" : ""}">
          <span data-bohint="${esc(id)}">${esc(boSub)}</span>
          <input type="number" step="any" inputmode="decimal" value="${boVal}" data-bokg="${esc(id)}">
        </div>
        <button class="rest wide" data-rest="${esc(id)}" data-secs="${secs(ex.Recupero)}">
          <b>${secs(ex.Recupero)}s</b><small>recupero</small>
        </button>
      </div>`
    : `<div class="foot">
        <div class="kg ${kgCls}">
          <span>${esc(kgLbl)}</span>
          <input type="number" step="any" inputmode="decimal" value="${kg}" data-kg="${esc(id)}">
        </div>
        <button class="rest" data-rest="${esc(id)}" data-secs="${secs(ex.Recupero)}">
          <b>${secs(ex.Recupero)}s</b><small>recupero</small>
        </button>
      </div>`;

  return `
  <div class="ex ${done === n ? "done" : ""} ${base && base.reset ? "reset" : ""}" data-ex="${esc(id)}">
    <div class="ex-head">
      <div>
        <div class="ex-num">${ex.Ordine}</div>
        <div class="ex-name">${esc(ex.Esercizio)}</div>
      </div>
      <div class="ex-right">
        ${modeBtn}
        ${done === n ? '<div class="tick">✓</div>' : done ? `<div class="ex-num">${done}/${n}</div>` : ""}
      </div>
    </div>
    <div class="ex-target">${esc(target)}</div>
    ${prevLine}
    ${ex["Note tecnica"] ? `<details class="tech"><summary>Note tecnica</summary><p>${esc(ex["Note tecnica"])}</p></details>` : ""}
    <div class="sets">${sets}</div>
    ${footHtml}
  </div>`;
}

/* ---------------- render: debolezze ---------------- */
function analisi() {
  const byId = {};
  DB.log.forEach((r) => {
    const d = String(r.Data).slice(0, 10);
    const p = parseLogEntry(r.KG, r["Reps fatte"]);
    (byId[r.Esercizio] ||= []).push({
      d,
      kg: p.topKg,
      reps: r["Reps fatte"],
      vol: p.volume,
    });
  });
  const oggi = Date.now();
  const out = [];

  DB.esercizi.forEach((ex) => {
    const g = (byId[ex.ID] || []).sort((a, b) => a.d.localeCompare(b.d));
    if (!g.length) { out.push({ ex, stato: "nuovo", pct: null, statiche: 0, last: "—" }); return; }
    const last = g[g.length - 1];
    if ((oggi - new Date(last.d).getTime()) / 864e5 > 30) return;

    let stat = 1;
    for (let i = g.length - 2; i >= 0 && g[i].kg === last.kg; i--) stat++;

    const v = g.map((x) => x.vol);
    let pct = null;
    if (v.length >= 4) {
      const a = (v[v.length - 4] + v[v.length - 3]) / 2, b = (v[v.length - 2] + v[v.length - 1]) / 2;
      if (a > 0) pct = b / a - 1;
    } else if (v.length === 3 && (v[0] + v[1]) > 0) pct = v[2] / ((v[0] + v[1]) / 2) - 1;

    const r = lastReadapt(ex.ID);
    const riad = r && String(r.Data_inizio).slice(0, 10) >= last.d;

    let stato;
    if (riad) stato = "riadattato";
    else if (g.length < 3 || pct === null) stato = "pochi";
    else if (pct < -0.05) stato = "regressione";
    else if (stat >= 3 && pct < 0.02) stato = "stallo";
    else stato = "ok";
    out.push({ ex, stato, pct, statiche: stat, last: last.d, kg: last.kg, storia: g.slice(-8) });
  });

  const rank = { regressione: 0, stallo: 1, riadattato: 2, ok: 3, pochi: 4, nuovo: 5 };
  return out.sort((a, b) => rank[a.stato] - rank[b.stato] || (a.pct ?? 0) - (b.pct ?? 0));
}

function viewDebolezze() {
  const a = analisi();
  const c = (s) => a.filter((x) => x.stato === s).length;
  const bad = a.filter((x) => x.stato === "regressione" || x.stato === "stallo");
  const dot = { regressione: "red", stallo: "amber", ok: "green", riadattato: "blue", pochi: "grey", nuovo: "grey" };
  const lab = { regressione: "In calo", stallo: "Fermo", ok: "Progredisce", riadattato: "Riadattato", pochi: "Pochi dati", nuovo: "Mai fatto" };

  const card = (x) => {
    const st = x.storia || [];
    const max = Math.max(...st.map((s) => s.vol), 1);
    return `<details class="item">
      <summary>
        <span class="dot ${dot[x.stato]}"></span>
        <span style="flex:1">
          <h4>${esc(x.ex.Esercizio)}</h4>
          <div class="meta">${lab[x.stato]}${x.pct !== null ? ` · volume ${(x.pct * 100).toFixed(1)}%` : ""}${x.kg !== undefined ? ` · ${x.statiche} sedute a ${x.kg} kg` : ""}</div>
        </span>
      </summary>
      <div class="body">
        <table><tr><th>Data</th><th>KG</th><th>Reps</th></tr>
        ${st.map((s) => `<tr><td>${esc(s.d)}</td><td>${s.kg}</td><td>${esc(s.reps)}</td></tr>`).join("")}</table>
        <div class="spark">${st.map((s) => `<i style="height:${Math.round(s.vol / max * 100)}%"></i>`).join("")}</div>
      </div>
    </details>`;
  };

  return `
  <h2>Debolezze</h2>
  <p class="sub">Confronto il volume reale (Top Set + Back-off) delle ultime due sedute con le due precedenti. In calo sotto il −5%, fermo se stesso carico da 3 sedute.</p>
  <div class="stats">
    <div class="stat red"><b>${c("regressione")}</b><span>in calo</span></div>
    <div class="stat amber"><b>${c("stallo")}</b><span>fermi</span></div>
    <div class="stat green"><b>${c("ok")}</b><span>progrediscono</span></div>
  </div>
  ${bad.length
      ? `<h2 style="font-size:20px;margin-top:22px">Da sistemare</h2>
       <p class="sub">Riadatta solo se sotto il range di reps o in calo da due sedute.</p>
       ${bad.map(card).join("")}`
      : `<div class="empty">Nessun esercizio fermo o in calo. Continua così.</div>`}
  <h2 style="font-size:20px;margin-top:26px">Tutti gli esercizi</h2>
  <div style="margin-top:10px">${a.filter((x) => !bad.includes(x)).map(card).join("")}</div>`;
}

/* ---------------- render: riadattamento ---------------- */
function viewRiadatta() {
  const opts = DB.esercizi.map((e) =>
    `<option value="${esc(e.ID)}">${esc(e.Esercizio)} — ${esc(e.Scheda.split(" ")[0])}</option>`).join("");
  const ev = [...DB.eventi].reverse().slice(0, 12);
  const nomi = Object.fromEntries(DB.esercizi.map((e) => [e.ID, e.Esercizio]));

  return `
  <h2>Riadatta</h2>
  <p class="sub">Azzera la progressione di un esercizio: la prossima seduta parte da questo carico sul Top Set (il back-off si ricalcola in automatico).</p>
  <div class="card">
    <label class="f">Esercizio</label>
    <select class="f" id="rEx">${opts}</select>
    <div class="row" style="margin-top:12px">
      <div style="flex:1"><label class="f" style="margin-top:0">KG</label><input class="f" type="number" step="0.25" id="rKg" value="0"></div>
      <div style="flex:1"><label class="f" style="margin-top:0">Serie</label><input class="f" type="number" id="rSerie" value="3"></div>
      <div style="flex:1"><label class="f" style="margin-top:0">Reps</label><input class="f" type="number" id="rReps" value="10"></div>
    </div>
    <label class="f">Motivo</label>
    <input class="f" id="rNota" placeholder="es. reset post-stallo, ricostruire reps pulite">
    <button class="btn primary" id="btnRiad">Salva riadattamento</button>
  </div>

  <div class="card">
    <h2 style="font-size:20px">Settimana di scarico</h2>
    <div class="row" style="margin-top:8px">
      <div style="flex:1"><label class="f" style="margin-top:0">Dal</label><input class="f" type="date" id="dStart"></div>
      <div style="flex:1"><label class="f" style="margin-top:0">Al</label><input class="f" type="date" id="dEnd"></div>
    </div>
    <button class="btn" id="btnDeload">Registra scarico</button>
  </div>

  <h2 style="font-size:20px;margin-top:22px">Ultimi eventi</h2>
  <div style="margin-top:10px">
    ${ev.length ? ev.map((e) => `<div class="card" style="padding:11px 13px">
      <div class="spread"><b style="font-family:'Barlow Semi Condensed',sans-serif;font-size:16px">${esc(e.Tipo)}</b>
      <span class="small muted">${esc(String(e.Data_inizio).slice(0, 10))}</span></div>
      <div class="small muted" style="margin-top:3px">${esc(nomi[e.Esercizio] || e.Esercizio || "tutta la scheda")}${e.KG ? ` · ${e.KG} kg · ${esc(e.Reps)}` : ""}</div>
      ${e.Note ? `<div class="small" style="margin-top:5px">${esc(e.Note)}</div>` : ""}
    </div>`).join("") : '<div class="empty">Nessun evento registrato.</div>'}
  </div>`;
}

/* ---------------- render: storico / analisi ---------------- */
function viewStorico() {
  const ss = [...DB.sessioni].reverse();
  if (!ss.length) return `<h2>Storico</h2><div class="empty">Nessuna seduta registrata.</div>`;
  const nomi = Object.fromEntries(DB.esercizi.map((e) => [e.ID, e.Esercizio]));
  return `<h2>Storico</h2><p class="sub">${ss.length} sedute registrate</p>` + ss.map((s) => {
    const righe = DB.log.filter((r) => r.Sessione_ID === s.ID_Sessione);
    return `<details class="item"><summary><span style="flex:1">
      <h4>${esc(String(s.Data).slice(0, 10))} — ${esc(s.Scheda)}</h4>
      <div class="meta">RPE ${esc(s["RPE (1-10)"])} · sonno ${esc(s.Sonno)} · stress ${esc(s.Stress)}${s.Durata ? ` · ${esc(s.Durata)}` : ""}</div>
      </span></summary><div class="body">
      ${s["Note personali"] ? `<p class="small" style="margin:10px 0">${esc(s["Note personali"])}</p>` : ""}
      <table><tr><th>Esercizio</th><th>KG</th><th>Reps</th></tr>
      ${righe.map((r) => `<tr><td>${esc(nomi[r.Esercizio] || r.Esercizio)}</td><td>${esc(r.KG)}</td><td>${esc(r["Reps fatte"])}</td></tr>`).join("")}
      </table></div></details>`;
  }).join("");
}

/* ---------------- render: analisi per esercizio ---------------- */

// La data da cui parte la scheda v2: prima di quella i numeri non sono confrontabili.
function dataV2() {
  const ev = DB.eventi.find((e) => String(e.Tipo).toUpperCase() === "CAMBIO_SCHEDA");
  return ev ? String(ev.Data_inizio).slice(0, 10) : "0000-00-00";
}

// Serie storica di un esercizio dal cambio scheda in poi
function serie(id) {
  const da = dataV2();
  return DB.log
    .filter((r) => r.Esercizio === id && String(r.Data).slice(0, 10) >= da)
    .map((r) => {
      const p = parseLogEntry(r.KG, r["Reps fatte"]);
      return {
        d: String(r.Data).slice(0, 10),
        kg: p.topKg,
        reps: p.reps,
        raw: p.raw,
        isTopBo: p.isTopBo,
        tsRep: p.tsRep,
        boKg: p.boKg,
        boReps: p.boReps,
        tot: p.tot,
        serie: p.serie,
        volume: p.volume,
        best: p.best,
        media: p.serie ? p.tot / p.serie : 0,
      };
    })
    .sort((a, b) => a.d.localeCompare(b.d));
}

const pct = (a, b) => (a > 0 ? (b / a - 1) * 100 : null);
function trend(v) {
  if (v === null) return '<span class="muted">—</span>';
  const c = v > 1 ? "var(--green)" : v < -1 ? "var(--red)" : "var(--muted)";
  return `<span style="color:${c}">${v > 0 ? "+" : ""}${v.toFixed(1)}%</span>`;
}

function chart(vals, labels, unit, color) {
  if (!vals.length) return "";
  const max = Math.max(...vals), min = Math.min(...vals);
  const span = max - min || max || 1;
  return `<div class="graph">
    <div class="gy"><span>${max.toFixed(unit === "kg" ? 1 : 0)}</span><span>${min.toFixed(unit === "kg" ? 1 : 0)}</span></div>
    <div class="gbars">${vals.map((v, i) => {
      const h = 12 + ((v - min) / span) * 88;
      return `<i style="height:${h}%;background:${color}" title="${labels[i]}: ${v.toFixed(1)}"></i>`;
    }).join("")}</div>
  </div>`;
}

function viewAnalisi() {
  const conDati = DB.esercizi.filter((e) => serie(e.ID).length > 0);
  if (!conDati.length)
    return `<h2>Analisi</h2><div class="empty">Nessun dato dal cambio scheda.<br>
      Registra qualche seduta e qui trovi la progressione esercizio per esercizio.</div>`;

  if (!S.exSel || !conDati.some((e) => e.ID === S.exSel)) S.exSel = conDati[0].ID;
  const ex = DB.esercizi.find((e) => e.ID === S.exSel);
  const g = serie(S.exSel);
  const first = g[0], last = g[g.length - 1];

  const opts = conDati.map((e) =>
    `<option value="${esc(e.ID)}" ${e.ID === S.exSel ? "selected" : ""}>${esc(e.Scheda.split(" ")[0])} · ${esc(e.Esercizio)}</option>`).join("");

  const half = (arr, k) => arr.length >= 4
    ? [(arr[0][k] + arr[1][k]) / 2, (arr[arr.length - 2][k] + arr[arr.length - 1][k]) / 2]
    : [first[k], last[k]];

  const [k0, k1] = half(g, "best");
  const [v0, v1] = half(g, "volume");
  const [c0, c1] = half(g, "kg");

  const top = topReps(ex), bot = botReps(ex), nS = nSerie(ex);
  const inRange = last.reps.filter((r) => r >= bot).length;
  const chiuse = last.reps.filter((r) => top && r >= top).length;
  const topChiuso = last.isTopBo && top && last.tsRep !== null && last.tsRep >= top;

  const volTot = DB.log.filter((r) => String(r.Data).slice(0, 10) >= dataV2())
    .reduce((a, r) => a + parseLogEntry(r.KG, r["Reps fatte"]).volume, 0);
  const quota = volTot > 0 ? (g.reduce((a, x) => a + x.volume, 0) / volTot) * 100 : 0;

  let verdetto, vColor;
  if (topChiuso) {
    verdetto = `Top Set chiuso a ${last.tsRep} reps con ${last.kg} kg. Sali di peso sul Top Set alla prossima seduta: il back-off si aggiornerà in automatico.`;
    vColor = "var(--green)";
  } else if (!last.isTopBo && top && chiuse >= nS) {
    verdetto = `Hai chiuso tutte le serie a ${top}. Sali di peso alla prossima seduta e riparti da ${bot}.`;
    vColor = "var(--green)";
  } else if (g.length < 3) {
    verdetto = `Solo ${g.length} sedut${g.length === 1 ? "a" : "e"}: servono almeno 3 rilevazioni prima di leggerci una tendenza.`;
    vColor = "var(--muted)";
  } else if (pct(k0, k1) > 2) {
    verdetto = `Il massimale stimato sale. È la crescita che cerchi: stai spostando più carico a parità di ripetizioni.`;
    vColor = "var(--green)";
  } else if (pct(v0, v1) > 5 && Math.abs(pct(c0, c1)) < 1) {
    verdetto = `Carico fermo ma volume in salita: stai accumulando ripetizioni. È la fase che precede l'aumento di peso — punta a chiudere il Top Set a ${top}.`;
    vColor = "var(--amber)";
  } else if (pct(v0, v1) < -5) {
    verdetto = `Volume in calo del ${Math.abs(pct(v0, v1)).toFixed(0)}%. Se non è una settimana di scarico, il carico è troppo alto: riadattalo invece di insistere.`;
    vColor = "var(--red)";
  } else {
    let stat = 1;
    for (let i = g.length - 2; i >= 0 && g[i].kg === last.kg; i--) stat++;
    verdetto = stat >= 3
      ? `Fermo a ${last.kg} kg da ${stat} sedute senza guadagnare ripetizioni. Questo esercizio ha smesso di darti stimolo: riadattalo.`
      : `Progressione piatta ma dentro la norma. Tieni il carico e punta a chiudere il Top Set a ${top}.`;
    vColor = stat >= 3 ? "var(--red)" : "var(--muted)";
  }

  const labels = g.map((x) => x.d.slice(5));

  const targetRows = last.isTopBo
    ? `<tr><td>Target</td><td><b>1 TS (${esc(ex["Ripetizioni target"])}) + ${nS - 1} BO (${esc(boRange(ex))})</b></td></tr>
       <tr><td>Top Set</td><td><b style="color:${topChiuso ? "var(--green)" : "inherit"}">${last.tsRep ?? "—"} reps @ ${last.kg} kg</b>${topChiuso ? " — sali di peso" : ""}</td></tr>
       <tr><td>Back-off</td><td><b>${last.boReps.length ? `${last.boReps.join("-")} @ ${fmtKg(last.boKg)} kg` : "—"}</b></td></tr>
       <tr><td>Serie completate</td><td><b>${last.serie} su ${nS}</b></td></tr>
       <tr><td>Quota sul volume totale</td><td><b>${quota.toFixed(1)}%</b></td></tr>`
    : `<tr><td>Target</td><td><b>${nS} × ${esc(ex["Ripetizioni target"])}</b></td></tr>
       <tr><td>Serie completate</td><td><b>${last.serie} su ${nS}</b></td></tr>
       <tr><td>Serie dentro il range</td><td><b>${inRange} su ${last.serie}</b></td></tr>
       <tr><td>Serie chiuse a ${top}</td><td><b style="color:${chiuse === nS ? "var(--green)" : "inherit"}">${chiuse} su ${nS}</b>${chiuse === nS ? " — sali di peso" : ""}</td></tr>
       <tr><td>Reps medie</td><td><b>${last.media.toFixed(1)}</b></td></tr>
       <tr><td>Quota sul volume totale</td><td><b>${quota.toFixed(1)}%</b></td></tr>`;

  return `
  <h2>Analisi</h2>
  <p class="sub">Dal cambio scheda del ${esc(dataV2())} · ${g.length} sedute registrate su questo esercizio</p>

  <select class="f" id="aSel" style="margin-bottom:16px">${opts}</select>

  <div class="stats">
    <div class="stat"><b>${k1.toFixed(1)}</b><span>1RM stimato · ${trend(pct(k0, k1))}</span></div>
    <div class="stat"><b>${Math.round(v1)}</b><span>volume seduta · ${trend(pct(v0, v1))}</span></div>
    <div class="stat"><b>${last.kg}</b><span>carico Top · ${trend(pct(c0, c1))}</span></div>
  </div>

  <div class="card" style="border-left:3px solid ${vColor}">
    <div class="small" style="line-height:1.55">${verdetto}</div>
  </div>

  <div class="card">
    <div class="spread"><b class="gt">Massimale stimato</b><span class="small muted">kg</span></div>
    <p class="small muted" style="margin:2px 0 6px">La forza pura (calcolata su Top Set e Back-off). Se sale, il muscolo sta crescendo.</p>
    ${chart(g.map((x) => x.best), labels, "kg", "var(--green)")}
  </div>

  <div class="card">
    <div class="spread"><b class="gt">Volume per seduta</b><span class="small muted">kg × reps</span></div>
    <p class="small muted" style="margin:2px 0 6px">Il lavoro totale effettivo (Top Set + Back-off). È il driver principale dell'ipertrofia.</p>
    ${chart(g.map((x) => x.volume), labels, "", "var(--blue)")}
  </div>

  <div class="card">
    <div class="spread"><b class="gt">Carico Top Set</b><span class="small muted">kg</span></div>
    <p class="small muted" style="margin:2px 0 6px">Deve salire a gradini, non di continuo.</p>
    ${chart(g.map((x) => x.kg), labels, "kg", "var(--amber)")}
  </div>

  <div class="card">
    <b class="gt">Seduta per seduta</b>
    <table style="margin-top:8px">
      <tr><th>Data</th><th>KG</th><th>Reps</th><th>Vol.</th><th>1RM</th></tr>
      ${[...g].reverse().slice(0, 12).map((x) => `<tr>
        <td>${esc(x.d.slice(5))}</td><td>${x.kg}</td>
        <td>${esc(x.raw)}</td><td>${Math.round(x.volume)}</td>
        <td>${x.best.toFixed(1)}</td></tr>`).join("")}
    </table>
  </div>

  <div class="card">
    <b class="gt">Ultima seduta contro il target</b>
    <table style="margin-top:8px">${targetRows}</table>
  </div>`;
}

/* ---------------- routing ---------------- */
function render() {
  const v = { allenamento: viewAllenamento, debolezze: viewDebolezze, riadatta: viewRiadatta, storico: viewStorico, analisi: viewAnalisi }[S.view];
  $("#main").innerHTML = v();
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.classList.toggle("on", b.dataset.view === S.view));
  bind();
  tickTimers();
}

function bind() {
  document.querySelectorAll("[data-day]").forEach((b) => b.onclick = () => { S.day = b.dataset.day; save(); render(); });

  // Scelta percentuale globale del back-off (-10%, -12.5%, -15%)
  document.querySelectorAll("[data-bopct]").forEach((b) => b.onclick = () => {
    S.boPct = parseFloat(b.dataset.bopct);
    S.boKg = {}; // ricalcola tutti i back-off col nuovo valore
    save();
    render();
  });

  // Toggle per singolo esercizio: Top+BO <-> Fisso
  document.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => {
    const id = b.dataset.mode;
    if (S.mode[id] === "flat") delete S.mode[id];
    else S.mode[id] = "flat";
    save();
    render();
  });

  const tg = $("#tToggle");
  if (tg) tg.onclick = () => {
    if (S.tRun) { S.tAcc += Math.floor(Date.now() / 1000 - S.tStart); S.tRun = false; }
    else { S.tStart = Date.now() / 1000; S.tRun = true; }
    save(); render();
  };
  const tr = $("#tReset");
  if (tr) tr.onclick = () => { S.tAcc = 0; S.tRun = false; S.tStart = 0; save(); render(); };

  document.querySelectorAll("[data-set]").forEach((b) => b.onclick = () => {
    const k = b.dataset.set; S.sets[k] = !S.sets[k]; save(); render();
  });

  document.querySelectorAll("[data-rep]").forEach((i) => i.oninput = () => {
    const v = parseInt(i.value);
    if (isNaN(v) || v <= 0) delete S.reps[i.dataset.rep];
    else S.reps[i.dataset.rep] = v;
    save();
  });

  // Top Set KG: aggiorna LIVE il campo Back-off senza ridisegnare la card (non perdi il cursore)
  document.querySelectorAll("[data-kg]").forEach((i) => {
    const id = i.dataset.kg;
    i.oninput = () => {
      const val = num(i.value);
      S.kg[id] = val;
      delete S.boKg[id]; // ricalcola il back-off automaticamente
      const boInput = document.querySelector(`[data-bokg="${CSS.escape(id)}"]`);
      const boHint = document.querySelector(`[data-bohint="${CSS.escape(id)}"]`);
      if (boInput) {
        const newBo = calcBackoff(val, S.boPct, S.boStep);
        boInput.value = newBo;
        const box = boInput.closest(".bo-box");
        if (box) box.classList.remove("manual");
        if (boHint) {
          const diff = Math.round((val - newBo) * 100) / 100;
          boHint.textContent = val > 0 ? `BACK-OFF · −${fmtKg(diff)} kg (auto)` : "BACK-OFF (KG)";
        }
      }
      save();
    };
    i.onchange = () => {
      S.kg[id] = num(i.value);
      delete S.boKg[id];
      save();
      render();
    };
  });

  // Back-off KG: modificabile manualmente se una macchina ha un pacco pesi particolare
  document.querySelectorAll("[data-bokg]").forEach((i) => {
    const id = i.dataset.bokg;
    i.oninput = () => {
      const val = num(i.value);
      S.boKg[id] = val;
      const topInput = document.querySelector(`[data-kg="${CSS.escape(id)}"]`);
      const topVal = topInput ? num(topInput.value) : 0;
      const autoVal = calcBackoff(topVal, S.boPct, S.boStep);
      const boHint = document.querySelector(`[data-bohint="${CSS.escape(id)}"]`);
      const box = i.closest(".bo-box");
      const isManual = Math.abs(val - autoVal) > 1e-9;
      if (box) box.classList.toggle("manual", isManual);
      if (boHint) {
        const diff = Math.round((topVal - val) * 100) / 100;
        boHint.textContent = isManual
          ? `BACK-OFF · manuale (auto ${fmtKg(autoVal)})`
          : `BACK-OFF · −${fmtKg(diff)} kg (auto)`;
      }
      save();
    };
  });

  document.querySelectorAll("[data-rest]").forEach((b) => b.onclick = () => {
    const id = b.dataset.rest;
    unlockAudio();
    if (alarmId === id) { stopAlarm(); delete S.rest[id]; save(); return tickTimers(); }
    if (S.rest[id] && S.rest[id] > Date.now()) delete S.rest[id];
    else S.rest[id] = Date.now() + (+b.dataset.secs) * 1000;
    save(); tickTimers();
  });

  const rpe = $("#fRpe");
  if (rpe) rpe.oninput = () => { S.rpe = +rpe.value; $("#fRpeV").textContent = rpe.value; save(); };
  ["fSonno:sonno", "fStress:stress", "fNote:note"].forEach((p) => {
    const [el, key] = p.split(":"); const n = $("#" + el);
    if (n) n.onchange = () => { S[key] = n.value; save(); };
  });

  const bs = $("#btnSave"); if (bs) bs.onclick = saveWorkout;
  const bc = $("#btnClear"); if (bc) bc.onclick = () => {
    if (!confirm("Svuoto serie, ripetizioni e cronometro di questa seduta?")) return;
    S.sets = {}; S.reps = {}; S.kg = {}; S.boKg = {}; S.note = ""; S.tAcc = 0; S.tRun = false; S.rest = {};
    save(); render();
  };

  const as = $("#aSel"); if (as) as.onchange = () => { S.exSel = as.value; save(); render(); };

  const br = $("#btnRiad"); if (br) br.onclick = saveRiadattamento;
  const bd = $("#btnDeload"); if (bd) bd.onclick = saveDeload;
}

/* ---------------- timer ---------------- */
function tickTimers() {
  const el = $("#globalTimer");
  const t = S.tAcc + (S.tRun ? Math.floor(Date.now() / 1000 - S.tStart) : 0);
  el.textContent = hhmmss(Math.max(0, t));
  el.classList.toggle("idle", !S.tRun);

  document.querySelectorAll("[data-rest]").forEach((b) => {
    const end = S.rest[b.dataset.rest];
    const isWide = b.classList.contains("wide");
    b.className = isWide ? "rest wide" : "rest";
    if (!end) { b.innerHTML = `<b>${b.dataset.secs}s</b><small>recupero</small>`; return; }
    const left = Math.round((end - Date.now()) / 1000);
    if (left > 0) { b.classList.add("run"); b.innerHTML = `<b>${left}s</b><small>tocca per fermare</small>`; }
    else {
      b.classList.add("ring"); b.innerHTML = `<b>vai</b><small>recupero finito</small>`;
      startAlarm(b.dataset.rest);
    }
  });
}
setInterval(tickTimers, 1000);

let alarmId = null, alarmTimer = null, alarmStop = null;

function startAlarm(id) {
  if (alarmId === id) return;
  stopAlarm();
  alarmId = id;
  beep();
  alarmTimer = setInterval(beep, 2500);
  alarmStop = setTimeout(stopAlarm, 120000);
}
function unlockAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch (e) { }
}
document.addEventListener("pointerdown", unlockAudio, { once: true });
document.addEventListener("pointerdown", () => { if (alarmId) stopAlarm(); });

function stopAlarm() {
  clearInterval(alarmTimer); clearTimeout(alarmStop);
  alarmTimer = alarmStop = alarmId = null;
  if (navigator.vibrate) navigator.vibrate(0);
}

let ctx;
function beep() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    [0, 0.22, 0.44, 0.66, 0.88].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.001;
      o.start(ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.16);
      o.stop(ctx.currentTime + t + 0.18);
    });
    if (navigator.vibrate) navigator.vibrate([160, 70, 160, 70, 160, 70, 300]);
  } catch (e) { }
}

/* ---------------- salvataggi ---------------- */
async function post(payload) {
  const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Errore di salvataggio");
  return d;
}

async function saveWorkout() {
  const list = DB.esercizi.filter((e) => e.Scheda === S.day);
  const oggi = new Date().toISOString().slice(0, 10);
  const sid = "SESS-" + new Date().toISOString().replace(/\D/g, "").slice(0, 14);

  const righe = [];
  list.forEach((ex) => {
    const n = nSerie(ex);
    const base = baseline(ex.ID);
    const kg = S.kg[ex.ID] !== undefined ? S.kg[ex.ID] : (base ? base.kg : 0);

    if (isTopBo(ex)) {
      const tsOn = !!S.sets[`${ex.ID}:1`];
      const tsRep = tsOn ? repsFor(ex, 0, base) : null;
      const boReps = [];
      for (let i = 1; i < n; i++) {
        if (S.sets[`${ex.ID}:${i + 1}`]) boReps.push(repsFor(ex, i, base));
      }
      const totSerie = (tsOn ? 1 : 0) + boReps.length;
      if (!totSerie) return;

      const boVal = currentBoKg(ex.ID, kg);
      let repsStr;
      if (tsOn && boReps.length) repsStr = `${tsRep} | ${boReps.join("-")} @${fmtKg(boVal)}`;
      else if (tsOn) repsStr = `${tsRep} |`;
      else repsStr = `| ${boReps.join("-")} @${fmtKg(boVal)}`;

      righe.push(["LOG-" + Math.random().toString(16).slice(2, 10), oggi, sid, ex.ID, kg, repsStr, totSerie]);
    } else {
      const reps = [];
      for (let i = 0; i < n; i++)
        if (S.sets[`${ex.ID}:${i + 1}`]) reps.push(repsFor(ex, i, base));
      if (!reps.length) return;
      righe.push(["LOG-" + Math.random().toString(16).slice(2, 10), oggi, sid, ex.ID, kg, reps.join("-"), reps.length]);
    }
  });

  if (!righe.length) return toast("Spunta almeno una serie prima di salvare.", true);

  const t = S.tAcc + (S.tRun ? Math.floor(Date.now() / 1000 - S.tStart) : 0);
  const btn = $("#btnSave"); btn.disabled = true; btn.textContent = "Salvo…";
  try {
    await post({
      action: "saveWorkout",
      sessione: [sid, oggi, S.day, S.rpe, S.sonno, S.stress, S.note, hhmmss(t)],
      righe,
    });
    S.sets = {}; S.reps = {}; S.kg = {}; S.boKg = {}; S.note = ""; S.tAcc = 0; S.tRun = false; S.tStart = 0; S.rest = {};
    save();
    toast(`Salvato — ${righe.length} esercizi, durata ${hhmmss(t)}`);
    await boot();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    toast(e.message, true); btn.disabled = false; btn.textContent = "Salva allenamento";
  }
}

async function saveRiadattamento() {
  const id = $("#rEx").value, kg = num($("#rKg").value);
  const serie = parseInt($("#rSerie").value) || 3, reps = parseInt($("#rReps").value) || 10;
  const btn = $("#btnRiad"); btn.disabled = true; btn.textContent = "Salvo…";
  try {
    await post({
      action: "addEvent",
      riga: ["EVT-" + Math.random().toString(16).slice(2, 10), "RIADATTAMENTO",
        new Date().toISOString().slice(0, 10), "", id, kg,
        Array(serie).fill(reps).join("-"), $("#rNota").value],
    });
    toast("Riadattamento salvato."); await boot();
  } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = "Salva riadattamento"; }
}

async function saveDeload() {
  const a = $("#dStart").value, b = $("#dEnd").value;
  if (!a || !b) return toast("Scegli le due date.", true);
  const btn = $("#btnDeload"); btn.disabled = true; btn.textContent = "Salvo…";
  try {
    await post({
      action: "addEvent",
      riga: ["EVT-" + Math.random().toString(16).slice(2, 10), "DELOAD", a, b, "", "", "", "Scarico"],
    });
    toast("Scarico registrato."); await boot();
  } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = "Registra scarico"; }
}


/* ---------------- tastierino di accesso ---------------- */
const PIN = "134679";
const PIN_OK = "refood.pin.ok";

function lock(then) {
  if (localStorage.getItem(PIN_OK) === PIN) return then();

  const el = document.createElement("div");
  el.className = "lock";
  el.innerHTML = `
    <div class="lockbox">
      <div class="lockmark"></div>
      <h1>Refood Training</h1>
      <p id="lockMsg">Inserisci il codice</p>
      <div class="dots" id="dots">${"<i></i>".repeat(6)}</div>
      <div class="pad">
        ${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-n="${n}">${n}</button>`).join("")}
        <button data-act="del">&#9003;</button>
        <button data-n="0">0</button>
        <button data-act="clr">C</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  let buf = "";
  const dots = () => el.querySelectorAll("#dots i")
    .forEach((d, i) => d.classList.toggle("on", i < buf.length));

  function press(n) {
    if (buf.length >= 6) return;
    buf += n; dots();
    if (buf.length === 6) setTimeout(check, 120);
  }
  function check() {
    if (buf === PIN) {
      localStorage.setItem(PIN_OK, PIN);
      el.classList.add("open");
      setTimeout(() => { el.remove(); then(); }, 240);
    } else {
      const box = el.querySelector(".lockbox");
      box.classList.add("no");
      el.querySelector("#lockMsg").textContent = "Codice errato";
      if (navigator.vibrate) navigator.vibrate([90, 60, 90]);
      setTimeout(() => { box.classList.remove("no"); buf = ""; dots(); }, 420);
    }
  }

  el.querySelectorAll("[data-n]").forEach((b) =>
    b.onclick = () => press(b.dataset.n));
  el.querySelector('[data-act="del"]').onclick = () => { buf = buf.slice(0, -1); dots(); };
  el.querySelector('[data-act="clr"]').onclick = () => { buf = ""; dots(); };

  document.addEventListener("keydown", function onKey(e) {
    if (!document.body.contains(el)) return document.removeEventListener("keydown", onKey);
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") { buf = buf.slice(0, -1); dots(); }
  });
}

/* ---------------- avvio ---------------- */
async function boot() {
  try {
    const r = await fetch(API);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Non riesco a leggere il foglio");
    Object.assign(DB, d);
    render();
  } catch (e) {
    $("#main").innerHTML = `<div class="banner"><b>Il foglio non risponde.</b><br>${esc(e.message)}
      <br><br>Controlla le variabili d'ambiente su Vercel e che il foglio sia condiviso con l'indirizzo del service account.</div>`;
  }
}

document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
window.addEventListener("pagehide", save);

document.querySelectorAll("#tabs button").forEach((b) =>
  b.onclick = () => { S.view = b.dataset.view; save(); render(); });

load();
lock(boot);
