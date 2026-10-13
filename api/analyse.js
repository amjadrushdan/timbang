import { requireUser, onlyMethod } from "./_lib/auth.js";
import { askClaude, parseJson, ClaudeError } from "./_lib/claude.js";

// Vercel caps request bodies at 4.5 MB; the client resizes photos to ~1568 px JPEG to stay well under.
const num = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0; };

function buildPrompt(text, foods, hasPhoto) {
  return `You are a careful nutrition parser for a user in Malaysia. Accuracy matters more than speed.
Task: ${hasPhoto ? "identify each separate food and drink in the attached photo (use the user's note as extra context)" : "split the meal description into separate foods and drinks"} and estimate the edible weight of each in grams.

Rules:
- If an item matches one of USER_FOODS by meaning, return its "key" and copy its per-100 g values exactly. If it has unit/unitGrams and the user used that unit, use those grams.
- Otherwise give per-100 g values for the food as eaten (cooked, with typical oil/sugar for Malaysian preparation), preferring the Malaysian Food Composition Database (MyFCD), then USDA FoodData Central. Set "ref" to "MyFCD", "USDA" or "estimate". Use "estimate" when you are not drawing on a specific database entry.
- Typical Malaysian portions when no amount is given: 1 senduk/pinggan nasi putih ≈ 150 g cooked rice; nasi lemak bungkus ≈ 1 small packet with sambal, egg half, ikan bilis, peanuts (split into components); 1 gelas teh tarik ≈ 250 ml. Kurang manis means about half the sugar; kosong means no sugar/milk.
- Split mixed dishes into components when that improves accuracy (rice, protein, sauce/gravy, vegetables).
- In "note", state the portion assumption in a few words so the user can correct it, e.g. "assumed 1 medium thigh, ~110 g edible".
- Round kcal to whole numbers and macros to 0.1 g.

USER_FOODS: ${JSON.stringify(foods)}

USER_INPUT: ${JSON.stringify(text || "(no note)")}

Reply with only JSON in this shape, no other text:
{"items":[{"name":"Nasi putih","grams":150,"kcal":130,"p":2.7,"c":28.2,"f":0.3,"key":null,"ref":"MyFCD","note":"1 senduk, ~150 g cooked"}]}`;
}

export default async function handler(req, res) {
  if (!onlyMethod(req, res, "POST")) return;
  if (!(await requireUser(req, res))) return;

  const body = req.body || {};
  const text = String(body.text || "").slice(0, 2000);
  const image = typeof body.image === "string" && body.image.length < 4_000_000 ? body.image : null;
  if (!text && !image) return res.status(400).json({ error: "Type what you ate or add a photo." });

  const foods = (Array.isArray(body.foods) ? body.foods : []).slice(0, 250).map(f => ({
    key: String(f.key || "").slice(0, 64), name: String(f.name || "").slice(0, 120),
    kcal: num(f.kcal, 1000), p: num(f.p, 100), c: num(f.c, 100), f: num(f.f, 100),
    ...(f.unit ? { unit: String(f.unit).slice(0, 40), unitGrams: num(f.unitGrams, 5000) } : {}),
  }));
  const keys = new Set(foods.map(f => f.key));

  try {
    const reply = await askClaude({ prompt: buildPrompt(text, foods, !!image), imagesB64: image ? [image] : [], maxTokens: 2500 });
    const out = parseJson(reply);
    if (!out || !Array.isArray(out.items)) return res.status(502).json({ error: "Claude's answer came back in the wrong shape. Press Analyse again." });
    const items = out.items.slice(0, 30).map(x => ({
      name: String(x.name || "Food").slice(0, 120),
      grams: num(x.grams, 5000),
      kcal: num(x.kcal, 1000), p: num(x.p, 100), c: num(x.c, 100), f: num(x.f, 100),
      key: x.key && keys.has(String(x.key)) ? String(x.key) : null,
      ref: ["MyFCD", "USDA", "estimate"].includes(x.ref) ? x.ref : "estimate",
      note: x.note ? String(x.note).slice(0, 160) : "",
    }));
    return res.status(200).json({ items });
  } catch (e) {
    const status = e instanceof ClaudeError ? e.status : 500;
    return res.status(status).json({ error: e instanceof ClaudeError ? e.message : "Something went wrong. Try again." });
  }
}
