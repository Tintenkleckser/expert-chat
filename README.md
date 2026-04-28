# Expert Chat RAG

Kleiner Prototyp für einen Chat, der zwei Supabase-Quellen getrennt durchsucht und daraus eine gemeinsame, quellengebundene Antwort erzeugt.

## Start

1. Abhängigkeiten installieren:

```bash
npm install
```

2. `.env.example` nach `.env` kopieren und die Keys eintragen.

3. Supabase muss die RPC-Funktionen aus `supabase-rpc.sql` enthalten.

4. App starten:

```bash
npm run dev
```

Web: `http://127.0.0.1:5173`
API: `http://127.0.0.1:8787`

## Vercel Deployment

Das Projekt ist für Vercel vorbereitet. In Vercel müssen diese Environment Variables gesetzt werden:

```txt
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_MATCH_DIK2_FUNCTION
SUPABASE_MATCH_HANDBUCH_FUNCTION
LLM_PROVIDER
MISTRAL_API_KEY
MISTRAL_CHAT_MODEL
MISTRAL_EMBEDDING_MODEL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

`VITE_API_BASE` kann auf Vercel leer bleiben, damit das Frontend die lokalen API-Routen unter `/api` verwendet.

## Supabase Edge Function Deployment

Alternativ kann die geschützte Chat-API als Supabase Edge Function laufen:

```bash
supabase functions deploy expert-chat-stream
```

Secrets für die Function:

```bash
supabase secrets set SUPABASE_URL=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
supabase secrets set MISTRAL_API_KEY=...
supabase secrets set MISTRAL_CHAT_MODEL=mistral-large-latest
supabase secrets set MISTRAL_EMBEDDING_MODEL=mistral-embed
supabase secrets set SUPABASE_MATCH_DIK2_FUNCTION=match_wissen_dik2
supabase secrets set SUPABASE_MATCH_HANDBUCH_FUNCTION=match_wissen_handbuch
```

Für statisches Hosting des Frontends:

```txt
VITE_API_BASE=
VITE_CHAT_STREAM_URL=https://your-project.supabase.co/functions/v1/expert-chat-stream
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Warum getrenntes Retrieval?

Die App sucht pro Frage bewusst separat in `wissen_dik2` und `wissen_handbuch`. So kann das Modell nicht unbemerkt nur eine Quelle bevorzugen, wenn beide Quellen thematisch überlappen.
