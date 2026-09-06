# Refood Training v2

App di allenamento collegata al tuo Google Sheet, pensata per girare su Netlify.
Le credenziali stanno nelle **Netlify Functions**: il browser non le vede mai.

```
public/                 il sito (index.html, style.css, app.js)
netlify/functions/      sheets.js — il ponte verso Google Sheets
netlify.toml            configurazione di build
package.json            dipendenza googleapis
```

## 1. Prepara il foglio Google

Apri `Palestra_APP_v2.xlsx` e copia le sue tab dentro il tuo foglio esistente:
`Esercizi_v2`, `Sessioni_v2`, `Log_v2`, `Eventi_v2`.
(`Carichi_Partenza_v2` è solo di consultazione, l'app non la legge.)

Il modo più rapido: apri il file in Google Sheets, poi su ogni tab tasto destro →
*Copia in* → scegli il tuo foglio. Controlla che i nomi restino identici, senza spazi.

Le tab vecchie restano dove sono e non vengono più toccate: l'app v2 legge e scrive
soltanto quelle con il suffisso `_v2`.

## 2. Metti il progetto su GitHub

Carica questa cartella in un repository nuovo.

## 3. Collega Netlify

Su Netlify: *Add new site* → *Import an existing project* → scegli il repo.
La configurazione di build viene già letta da `netlify.toml`, non devi toccare nulla.

## 4. Aggiungi le variabili d'ambiente

*Site configuration* → *Environment variables* → aggiungi:

| Variabile | Valore |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | l'email del service account (finisce in `.iam.gserviceaccount.com`) |
| `GOOGLE_PRIVATE_KEY` | la private key del JSON, per intero, **con `\n` al posto degli a-capo** |
| `SPREADSHEET_ID` | l'ID nell'URL del foglio, tra `/d/` e `/edit` |

Sono le stesse credenziali che usavi su Streamlit: le trovi nel JSON del service account.

## 5. Condividi il foglio

Nel foglio Google, *Condividi* → aggiungi l'email del service account come **Editor**.
Senza questo passaggio l'app legge un foglio vuoto.

Poi *Deploy site*. Al primo caricamento vedrai i 28 esercizi della scheda v2.

## Come funziona

**Allenamento** — scegli il giorno, avvia il cronometro, spunta le serie. Il peso è
precompilato con l'ultima performance e vale per tutte le serie, ma ogni serie ha il
suo campo ripetizioni modificabile.

**Il badge verde sui KG** compare solo quando hai chiuso *tutte* le serie al massimo
del range (7-7-7-7 sui fondamentali, il top del range sugli isolamenti). Appena
modifichi il peso, sparisce.

**Debolezze** — confronta il volume delle ultime due sedute con le due precedenti.
Rosso sotto il −5%, giallo se stesso carico da tre sedute senza crescita.

**Riadatta** — azzera un esercizio: la seduta successiva parte dai valori che imposti,
ignorando l'ultima performance. Serve anche a registrare le settimane di scarico.

Tutto quello che compili resta in `localStorage`: se il browser si chiude a metà
allenamento, riaprendo trovi la seduta dov'era. I dati scadono dopo 12 ore.
