# FitTrack

Diario personale degli allenamenti, utilizzabile in locale con SQLite oppure
online su Railway con PostgreSQL, HTTPS e accesso tramite password.

## Avvio locale

Fai doppio clic su `avvia.bat` oppure esegui:

```powershell
npm install
npm start
```

Senza `DATABASE_URL`, FitTrack usa automaticamente `data/fittrack.db`.

## Pubblicazione su Railway

### 1. Carica il progetto su GitHub

Crea un repository privato e carica l'intera cartella `fittrack`. Non caricare
file `.env`. Il database locale `data/fittrack.db` contiene dati personali:
prima di pubblicarlo decidi se vuoi includerlo solo temporaneamente per la
migrazione oppure tenerlo esclusivamente sul PC.

### 2. Crea i servizi

1. In Railway apri il progetto vuoto `FitTrack`.
2. Seleziona **New > Database > PostgreSQL**.
3. Seleziona **New > GitHub Repo** e scegli il repository di FitTrack.
4. Nel servizio dell'app apri **Variables**.
5. Aggiungi un riferimento alla variabile `DATABASE_URL` del servizio PostgreSQL.
6. Aggiungi `APP_PASSWORD` con una password privata di almeno 10 caratteri.
7. Aggiungi `AUTH_SECRET` con una stringa casuale lunga almeno 32 caratteri.

Railway rileva `railway.json`, esegue `npm start` e controlla `/health`.

### 3. Attiva l'indirizzo HTTPS

Nel servizio dell'app apri **Settings > Networking > Public Networking** e
premi **Generate Domain**. Railway fornisce un indirizzo `.railway.app` con
HTTPS automatico.

### 4. Trasferisci i dati locali

Per trasferire persone, allenamenti e catalogo dal file SQLite esistente,
recupera da Railway la `DATABASE_URL` pubblica del PostgreSQL e, sul PC:

```powershell
$env:DATABASE_URL="postgresql://..."
$env:CONFIRM_MIGRATION="yes"
npm run migrate:railway
```

Lo script sostituisce il contenuto del database PostgreSQL con quello del file
locale. Va eseguito solo sul database Railway corretto.

## Sicurezza e backup

- Non inserire password o `DATABASE_URL` nei file pubblicati.
- Usa un repository GitHub privato.
- Attiva l'autenticazione a due fattori su GitHub e Railway.
- Esegui backup periodici del database PostgreSQL dal pannello Railway.
- Il collegamento pubblico usa HTTPS; la sessione è conservata in un cookie
  `HttpOnly`, `Secure` e `SameSite=Lax`.
