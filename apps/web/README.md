# Web Dashboard

The web app is a Next.js dashboard for trading history and structured analysis review.

## Run

```bash
pnpm dev:web
```

The dashboard runs on `http://localhost:3001`.

## Routes

- `/` overview dashboard
- `/trades` trading history with manual entry and close flows
- `/analysis` structured analysis feed

## API

The UI reads from the API configured in `NEXT_PUBLIC_API_BASE_URL` and falls back to `http://localhost:3000` when not set.

