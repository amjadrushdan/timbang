import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../../config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

/**
 * Every /api route spends your money or quota, so it only answers a signed-in
 * user whose email is in ALLOWED_EMAILS. Fails closed: if ALLOWED_EMAILS is
 * unset, nobody gets through.
 * Returns the user, or null after sending an error response.
 */
export async function requireUser(req, res) {
  const allowed = (process.env.ALLOWED_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) {
    res.status(500).json({ error: "Server not configured: set ALLOWED_EMAILS in Vercel." });
    return null;
  }
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) { res.status(401).json({ error: "Sign in first." }); return null; }
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) { res.status(401).json({ error: "Your session expired. Sign in again." }); return null; }
  if (!allowed.includes(String(data.user.email || "").toLowerCase())) {
    res.status(403).json({ error: "This account isn't allowed to use Timbang." });
    return null;
  }
  return data.user;
}

export function onlyMethod(req, res, method) {
  if (req.method !== method) { res.setHeader("Allow", method); res.status(405).json({ error: "Method not allowed" }); return false; }
  return true;
}
