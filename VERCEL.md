# Passare da Netlify a Vercel

Il progetto ora gira su entrambe le piattaforme. Netlify resta attivo mentre migri:
se qualcosa non va su Vercel, continui ad allenarti sul link vecchio.

L'app capisce da sola dove si trova e chiama l'indirizzo giusto — nessuna riga da toccare.

```
api/sheets.js               il ponte per Vercel
netlify/functions/sheets.js il ponte per Netlify (lascialo, non dà fastidio)
vercel.json                 configurazione Vercel
netlify.toml                configurazione Netlify
public/                     il sito, identico per entrambe
```

---

## 1. Pusha il codice su GitHub

Sostituisci i file nel repo con quelli aggiornati e fai push. Netlify si ridepolia
da solo come sempre: il link attuale continua a funzionare.

## 2. Crea l'account Vercel

Vai su **vercel.com** → *Sign Up* → scegli **Continue with GitHub**.
Usa lo stesso account GitHub dove sta il repo, così Vercel lo vede subito.

Quando ti chiede il piano scegli **Hobby**: è quello gratuito e non chiede carta.

## 3. Importa il repository

Dalla dashboard: **Add New** → **Project**.
Trovi la lista dei tuoi repo GitHub — accanto a quello dell'app premi **Import**.

Se il repo non compare, premi *Adjust GitHub App Permissions* e dai a Vercel
l'accesso a quel repository.

## 4. Lascia stare le impostazioni di build

Nella schermata di configurazione Vercel mostra *Framework Preset*, *Build Command*,
*Output Directory*. **Non toccare niente**: il progetto non ha un build da eseguire,
i file in `public/` vengono serviti così come sono e la cartella `api/` diventa
automaticamente la funzione serverless.

## 5. Aggiungi le variabili d'ambiente

Nella stessa schermata apri la sezione **Environment Variables** e inserisci le tre
che hai già su Netlify, identiche:

| Nome | Valore |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `palestra-app@...iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | la chiave intera, con i `\n` letterali al posto degli a-capo |
| `SPREADSHEET_ID` | l'ID del foglio |

Sulla private key vale la stessa regola di Netlify: deve stare su una riga sola,
con `\n` scritti come due caratteri e non come veri a-capo. È l'errore che fa
fallire il collegamento nove volte su dieci.

Se ti sei dimenticato di metterle qui, le aggiungi dopo da
*Settings* → *Environment Variables*, ma poi devi rifare il deploy: Vercel le legge
al momento del build, non in tempo reale.

## 6. Deploy

Premi **Deploy**. In un minuto ti dà un indirizzo tipo `scheda-gym.vercel.app`.

Aprilo: se vedi i 28 esercizi della scheda, il foglio è collegato e hai finito.

## 7. Da qui in poi

Ogni push su GitHub aggiorna sia Vercel sia Netlify, in automatico.
Quando ti fidi di Vercel, su Netlify puoi cancellare il sito e togliere anche
quel consumo. Non c'è fretta: tenerli entrambi non costa nulla.

---

## Se qualcosa non va

**Vedi "Il foglio non risponde"** — le variabili non sono arrivate. Controlla che
siano su *Settings* → *Environment Variables* e rifai il deploy da *Deployments* →
*Redeploy*.

**Errore sulla chiave** — quasi sempre è la `GOOGLE_PRIVATE_KEY` incollata con veri
a-capo. Riprendila dal JSON originale e sostituisci ogni a-capo con `\n`.

**Il foglio si apre ma è vuoto** — il service account non è stato aggiunto come
Editor del foglio Google. Aprilo, *Condividi*, incolla l'email del service account.

**Errore 404 sulla pagina** — controlla che la cartella si chiami esattamente
`public` e che `api/sheets.js` sia in una cartella `api` alla radice del repo.
