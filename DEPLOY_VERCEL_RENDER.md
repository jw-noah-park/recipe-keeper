# Deploy on Vercel + Render

This project is split into:

- `client`: React + Vite frontend
- `server`: Express API

The simplest deployment is:

- `client` -> Vercel
- `server` -> Render
- database -> Supabase

## 1. Local env setup

### Client

Create `client/.env.local`:

```env
VITE_API_URL=http://localhost:5001/api
```

### Server

Create `server/.env`:

```env
PORT=5001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

## 2. Deploy the backend to Render

Create a new **Web Service** on Render and point it at this repository.

Use these settings:

- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`

Set these environment variables in Render:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ALLOWED_ORIGINS`

After the service is created, Render will give you a URL like:

```text
https://recipe-keeper-api.onrender.com
```

Your API base URL for the frontend will be:

```text
https://recipe-keeper-api.onrender.com/api
```

## 3. Deploy the frontend to Vercel

Create a new Vercel project and point it at this repository.

Use these settings:

- Root Directory: `client`
- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`

Set this environment variable in Vercel:

```env
VITE_API_URL=https://your-render-service.onrender.com/api
```

Deploy the project. Vercel will give you a URL like:

```text
https://recipe-keeper.vercel.app
```

## 4. Update backend CORS after frontend deploy

Once you know the real Vercel URL, update Render:

```env
CORS_ALLOWED_ORIGINS=https://recipe-keeper.vercel.app
```

If you want both local development and production to work, use both:

```env
CORS_ALLOWED_ORIGINS=http://localhost:5173,https://recipe-keeper.vercel.app
```

Save and redeploy the Render service.

## 5. Deploy order

Use this order:

1. Deploy `server` to Render
2. Copy the Render URL
3. Set `VITE_API_URL` in Vercel
4. Deploy `client` to Vercel
5. Copy the Vercel URL
6. Put that URL into `CORS_ALLOWED_ORIGINS` on Render
7. Redeploy Render

## 6. Notes

- `VITE_API_URL` must include `/api`
- `SUPABASE_SERVICE_ROLE_KEY` must stay on the backend only
- Render free web services can sleep when idle, so the first request after inactivity can be slow
- If your Vercel project gets a new preview URL, it will not be allowed by CORS unless you add it

## 7. Current code behavior

- Frontend API URL comes from `import.meta.env.VITE_API_URL`
- Backend CORS origins come from `CORS_ALLOWED_ORIGINS`
- If no envs are set, local defaults are used:
  - client -> `http://localhost:5001/api`
  - server CORS -> `http://localhost:5173`
