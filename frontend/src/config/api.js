// Base URL of the Django API, e.g. https://your-backend.up.railway.app/api
// Set VITE_API_URL in .env.local (dev) or in the Vercel project settings (prod).
export const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000/api").replace(/\/+$/, "");

export const TOKEN_KEY = "auth_token";
