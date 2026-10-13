import { requireUser, onlyMethod } from "./_lib/auth.js";

// Open Food Facts product lookup. Free, no key; they ask for a descriptive User-Agent.
export default async function handler(req, res) {
  if (!onlyMethod(req, res, "GET")) return;
  if (!(await requireUser(req, res))) return;

  const code = String(req.query.code || "").replace(/\D/g, "");
  if (code.length < 8 || code.length > 14) return res.status(400).json({ error: "Barcodes are 8 to 14 digits." });

  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_quantity,serving_size`, {
      headers: { "User-Agent": "Timbang/1.0 (personal food log)" },
    });
    if (r.status === 404) return res.status(404).json({ error: "Not found." });
    if (!r.ok) return res.status(502).json({ error: "Open Food Facts didn't answer. Try again." });
    const j = await r.json();
    const p = j.product;
    if (j.status !== 1 || !p) return res.status(404).json({ error: "Not found." });

    const n = p.nutriments || {};
    let kcal = n["energy-kcal_100g"];
    if (kcal == null && n["energy_100g"] != null) kcal = n["energy_100g"] / 4.184; // kJ → kcal
    if (kcal == null) return res.status(404).json({ error: "This product has no nutrition data in Open Food Facts. Add it from the label in My foods." });

    const r1 = v => Math.round((Number(v) || 0) * 10) / 10;
    const name = [p.brands?.split(",")[0]?.trim(), p.product_name].filter(Boolean).join(" ") || `Product ${code}`;
    return res.status(200).json({
      name: name.slice(0, 120),
      kcal: r1(kcal), p: r1(n.proteins_100g), c: r1(n.carbohydrates_100g), f: r1(n.fat_100g),
      servingGrams: Number(p.serving_quantity) > 0 ? r1(p.serving_quantity) : null,
      servingLabel: p.serving_size || null,
    });
  } catch {
    return res.status(502).json({ error: "Couldn't reach Open Food Facts. Try again." });
  }
}
