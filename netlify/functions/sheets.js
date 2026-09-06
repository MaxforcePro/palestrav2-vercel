// Ponte sicuro tra il browser e Google Sheets.
// Le credenziali restano qui, lato server: il browser non le vede mai.
//
// Variabili d'ambiente richieste su Netlify:
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

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

// Converte una griglia di valori in array di oggetti usando la prima riga come intestazioni
function toObjects(values) {
  if (!values || values.length < 2) return [];
  const [head, ...rows] = values;
  return rows
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

exports.handler = async (event) => {
  const missing = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "SPREADSHEET_ID"]
    .filter((k) => !process.env[k]);
  if (missing.length) {
    return json(500, { error: `Variabili d'ambiente mancanti: ${missing.join(", ")}` });
  }

  const spreadsheetId = process.env.SPREADSHEET_ID;

  try {
    const sheets = google.sheets({ version: "v4", auth: auth() });

    // ---------- LETTURA: tutto in una chiamata sola ----------
    if (event.httpMethod === "GET") {
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
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
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
