// Minimal Claude Messages API client (no SDK needed).
const MODEL = () => process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

export class ClaudeError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/**
 * @param {object} o
 * @param {string} o.prompt
 * @param {string[]} [o.imagesB64]  base64 JPEGs
 * @param {number} [o.maxTokens]
 * @returns {Promise<string>} the text reply
 */
export async function askClaude({ prompt, imagesB64 = [], maxTokens = 2000 }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new ClaudeError("Server not configured: set ANTHROPIC_API_KEY in Vercel.", 500);
  const content = [
    ...imagesB64.map(data => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
    { type: "text", text: prompt },
  ];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.error("Claude API error", r.status, body.slice(0, 500));
    if (r.status === 401) throw new ClaudeError("The Anthropic API key is invalid. Check ANTHROPIC_API_KEY in Vercel.", 502);
    if (r.status === 429) throw new ClaudeError("Claude is rate-limited right now. Try again in a minute.", 429);
    if (r.status === 400 && /credit|billing|balance/i.test(body)) throw new ClaudeError("Your Anthropic account is out of credit. Top up in the Console.", 402);
    throw new ClaudeError("Claude couldn't answer. Try again.", 502);
  }
  const j = await r.json();
  return (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}

/** Pull one JSON value out of a reply (whole text, a ``` fence, or first {…last }). */
export function parseJson(text) {
  try { return JSON.parse(text); } catch { }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { } }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { } }
  return null;
}
