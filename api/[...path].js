import app, { ready } from "../backend/server.js";

// Vercel routes /api/* to this catch-all function. Keep the original request
// path so Express can match its existing /api/... endpoints unchanged.
export default async function handler(req, res) {
  await ready;
  return app(req, res);
}
