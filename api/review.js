import { requireUser, onlyMethod } from "./_lib/auth.js";
import { askClaude, ClaudeError } from "./_lib/claude.js";

export default async function handler(req, res) {
  if (!onlyMethod(req, res, "POST")) return;
  if (!(await requireUser(req, res))) return;

  const b = req.body || {};
  // the client already computed these; cap sizes so a bad payload can't run up the bill
  const data = JSON.stringify({
    targets: b.targets, days: (b.days || []).slice(0, 7), average_kcal_by_meal_per_logged_day: b.byMeal,
    top_foods_by_total_kcal: (b.top || []).slice(0, 12), percent_of_kcal_from_checked_foods: b.pctChecked,
    weigh_ins_this_week: (b.weighIns || []).slice(0, 7),
  }).slice(0, 20000);

  const prompt = `You are reviewing one week of food logging for a user in Malaysia. Be direct and specific, like a sharp friend who knows nutrition. No praise padding, no medical claims, no generic advice.

DATA (computed by the app; trust these numbers and do not recompute totals differently):
${data}

Write plain text (no markdown headers, no bold), max about 180 words:
- One line verdict on calories and protein versus target, using logged days only. If fewer than 5 days are logged, say the week is incomplete and the average is unreliable.
- 2-3 lines on where the calories come from (name the specific foods/drinks and meals that drive the total).
- 1 line on data quality: if under 50% of calories are from checked foods, name the 2-3 most-eaten unchecked items worth adding to My foods.
- 1-2 concrete changes for next week, tied to the foods above (e.g. swap, portion, timing). Each starts with "- ".`;

  try {
    const text = await askClaude({ prompt, maxTokens: 800 });
    return res.status(200).json({ text: text.trim() });
  } catch (e) {
    const status = e instanceof ClaudeError ? e.status : 500;
    return res.status(status).json({ error: e instanceof ClaudeError ? e.message : "Something went wrong. Try again." });
  }
}
