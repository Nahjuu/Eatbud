// Base URL used for every call to the Eatbud API.
//
// - Local development: `VITE_API_URL` is omitted, so the Vite dev server proxy
//   (see vite.config.js) forwards `/api` to http://localhost:3000.
// - Production: the backend is deployed separately on Vercel, so the frontend
//   must point at its full URL. Set `VITE_API_URL` in the frontend Vercel
//   project to override this default.
const productionApiUrl = 'https://eatbudbackend.vercel.app/api';

export const apiUrl =
  import.meta.env.VITE_API_URL || (import.meta.env.PROD ? productionApiUrl : '/api');
