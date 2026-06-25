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

## Aggiornamenti sicuri

Quando ricevi una nuova versione, sostituisci nel repository:

- `server.js`
- `db.js`
- `package.json`
- `railway.json`
- l'intera cartella `public`
- `test.js`

Non caricare `data/fittrack.db`. Dopo il commit attendi che Railway mostri
`Success`, poi apri:

```text
https://TUO-DOMINIO.railway.app/health
```

Il risultato corretto è:

```json
{"ok":true,"database":"postgres"}
```

Se compare `503`, PostgreSQL non è ancora pronto o il collegamento
`DATABASE_URL` non è valido. Consulta i log prima di modificare altre
variabili.

## Misure di stabilità

- PostgreSQL usa un pool limitato con timeout.
- Il server riprova automaticamente la connessione durante l'avvio.
- Il controllo `/health` verifica realmente il database.
- I deploy si arrestano in modo ordinato senza interrompere le transazioni.
- Le scritture degli allenamenti sono transazionali.
- I doppi tocchi sui moduli vengono bloccati.
- La PWA non memorizza password, API o dati personali nella cache.
- SQLite locale usa WAL e attesa automatica in caso di file occupato.
