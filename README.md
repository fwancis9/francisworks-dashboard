# FrancisWorks Dashboard

Private inquiry dashboard for FrancisWorks.

## Environment

Set these Railway variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

Railway provides `PORT` automatically.

Add your Railway dashboard URL to Supabase Auth redirect URLs:

```text
https://your-dashboard-domain.up.railway.app/
```

## Local run

```bash
cp .env.example .env
npm start
```

Open `http://localhost:4173/`.
