/* Refood Training — client
   Stato salvato in localStorage: chiudere il browser non perde nulla. */

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
  reps: {},      // "A-01:1" -> 8
  kg: {},        // "A-01"   -> 13.75
  rpe: 7, sonno: "Buono", stress: "Medio", note: "",
  tStart: 0, tAcc: 0, tRun: false,
  rest: {},      // "A-01"   -> timestamp fine
};

/* ---------------- persistenza ---------------- */
const save = () => localStorage.setItem(LS, JSON.stringify(S));
function load() {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return;
    const p = JSON.parse(raw);
    // scarta una sessione lasciata aperta da più di 12 ore
    if (p.tStart && Date.now() / 1000 - p.tStart > 43200) return localStorage.removeItem(LS);
    S = { ...S, ...p };
  } catch (e) { localStorage.removeItem(LS); }
}

/* ---------------- utilità ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
const nSerie = (e) => Math.max(1, parseInt(String(e["Serie target"]).split("-").pop()) || 4);

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
function secs(t) {
  t = String(t || "").trim();
  const m = t.match(/(\d+)\s*'/), s = t.match(/'\s*(\d+)/);
  if (m) return (+m[1]) * 60 + (s ? +s[1] : 0);
  const n = parseInt(t); return isNaN(n) ? 90 : n;
}
const hhmmss = (t) => [Math.floor(t / 3600), Math.floor(t % 3600 / 60), t % 60]
  .map((x) => String(x).padStart(2, "0")).join(":");
const repsSum = (r) => String(r || "").split("-").reduce((a, x) => a + (parseInt(x) || 0), 0);

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
  return { kg: num(r.KG), reps: r["Reps fatte"], data: r.Data };
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
  if (r && (!p || String(r.Data_inizio).slice(0, 10) >= String(p.data).slice(0, 10)))
    return { kg: num(r.KG), reps: r.Reps, data: String(r.Data_inizio).slice(0, 10), reset: true, note: r.Note };
  return p ? { ...p, reset: false } : null;
}
// Ripetizioni della serie i (0-based): quello che vedi è quello che viene salvato.
// Se non hai toccato il campo, vale il valore mostrato — mai zero.
function repsFor(ex, i, base) {
  const k = `${ex.ID}:${i + 1}`;
  if (S.reps[k] !== undefined && S.reps[k] !== null && S.reps[k] !== "") return S.reps[k];
  const prev = base
    ? String(base.reps).split("-").map((x) => parseInt(x)).filter((x) => !isNaN(x))
    : [];
  return prev[i] ?? prev[prev.length - 1] ?? botReps(ex);
}

// regola nuova: si sale solo con TUTTE le serie al massimo del range
function shouldIncrease(ex, base) {
  if (!base || base.reset) return false;
  const top = topReps(ex); if (!top) return false;
  const parts = String(base.reps).split("-").map((x) => parseInt(x)).filter((x) => !isNaN(x));
  if (parts.length < nSerie(ex)) return false;
  return parts.every((r) => r >= top);
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

  return `
  <div class="days">${days}</div>
  <h2>${esc(title)}</h2>
  <p class="sub">${list.length} esercizi · ${list.reduce((a, e) => a + nSerie(e), 0)} serie totali</p>
  <div class="timerbar">
    <button id="tToggle" class="${S.tRun ? "" : "go"}">${S.tRun ? "Metti in pausa" : "Avvia allenamento"}</button>
    <button id="tReset">Azzera</button>
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
  const up = shouldIncrease(ex, base);
  const def = base ? base.kg : 0;
  const kg = S.kg[id] !== undefined ? S.kg[id] : def;
  const changed = Math.abs(num(kg) - num(def)) > 1e-9;

  let done = 0;
  const sets = Array.from({ length: n }, (_, i) => {
    const k = `${id}:${i + 1}`, on = !!S.sets[k];
    if (on) done++;
    const prev = base ? String(base.reps).split("-").map((x) => parseInt(x)).filter((x) => !isNaN(x)) : [];
    const dflt = repsFor(ex, i, base);
    return `<div class="set ${on ? "on" : ""}">
      <label>Serie ${i + 1}</label>
      <input type="number" inputmode="numeric" value="${dflt}" data-rep="${k}">
      <button class="chk" data-set="${k}">${on ? "✓" : "○"}</button>
    </div>`;
  }).join("");

  let prevLine;
  if (base && base.reset)
    prevLine = `<div class="prev warn">Riadattamento del ${esc(base.data)} — riparti da ${base.kg} kg · ${esc(base.reps)}${base.note ? ` · ${esc(base.note)}` : ""}</div>`;
  else if (base)
    prevLine = `<div class="prev">Ultima volta (${esc(base.data)}): ${base.kg} kg · ${esc(base.reps)}</div>`;
  else prevLine = `<div class="prev none">Mai registrato — trova il carico oggi</div>`;

  const top = topReps(ex);
  const kgCls = base && base.reset ? "reset" : (up && !changed ? "up" : "");
  const kgLbl = base && base.reset ? "KG — riparti da qui"
    : (up && !changed ? `KG — sali, hai chiuso tutte le serie a ${top}` : "KG");

  const target = [`${ex["Serie target"]}×${ex["Ripetizioni target"]}`,
    ex.Recupero ? `rec ${ex.Recupero}` : ""].filter(Boolean).join(" · ");

  return `
  <div class="ex ${done === n ? "done" : ""} ${base && base.reset ? "reset" : ""}" data-ex="${esc(id)}">
    <div class="ex-head">
      <div>
        <div class="ex-num">${ex.Ordine}</div>
        <div class="ex-name">${esc(ex.Esercizio)}</div>
      </div>
      ${done === n ? '<div class="tick">✓</div>' : done ? `<div class="ex-num">${done}/${n}</div>` : ""}
    </div>
    <div class="ex-target">${esc(target)}</div>
    ${prevLine}
    ${ex["Note tecnica"] ? `<details class="tech"><summary>Note tecnica</summary><p>${esc(ex["Note tecnica"])}</p></details>` : ""}
    <div class="sets">${sets}</div>
    <div class="foot">
      <div class="kg ${kgCls}">
        <span>${esc(kgLbl)}</span>
        <input type="number" step="0.25" inputmode="decimal" value="${kg}" data-kg="${esc(id)}">
      </div>
      <button class="rest" data-rest="${esc(id)}" data-secs="${secs(ex.Recupero)}">
        <b>${secs(ex.Recupero)}s</b><small>recupero</small>
      </button>
    </div>
  </div>`;
}

/* ---------------- render: debolezze ---------------- */
function analisi() {
  const byId = {};
  DB.log.forEach((r) => {
    const d = String(r.Data).slice(0, 10);
    (byId[r.Esercizio] ||= []).push({ d, kg: num(r.KG), reps: r["Reps fatte"], vol: num(r.KG) * repsSum(r["Reps fatte"]) });
  });
  const attivi = new Set(DB.esercizi.map((e) => e.ID));
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
  <p class="sub">Confronto il volume delle ultime due sedute con le due precedenti. In calo sotto il −5%, fermo se stesso carico da 3 sedute.</p>
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
  <p class="sub">Azzera la progressione di un esercizio: la prossima seduta parte da questi valori invece che dall'ultima performance.</p>
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

// Epley: stima del massimale da una serie. Serie sotto le 12 reps, oltre perde precisione.
const e1rm = (kg, reps) => (reps > 0 && reps <= 12) ? kg * (1 + reps / 30) : kg;

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
      const kg = num(r.KG);
      const reps = String(r["Reps fatte"]).split("-").map((x) => parseInt(x)).filter((x) => !isNaN(x));
      const tot = reps.reduce((a, b) => a + b, 0);
      return {
        d: String(r.Data).slice(0, 10),
        kg, reps, tot,
        serie: reps.length,
        volume: kg * tot,
        best: Math.max(...reps.map((x) => e1rm(kg, x)), 0),
        media: reps.length ? tot / reps.length : 0,
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

  // confronto: prime due sedute contro ultime due (più stabile del singolo dato)
  const half = (arr, k) => arr.length >= 4
    ? [(arr[0][k] + arr[1][k]) / 2, (arr[arr.length - 2][k] + arr[arr.length - 1][k]) / 2]
    : [first[k], last[k]];

  const [k0, k1] = half(g, "best");
  const [v0, v1] = half(g, "volume");
  const [c0, c1] = half(g, "kg");

  const top = topReps(ex), bot = botReps(ex), nS = nSerie(ex);
  const inRange = last.reps.filter((r) => r >= bot).length;
  const chiuse = last.reps.filter((r) => r >= top).length;

  // Quanto pesa questo esercizio sul carico settimanale
  const volTot = DB.log.filter((r) => String(r.Data).slice(0, 10) >= dataV2())
    .reduce((a, r) => a + num(r.KG) * repsSum(r["Reps fatte"]), 0);
  const quota = volTot > 0 ? (g.reduce((a, x) => a + x.volume, 0) / volTot) * 100 : 0;

  // Giudizio: che cosa dice davvero questa serie di numeri
  let verdetto, vColor;
  if (chiuse >= nS) {
    verdetto = `Hai chiuso tutte le serie a ${top}. Sali di peso alla prossima seduta e riparti da ${bot}.`;
    vColor = "var(--green)";
  } else if (g.length < 3) {
    verdetto = `Solo ${g.length} sedut${g.length === 1 ? "a" : "e"}: servono almeno 3 rilevazioni prima di leggerci una tendenza.`;
    vColor = "var(--muted)";
  } else if (pct(k0, k1) > 2) {
    verdetto = `Il massimale stimato sale. È la crescita che cerchi: stai spostando più carico a parità di ripetizioni.`;
    vColor = "var(--green)";
  } else if (pct(v0, v1) > 5 && Math.abs(pct(c0, c1)) < 1) {
    verdetto = `Carico fermo ma volume in salita: stai accumulando ripetizioni. È la fase che precede l'aumento di peso — continua fino a chiudere tutte le serie a ${top}.`;
    vColor = "var(--amber)";
  } else if (pct(v0, v1) < -5) {
    verdetto = `Volume in calo del ${Math.abs(pct(v0, v1)).toFixed(0)}%. Se non è una settimana di scarico, il carico è troppo alto: riadattalo invece di insistere.`;
    vColor = "var(--red)";
  } else {
    let stat = 1;
    for (let i = g.length - 2; i >= 0 && g[i].kg === last.kg; i--) stat++;
    verdetto = stat >= 3
      ? `Fermo a ${last.kg} kg da ${stat} sedute senza guadagnare ripetizioni. Questo esercizio ha smesso di darti stimolo: riadattalo.`
      : `Progressione piatta ma dentro la norma. Tieni il carico e punta a chiudere tutte le serie a ${top}.`;
    vColor = stat >= 3 ? "var(--red)" : "var(--muted)";
  }

  const labels = g.map((x) => x.d.slice(5));

  return `
  <h2>Analisi</h2>
  <p class="sub">Dal cambio scheda del ${esc(dataV2())} · ${g.length} sedute registrate su questo esercizio</p>

  <select class="f" id="aSel" style="margin-bottom:16px">${opts}</select>

  <div class="stats">
    <div class="stat"><b>${k1.toFixed(1)}</b><span>1RM stimato · ${trend(pct(k0, k1))}</span></div>
    <div class="stat"><b>${Math.round(v1)}</b><span>volume seduta · ${trend(pct(v0, v1))}</span></div>
    <div class="stat"><b>${last.kg}</b><span>carico kg · ${trend(pct(c0, c1))}</span></div>
  </div>

  <div class="card" style="border-left:3px solid ${vColor}">
    <div class="small" style="line-height:1.55">${verdetto}</div>
  </div>

  <div class="card">
    <div class="spread"><b class="gt">Massimale stimato</b><span class="small muted">kg</span></div>
    <p class="small muted" style="margin:2px 0 6px">La forza pura. Se sale, il muscolo sta crescendo.</p>
    ${chart(g.map((x) => x.best), labels, "kg", "var(--green)")}
  </div>

  <div class="card">
    <div class="spread"><b class="gt">Volume per seduta</b><span class="small muted">kg × reps</span></div>
    <p class="small muted" style="margin:2px 0 6px">Il lavoro totale. È il driver principale dell'ipertrofia.</p>
    ${chart(g.map((x) => x.volume), labels, "", "var(--blue)")}
  </div>

  <div class="card">
    <div class="spread"><b class="gt">Carico usato</b><span class="small muted">kg</span></div>
    <p class="small muted" style="margin:2px 0 6px">Deve salire a gradini, non di continuo.</p>
    ${chart(g.map((x) => x.kg), labels, "kg", "var(--amber)")}
  </div>

  <div class="card">
    <b class="gt">Seduta per seduta</b>
    <table style="margin-top:8px">
      <tr><th>Data</th><th>KG</th><th>Reps</th><th>Vol.</th><th>1RM</th></tr>
      ${[...g].reverse().slice(0, 12).map((x) => `<tr>
        <td>${esc(x.d.slice(5))}</td><td>${x.kg}</td>
        <td>${x.reps.join("-")}</td><td>${Math.round(x.volume)}</td>
        <td>${x.best.toFixed(1)}</td></tr>`).join("")}
    </table>
  </div>

  <div class="card">
    <b class="gt">Ultima seduta contro il target</b>
    <table style="margin-top:8px">
      <tr><td>Target</td><td><b>${nS} × ${esc(ex["Ripetizioni target"])}</b></td></tr>
      <tr><td>Serie completate</td><td><b>${last.serie} su ${nS}</b></td></tr>
      <tr><td>Serie dentro il range</td><td><b>${inRange} su ${last.serie}</b></td></tr>
      <tr><td>Serie chiuse a ${top}</td><td><b style="color:${chiuse === nS ? "var(--green)" : "inherit"}">${chiuse} su ${nS}</b>${chiuse === nS ? " — sali di peso" : ""}</td></tr>
      <tr><td>Reps medie</td><td><b>${last.media.toFixed(1)}</b></td></tr>
      <tr><td>Quota sul volume totale</td><td><b>${quota.toFixed(1)}%</b></td></tr>
    </table>
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
  document.querySelectorAll("[data-rep]").forEach((i) => i.onchange = () => {
    const v = parseInt(i.value);
    if (isNaN(v) || v <= 0) delete S.reps[i.dataset.rep];
    else S.reps[i.dataset.rep] = v;
    save();
  });
  document.querySelectorAll("[data-kg]").forEach((i) => i.onchange = () => {
    S.kg[i.dataset.kg] = num(i.value); save(); render();
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
    S.sets = {}; S.reps = {}; S.kg = {}; S.note = ""; S.tAcc = 0; S.tRun = false; S.rest = {};
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
    b.className = "rest";
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

/* La suoneria insiste: se sei distratto te ne accorgi comunque.
   Si ferma toccando il timer, o da sola dopo 2 minuti. */
let alarmId = null, alarmTimer = null, alarmStop = null;

function startAlarm(id) {
  if (alarmId === id) return;
  stopAlarm();
  alarmId = id;
  beep();
  alarmTimer = setInterval(beep, 2500);
  alarmStop = setTimeout(stopAlarm, 120000);
}
// iOS e Android bloccano l'audio finché non c'è stato un tocco: lo sblocchiamo al primo.
function unlockAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch (e) { }
}
document.addEventListener("pointerdown", unlockAudio, { once: true });
// Un tocco qualsiasi mentre suona la spegne.
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
    const n = nSerie(ex), reps = [];
    const base = baseline(ex.ID);
    for (let i = 0; i < n; i++)
      if (S.sets[`${ex.ID}:${i + 1}`]) reps.push(repsFor(ex, i, base));
    if (!reps.length) return;
    const kg = S.kg[ex.ID] !== undefined ? S.kg[ex.ID] : (base ? base.kg : 0);
    righe.push(["LOG-" + Math.random().toString(16).slice(2, 10), oggi, sid, ex.ID, kg, reps.join("-"), reps.length]);
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
    S.sets = {}; S.reps = {}; S.kg = {}; S.note = ""; S.tAcc = 0; S.tRun = false; S.tStart = 0; S.rest = {};
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
      <br><br>Controlla le variabili su Netlify e che il foglio sia condiviso con l'indirizzo del service account.</div>`;
  }
}

document.querySelectorAll("#tabs button").forEach((b) =>
  b.onclick = () => { S.view = b.dataset.view; save(); render(); });

load();
boot();
