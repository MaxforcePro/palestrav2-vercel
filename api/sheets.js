// Ponte sicuro tra il browser e Google Sheets.
// Le credenziali restano qui, lato server: il browser non le vede mai.
//
// Variabili d'ambiente richieste su Vercel:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY          (con \n al posto degli a-capo)
//   SPREADSHEET_ID

const { google } = require("googleapis");

const TABS = {
  esercizi: "Esercizi_v2",
  sessioni: "Sessioni_v2",
  log: "Log_v2",
  eventi: "Eventi_v2",
};

function auth() {
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// Su Vercel si risponde tramite l'oggetto res, che va passato ogni volta:
// tenerlo in una variabile globale romperebbe due richieste simultanee.
const reply = (res) => (statusCode, body) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(statusCode).json(body);
};

// Converte una griglia di valori in array di oggetti usando la prima riga come intestazioni
function toObjects(values) {
  if (!values || values.length < 2) return [];
  const [head, ...rows] = values;
  return rows
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

module.exports = async (req, res) => {
  const json = reply(res);
  const missing = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "SPREADSHEET_ID"]
    .filter((k) => !process.env[k]);
  if (missing.length) {
    return json(500, { error: `Variabili d'ambiente mancanti: ${missing.join(", ")}` });
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;

  try {
    const sheets = google.sheets({ version: "v4", auth: auth() });

    // ---------- LETTURA: tutto in una chiamata sola ----------
    if (req.method === "GET") {
      const res = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: Object.values(TABS).map((t) => `${t}!A1:Z2000`),
      });
      const [esercizi, sessioni, log, eventi] = res.data.valueRanges.map((v) =>
        toObjects(v.values)
      );
      return json(200, { esercizi, sessioni, log, eventi });
    }

    // ---------- SCRITTURA ----------
    if (req.method === "POST") {
      // Vercel fa gia il parsing del JSON in ingresso
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { action } = body;

      if (action === "saveWorkout") {
        const { sessione, righe } = body;
        if (!sessione || !Array.isArray(righe) || !righe.length) {
          return json(400, { error: "Servono una sessione e almeno una riga di log." });
        }
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${TABS.sessioni}!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [sessione] },
        });
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${TABS.log}!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: righe },
        });
        return json(200, { ok: true, salvate: righe.length });
      }

      if (action === "addEvent") {
        const { riga } = body;
        if (!riga) return json(400, { error: "Manca la riga evento." });
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${TABS.eventi}!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [riga] },
        });
        return json(200, { ok: true });
      }

      return json(400, { error: `Azione non riconosciuta: ${action}` });
    }

    return json(405, { error: "Metodo non consentito." });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message || "Errore nella connessione al foglio." });
  }
};
