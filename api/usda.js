import { requireUser, onlyMethod } from "./_lib/auth.js";

// USDA FoodData Central search, limited to lab-measured datasets (values per 100 g).
// Nutrient numbers: 208 energy kcal, 203 protein, 205 carbohydrate, 204 fat,
// 957/958 Atwater energy (used by some Foundation foods), 268 energy kJ.
const pick = (list, nums) => {
  for (const want of nums) {
    const hit = list.find(x => String(x.nutrientNumber) === want && x.value != null);
    if (hit) return { value: Number(hit.value), num: want };
  }
  return null;
};

export default async function handler(req, res) {
  if (!onlyMethod(req, res, "GET")) return;
  if (!(await requireUser(req, res))) return;

  const q = String(req.query.q || "").trim().slice(0, 100);
  if (!q) return res.status(400).json({ error: "Type something to search." });

  const key = process.env.USDA_API_KEY || "DEMO_KEY";
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&pageSize=15&dataType=${encodeURIComponent("Foundation,SR Legacy")}`;
  try {
    const r = await fetch(url);
    if (r.status === 429) return res.status(429).json({ error: "USDA search limit reached. Add a free USDA_API_KEY in Vercel to raise it." });
    if (!r.ok) return res.status(502).json({ error: "USDA didn't answer. Try again." });
    const j = await r.json();
    const r1 = v => Math.round((Number(v) || 0) * 10) / 10;
    const foods = (j.foods || []).map(f => {
      const ns = f.foodNutrients || [];
      let e = pick(ns, ["208", "958", "957"]);
      let kcal = e?.value;
      if (kcal == null) { const kj = pick(ns, ["268"]); if (kj) kcal = kj.value / 4.184; }
      if (kcal == null) return null;
      return {
        fdcId: f.fdcId, name: String(f.description || "").slice(0, 120), dataType: f.dataType,
        kcal: r1(kcal), p: r1(pick(ns, ["203"])?.value), c: r1(pick(ns, ["205"])?.value), f: r1(pick(ns, ["204"])?.value),
      };
    }).filter(Boolean).slice(0, 10);
    return res.status(200).json({ foods });
  } catch {
    return res.status(502).json({ error: "Couldn't reach USDA. Try again." });
  }
}
