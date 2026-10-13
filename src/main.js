import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r1 = n => Math.round((+n || 0) * 10) / 10;
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return ymd(d); };
const weekDates = s => { const d = new Date(s + "T00:00:00"); const mon = addDays(s, -((d.getDay() + 6) % 7)); return [...Array(7)].map((_, i) => addDays(mon, i)); };
const MEALS = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snack"]];
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
const fmtShort = d => new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

const S = {
  user: null,
  date: ymd(new Date()),
  entries: [],
  settings: { kcal: 2000, p: 120, c: 220, f: 65 },
  foods: {},          // id -> row
  meals: [],
  weights: {},        // day -> kg
  week: {},           // day -> kcal
  review: [],
  photo: null,
  ctl: null, rvCtl: null,
  todayCount: null, ydayCount: null, weightsLoaded: false,
  remList: [],
};

function setStatus(t, err) { const s = $("#status"); s.textContent = t; s.classList.toggle("err", !!err); }
function showBanner(t) { const b = $("#banner"); b.textContent = t; b.hidden = !t; }
function dbFail(error, what) { console.error(what, error); showBanner(`Couldn't ${what}. Check your connection and try again.`); }

/* ---------- API (Vercel routes) ---------- */
async function api(path, { method = "GET", body, signal } = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(path, {
    method, signal,
    headers: { "content-type": "application/json", authorization: "Bearer " + (session?.access_token || "") },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
  return j;
}

/* ---------- maths ---------- */
const nut = e => { const k = (+e.grams || 0) / 100; return { kcal: k * (+e.kcal || 0), p: k * (+e.p || 0), c: k * (+e.c || 0), f: k * (+e.f || 0) }; };
const totals = list => list.reduce((a, e) => { const n = nut(e); a.kcal += n.kcal; a.p += n.p; a.c += n.c; a.f += n.f; return a; }, { kcal: 0, p: 0, c: 0, f: 0 });
const conf = e => (e.checked ? "hi" : "md");

/* ---------- loading ---------- */
async function loadDay() {
  const d = S.date;
  const { data, error } = await sb.from("entries").select("*").eq("day", d).order("created_at");
  if (error) return dbFail(error, "load this day");
  if (d !== S.date) return;               // user moved on while loading
  S.entries = data;
  S.week[d] = totals(data).kcal;
  const today = ymd(new Date());
  if (d === today) S.todayCount = data.length;
  if (d === addDays(today, -1)) S.ydayCount = data.length;
  renderDay(); renderWeek(); renderBell();
}
async function loadWeek() {
  const ds = weekDates(S.date);
  const { data, error } = await sb.from("entries").select("day,grams,kcal").gte("day", ds[0]).lte("day", ds[6]);
  if (error) return dbFail(error, "load the week");
  ds.forEach(d => { S.week[d] = 0; });
  data.forEach(e => { S.week[e.day] = (S.week[e.day] || 0) + nut({ grams: e.grams, kcal: e.kcal }).kcal; });
  renderWeek();
}
async function loadFoods() {
  const { data, error } = await sb.from("foods").select("*").order("name");
  if (error) return dbFail(error, "load your foods");
  S.foods = Object.fromEntries(data.map(f => [f.id, f]));
  renderFoods(); renderReview();
}
async function loadMeals() {
  const { data, error } = await sb.from("saved_meals").select("*").order("created_at", { ascending: false });
  if (error) return dbFail(error, "load saved meals");
  S.meals = data; renderMeals();
}
async function loadWeights() {
  const { data, error } = await sb.from("weights").select("day,kg").gte("day", addDays(ymd(new Date()), -400)).order("day");
  if (error) return dbFail(error, "load weights");
  S.weights = Object.fromEntries(data.map(w => [w.day, +w.kg]));
  S.weightsLoaded = true; renderWeight(); renderBell();
}
async function loadSettings() {
  const { data, error } = await sb.from("settings").select("kcal,p,c,f").maybeSingle();
  if (error) return dbFail(error, "load targets");
  if (data) S.settings = data;
  fillTargets(); renderDay(); renderWeek();
}
async function checkYesterday() {
  const y = addDays(ymd(new Date()), -1);
  const { count, error } = await sb.from("entries").select("id", { count: "exact", head: true }).eq("day", y);
  if (!error) { S.ydayCount = count; renderBell(); }
}
function loadAll() {
  return Promise.all([loadSettings(), loadFoods(), loadMeals(), loadWeights(), loadDay(), loadWeek(), checkYesterday()]);
}

/* ---------- render: day ---------- */
function renderDay() {
  const t = totals(S.entries), g = S.settings;
  const today = ymd(new Date());
  $("#dayLbl").textContent = S.date === today ? "Today" : new Date(S.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  $("#kcal").textContent = Math.round(t.kcal);
  const left = Math.round(g.kcal - t.kcal);
  $("#kcalSub").textContent = left >= 0 ? `${left} left of ${g.kcal}` : `${-left} over ${g.kcal}`;
  const frac = Math.min(t.kcal / (g.kcal || 1), 1);
  const arc = $("#ringArc");
  arc.setAttribute("stroke-dasharray", `${(frac * 314.16).toFixed(1)} 314.16`);
  arc.setAttribute("stroke", t.kcal > g.kcal ? "var(--over)" : "var(--accent)");
  $("#macros").innerHTML = [["Protein", "p", "--pc"], ["Carbs", "c", "--cc"], ["Fat", "f", "--fc"]].map(([n, k, col]) => {
    const pct = Math.min(100, (t[k] / (g[k] || 1)) * 100);
    return `<div class="mac"><div class="lbl"><span>${n}</span><span class="num">${Math.round(t[k])} / ${g[k]} g</span></div><div class="bar"><i style="width:${pct}%;background:var(${col})"></i></div></div>`;
  }).join("");
  const byC = { hi: 0, md: 0 };
  S.entries.forEach(e => { byC[conf(e)] += nut(e).kcal; });
  $("#conf").innerHTML = S.entries.length ? `<span><span class="dot d-hi"></span>Checked foods ${Math.round(byC.hi)} kcal</span><span><span class="dot d-md"></span>Estimated ${Math.round(byC.md)} kcal</span>` : "";
  $("#meals").innerHTML = MEALS.map(([k, label]) => {
    const list = S.entries.filter(e => e.meal === k);
    const rows = list.map(e => {
      const n = nut(e);
      return `<div class="ent">
        <span class="dot d-${conf(e)}" title="${e.checked ? "Checked food" : "Estimated values"}"></span>
        <div class="nm">${esc(e.name)}<div class="sub num">${r1(e.grams)} g · P ${r1(n.p)} C ${r1(n.c)} F ${r1(n.f)}</div></div>
        <span class="kc num">${Math.round(n.kcal)}</span>
        <button class="x" data-del="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">✕</button></div>`;
    }).join("");
    return `<div class="meal"><div class="meal-h"><h3>${label}</h3><span class="num note">${Math.round(totals(list).kcal)} kcal</span></div>${rows || `<div class="empty">Nothing logged.</div>`}</div>`;
  }).join("");
}
function renderWeek() {
  const dates = weekDates(S.date);
  const max = Math.max(S.settings.kcal * 1.2, ...dates.map(d => S.week[d] || 0));
  $("#week").innerHTML = dates.map(d => {
    const v = S.week[d] || 0, h = Math.max(3, (v / max) * 52);
    const cls = v > S.settings.kcal ? "over" : d === S.date ? "on" : "";
    const wd = new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "narrow" });
    return `<button class="col" data-day="${d}" title="${d}: ${Math.round(v)} kcal" aria-label="${d}, ${Math.round(v)} kcal"><div class="b ${cls}" style="height:${h}px"></div><span>${wd}</span></button>`;
  }).join("");
}
$("#meals").addEventListener("click", async e => {
  const b = e.target.closest("[data-del]"); if (!b) return;
  const id = b.dataset.del;
  const prev = S.entries;
  S.entries = S.entries.filter(x => x.id !== id); renderDay();
  const { error } = await sb.from("entries").delete().eq("id", id);
  if (error) { S.entries = prev; renderDay(); return dbFail(error, "remove that entry"); }
  S.week[S.date] = totals(S.entries).kcal; if (S.date === ymd(new Date())) S.todayCount = S.entries.length;
  renderWeek(); renderBell();
});
$("#week").addEventListener("click", e => { const d = e.target.closest("[data-day]")?.dataset.day; if (d) setDate(d); });

/* ---------- review list (before logging) ---------- */
function renderReview() {
  $("#reviewActs").hidden = !S.review.length;
  $("#review").innerHTML = S.review.map((it, i) => {
    const n = nut(it);
    const mine = it.food_id && S.foods[it.food_id];
    const chip = mine ? `<span class="chip mine">my food${mine.verified ? " · checked" : ""}</span>` : `<span class="chip">${esc(it.ref || "estimate")}</span>`;
    return `<div class="ritem" data-i="${i}">
      <div class="top">
        <div class="name">${esc(it.name)} ${chip}</div>
        <div class="row"><span class="gr"><input type="number" min="0" step="1" data-f="grams" value="${r1(it.grams)}" aria-label="Grams"> g</span><strong class="num">${Math.round(n.kcal)} kcal</strong><button class="x" data-rm="${i}" aria-label="Remove item">✕</button></div>
      </div>
      ${it.note ? `<div class="note">${esc(it.note)}</div>` : ""}
      <details class="per-wrap"><summary>Per 100 g: ${r1(it.kcal)} kcal · P ${r1(it.p)} · C ${r1(it.c)} · F ${r1(it.f)}</summary>
        <div class="per" style="margin-top:6px">${["kcal", "p", "c", "f"].map(k => `<label>${k === "kcal" ? "kcal" : k.toUpperCase() + " g"}<input type="number" step="0.1" min="0" data-f="${k}" value="${r1(it[k])}"></label>`).join("")}</div>
      </details>
      ${mine ? "" : `<div class="checks"><label><input type="checkbox" data-f="keep" ${it.keep ? "checked" : ""}> Add to my foods</label></div>`}
    </div>`;
  }).join("");
}
$("#review").addEventListener("input", e => {
  const el = e.target, card = el.closest("[data-i]"); if (!card || !el.dataset.f) return;
  const it = S.review[+card.dataset.i], f = el.dataset.f;
  it[f] = el.type === "checkbox" ? el.checked : +el.value;
  if (["grams", "kcal", "p", "c", "f"].includes(f)) {
    card.querySelector("strong").textContent = Math.round(nut(it).kcal) + " kcal";
    if (f !== "grams") card.querySelector("summary").textContent = `Per 100 g: ${r1(it.kcal)} kcal · P ${r1(it.p)} · C ${r1(it.c)} · F ${r1(it.f)}`;
  }
});
$("#review").addEventListener("click", e => {
  const i = e.target.closest("[data-rm]")?.dataset.rm; if (i == null) return;
  S.review.splice(+i, 1); renderReview();
});

const toEntryRow = (it, meal, day) => {
  const mine = it.food_id && S.foods[it.food_id];
  return { day, meal, name: String(it.name).slice(0, 120), grams: r1(it.grams), kcal: r1(it.kcal), p: r1(it.p), c: r1(it.c), f: r1(it.f),
    checked: !!(mine && mine.verified), src: it.src || "text", food_id: mine ? it.food_id : null };
};
async function insertEntries(rows) {
  const { data, error } = await sb.from("entries").insert(rows).select();
  if (error) { dbFail(error, "save those entries"); return false; }
  if (rows[0]?.day === S.date) { S.entries = S.entries.concat(data); }
  S.week[rows[0].day] = (S.week[rows[0].day] || 0) + totals(data).kcal;
  if (rows[0]?.day === ymd(new Date())) S.todayCount = (S.todayCount || 0) + data.length;
  renderDay(); renderWeek(); renderBell();
  return true;
}
$("#logAll").onclick = async () => {
  const btn = $("#logAll"); btn.disabled = true;
  try {
    const meal = $("#meal").value, day = S.date;
    // save new foods first so entries can point at them
    const newFoods = S.review.filter(it => it.keep && !(it.food_id && S.foods[it.food_id]));
    if (newFoods.length) {
      const rows = newFoods.map(it => ({ name: String(it.name).slice(0, 120), kcal: r1(it.kcal), p: r1(it.p), c: r1(it.c), f: r1(it.f),
        verified: false, source: it.source || "claude", source_ref: it.source_ref || null }));
      const { data, error } = await sb.from("foods").insert(rows).select();
      if (error) return dbFail(error, "save to My foods");
      data.forEach((f, i) => { S.foods[f.id] = f; newFoods[i].food_id = f.id; });
      renderFoods();
    }
    const ok = await insertEntries(S.review.map(it => toEntryRow(it, meal, day)));
    if (!ok) return;
    S.review = []; renderReview(); $("#txt").value = ""; clearPhoto(); setStatus("Logged.");
  } finally { btn.disabled = false; }
};
$("#discard").onclick = () => { S.review = []; renderReview(); setStatus(""); };
$("#saveMeal").onclick = async () => {
  const name = ($("#txt").value.trim() || "Meal").slice(0, 80);
  const items = S.review.map(it => ({ name: it.name, grams: r1(it.grams), kcal: r1(it.kcal), p: r1(it.p), c: r1(it.c), f: r1(it.f), food_id: it.food_id || null, ref: it.ref || null }));
  const { data, error } = await sb.from("saved_meals").insert({ name, items }).select().single();
  if (error) return dbFail(error, "save the meal");
  S.meals.unshift(data); renderMeals(); setStatus(`Saved “${name}” to Saved meals.`);
};

/* ---------- Claude analysis ---------- */
async function toJpegB64(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise(res => cv.toBlob(res, "image/jpeg", 0.85));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
$("#analyse").onclick = async () => {
  const text = $("#txt").value.trim();
  if (!text && !S.photo) { setStatus("Type what you ate or add a photo.", true); $("#txt").focus(); return; }
  S.ctl = new AbortController();
  $("#analyse").disabled = true; $("#stop").hidden = false; setStatus("Thinking...");
  try {
    const foods = Object.values(S.foods).slice(0, 250).map(f => ({ key: f.id, name: f.name, kcal: +f.kcal, p: +f.p, c: +f.c, f: +f.f, unit: f.unit || undefined, unitGrams: f.unit_grams ? +f.unit_grams : undefined }));
    const image = S.photo ? await toJpegB64(S.photo) : undefined;
    const out = await api("/api/analyse", { method: "POST", body: { text, image, foods }, signal: S.ctl.signal });
    const items = Array.isArray(out.items) ? out.items : [];
    if (!items.length) { setStatus("Couldn't find any food in that. Try listing items separately.", true); return; }
    S.review = items.map(x => {
      const mine = x.key && S.foods[x.key];
      const base = mine || x;
      return { name: String(x.name || mine?.name || "Food").slice(0, 120), grams: +x.grams || 0,
        kcal: +base.kcal || 0, p: +base.p || 0, c: +base.c || 0, f: +base.f || 0,
        food_id: mine ? x.key : null, ref: mine ? "my food" : (x.ref || "estimate"), note: x.note ? String(x.note).slice(0, 160) : "",
        keep: false, src: S.photo ? "photo" : "text", source: "claude" };
    });
    renderReview();
    setStatus("Check the grams, then log.");
  } catch (e) {
    if (e.name === "AbortError") setStatus("");
    else setStatus(e.message || "Couldn't reach Claude. Try again.", true);
  } finally { $("#analyse").disabled = false; $("#stop").hidden = true; }
};
$("#stop").onclick = () => S.ctl?.abort();
$("#photo").onchange = e => {
  const f = e.target.files?.[0]; if (!f) return;
  S.photo = f; const th = $("#thumb");
  th.src = URL.createObjectURL(f); th.hidden = false;
};
function clearPhoto() { S.photo = null; const th = $("#thumb"); th.hidden = true; th.removeAttribute("src"); $("#photo").value = ""; }

/* ---------- barcode (Open Food Facts) ---------- */
let scanStream = null, scanTimer = null;
function stopScan() {
  clearInterval(scanTimer); scanTimer = null;
  scanStream?.getTracks().forEach(t => t.stop()); scanStream = null;
  $("#scanVideo").hidden = true;
}
$("#scanBtn").onclick = async () => {
  $("#scanBox").hidden = false; $("#scanNote").textContent = "";
  if (!("BarcodeDetector" in window)) { $("#scanNote").textContent = "This browser can't scan barcodes with the camera. Type the number under the barcode."; $("#barcode").focus(); return; }
  try {
    const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const v = $("#scanVideo"); v.srcObject = scanStream; v.hidden = false; await v.play();
    $("#scanNote").textContent = "Point the camera at the barcode.";
    scanTimer = setInterval(async () => {
      try {
        const codes = await det.detect(v);
        if (codes.length) { $("#barcode").value = codes[0].rawValue; stopScan(); lookupBarcode(); }
      } catch { }
    }, 400);
  } catch {
    $("#scanNote").textContent = "Camera not available. Type the number under the barcode.";
  }
};
$("#scanClose").onclick = () => { stopScan(); $("#scanBox").hidden = true; };
$("#barcodeGo").onclick = () => lookupBarcode();
$("#barcode").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); lookupBarcode(); } });
async function lookupBarcode() {
  const code = $("#barcode").value.replace(/\D/g, "");
  if (code.length < 8) { $("#scanNote").textContent = "Barcodes are 8 to 14 digits."; return; }
  const existing = Object.values(S.foods).find(f => f.source === "off" && f.source_ref === code);
  if (existing) {
    S.review.push({ name: existing.name, grams: +existing.unit_grams || 100, kcal: +existing.kcal, p: +existing.p, c: +existing.c, f: +existing.f, food_id: existing.id, ref: "my food", src: "barcode" });
    renderReview(); $("#scanNote").textContent = "Found in My foods."; return;
  }
  $("#scanNote").textContent = "Looking up...";
  try {
    const p = await api("/api/barcode?code=" + code);
    S.review.push({ name: p.name, grams: p.servingGrams || 100, kcal: p.kcal, p: p.p, c: p.c, f: p.f, food_id: null,
      ref: "Open Food Facts", note: p.servingGrams ? `1 serving = ${p.servingGrams} g per label` : "No serving size on record; set the grams.",
      keep: true, src: "barcode", source: "off", source_ref: code });
    renderReview();
    $("#scanNote").textContent = "Added below. Open Food Facts data is crowd-sourced, so compare it with the label before ticking it as checked in My foods.";
  } catch (e) { $("#scanNote").textContent = e.status === 404 ? "Not in Open Food Facts. Add it from the label in My foods." : e.message; }
}

/* ---------- my foods ---------- */
function renderFoods() {
  const q = $("#foodSearch").value.trim().toLowerCase();
  const list = Object.values(S.foods).filter(v => !q || v.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  const srcLbl = { manual: "", claude: "from Claude", usda: "USDA", off: "barcode" };
  $("#foodList").innerHTML = list.length ? list.map(v => `<div class="li">
    <div><div class="nm">${esc(v.name)} ${v.verified ? '<span class="chip mine">checked</span>' : '<span class="chip">unchecked</span>'}${srcLbl[v.source] ? ` <span class="chip src">${srcLbl[v.source]}</span>` : ""}</div>
    <div class="sub num">per 100 g: ${r1(v.kcal)} kcal · P ${r1(v.p)} · C ${r1(v.c)} · F ${r1(v.f)}${v.unit ? ` · ${esc(v.unit)} = ${r1(v.unit_grams)} g` : ""}</div></div>
    <div class="acts"><span class="addg"><input type="number" min="0" step="1" value="${r1(v.unit_grams) || 100}" id="g-${v.id}" aria-label="Grams"> g</span>
    <button class="btn primary" data-add="${v.id}">Add</button><button class="btn" data-edit="${v.id}">Edit</button><button class="x" data-delf="${v.id}" aria-label="Delete ${esc(v.name)}">✕</button></div></div>`).join("")
    : `<div class="empty">${q ? "No match." : "No foods yet. Add one from a nutrition label, search USDA below, or tick “Add to my foods” when logging."}</div>`;
}
$("#foodSearch").oninput = renderFoods;
function armDelete(b, run) {
  if (b.dataset.armed) return run();
  b.dataset.armed = "1"; b.textContent = "Sure?"; b.style.width = "auto";
  setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "✕"; b.style.width = ""; } }, 2500);
}
$("#foodList").addEventListener("click", async e => {
  const add = e.target.closest("[data-add]")?.dataset.add, ed = e.target.closest("[data-edit]")?.dataset.edit, delB = e.target.closest("[data-delf]");
  if (add) {
    const v = S.foods[add], g = +document.getElementById("g-" + add).value || 0;
    const ok = await insertEntries([toEntryRow({ name: v.name, grams: g, kcal: v.kcal, p: v.p, c: v.c, f: v.f, food_id: add, src: "library" }, $("#meal").value, S.date)]);
    if (ok) { e.target.textContent = "Added"; setTimeout(() => { e.target.textContent = "Add"; }, 1200); }
  } else if (ed) {
    const v = S.foods[ed]; $("#addFoodBox").open = true;
    $("#ff-id").value = ed; $("#ff-name").value = v.name; $("#ff-kcal").value = +v.kcal; $("#ff-p").value = +v.p; $("#ff-c").value = +v.c; $("#ff-f").value = +v.f;
    $("#ff-unit").value = v.unit || ""; $("#ff-ug").value = v.unit_grams ? +v.unit_grams : ""; $("#ff-ver").checked = !!v.verified; $("#ff-name").focus();
  } else if (delB) {
    armDelete(delB, async () => {
      const id = delB.dataset.delf;
      const { error } = await sb.from("foods").delete().eq("id", id);
      if (error) return dbFail(error, "delete that food");
      delete S.foods[id]; renderFoods();
    });
  }
});
$("#foodForm").onsubmit = async e => {
  e.preventDefault();
  const id = $("#ff-id").value;
  const row = { name: $("#ff-name").value.trim().slice(0, 120), kcal: r1($("#ff-kcal").value), p: r1($("#ff-p").value), c: r1($("#ff-c").value), f: r1($("#ff-f").value),
    verified: $("#ff-ver").checked, unit: $("#ff-unit").value.trim() || null, unit_grams: +$("#ff-ug").value || null };
  if (!row.name) return;
  const q = id ? sb.from("foods").update(row).eq("id", id).select().single() : sb.from("foods").insert({ ...row, source: "manual" }).select().single();
  const { data, error } = await q;
  if (error) return dbFail(error, "save that food");
  S.foods[data.id] = data; renderFoods();
  e.target.reset(); $("#ff-id").value = ""; $("#ff-ver").checked = true;
  $("#ffStatus").textContent = "Saved."; setTimeout(() => { $("#ffStatus").textContent = ""; }, 1500);
};

/* ---------- USDA search ---------- */
let usdaResults = [];
$("#usdaForm").onsubmit = async e => {
  e.preventDefault();
  const q = $("#usdaQ").value.trim(); if (!q) return;
  $("#usdaStatus").textContent = "Searching..."; $("#usdaList").innerHTML = "";
  try {
    const out = await api("/api/usda?q=" + encodeURIComponent(q));
    usdaResults = out.foods || [];
    $("#usdaStatus").textContent = usdaResults.length ? "" : "No results. Try simpler words, e.g. “rice white cooked”.";
    $("#usdaList").innerHTML = usdaResults.map((f, i) => `<div class="li"><div><div class="nm">${esc(f.name)}</div>
      <div class="sub num">per 100 g: ${r1(f.kcal)} kcal · P ${r1(f.p)} · C ${r1(f.c)} · F ${r1(f.f)} · ${esc(f.dataType)}</div></div>
      <div class="acts"><button class="btn" data-usda="${i}">Add to my foods</button></div></div>`).join("");
  } catch (err) { $("#usdaStatus").textContent = err.message; }
};
$("#usdaList").addEventListener("click", async e => {
  const b = e.target.closest("[data-usda]"); if (!b) return;
  const f = usdaResults[+b.dataset.usda];
  b.disabled = true;
  const { data, error } = await sb.from("foods").insert({ name: f.name.slice(0, 120), kcal: r1(f.kcal), p: r1(f.p), c: r1(f.c), f: r1(f.f), verified: true, source: "usda", source_ref: String(f.fdcId) }).select().single();
  if (error) { b.disabled = false; return dbFail(error, "add that food"); }
  S.foods[data.id] = data; renderFoods(); b.textContent = "Added";
});

/* ---------- saved meals ---------- */
function renderMeals() {
  $("#mealList").innerHTML = S.meals.length ? S.meals.map(m => {
    const t = totals(m.items);
    return `<div class="li"><div><div class="nm">${esc(m.name)}</div><div class="sub num">${m.items.length} items · ${Math.round(t.kcal)} kcal · P ${Math.round(t.p)} C ${Math.round(t.c)} F ${Math.round(t.f)}</div></div>
    <div class="acts"><button class="btn primary" data-logm="${m.id}">Log</button><button class="x" data-delm="${m.id}" aria-label="Delete ${esc(m.name)}">✕</button></div></div>`;
  }).join("") : `<div class="empty">No saved meals yet.</div>`;
}
$("#mealList").addEventListener("click", async e => {
  const lg = e.target.closest("[data-logm]")?.dataset.logm, dl = e.target.closest("[data-delm]");
  if (lg) {
    const m = S.meals.find(x => x.id === lg); if (!m) return;
    const ok = await insertEntries(m.items.map(it => toEntryRow({ ...it, src: "meal" }, $("#meal").value, S.date)));
    if (ok) { e.target.textContent = "Logged"; setTimeout(() => { e.target.textContent = "Log"; }, 1200); }
  } else if (dl) {
    armDelete(dl, async () => {
      const { error } = await sb.from("saved_meals").delete().eq("id", dl.dataset.delm);
      if (error) return dbFail(error, "delete that meal");
      S.meals = S.meals.filter(x => x.id !== dl.dataset.delm); renderMeals();
    });
  }
});

/* ---------- weight ---------- */
function wAvg(dates, i) {
  const end = dates[i], start = addDays(end, -6);
  const vals = dates.filter(d => d >= start && d <= end).map(d => S.weights[d]);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
function renderWeight() {
  const dates = Object.keys(S.weights).sort();
  const last = dates.at(-1);
  if (!dates.length) {
    $("#wStats").innerHTML = ""; $("#wChart").innerHTML = "";
    $("#wList").innerHTML = `<div class="empty">No weigh-ins yet. Add today's weight above.</div>`; return;
  }
  const avgNow = wAvg(dates, dates.length - 1);
  const prevIdx = dates.findLastIndex(d => d <= addDays(last, -7));
  const delta = prevIdx >= 0 ? avgNow - wAvg(dates, prevIdx) : null;
  $("#wStats").innerHTML = `<div class="stat"><div class="v num">${r1(S.weights[last])}</div><div class="k">Latest kg · ${last}</div></div>
    <div class="stat"><div class="v num">${r1(avgNow)}</div><div class="k">7-day average kg</div></div>
    <div class="stat"><div class="v num">${delta == null ? "–" : (delta > 0 ? "+" : "") + r1(delta)}</div><div class="k">vs a week before</div></div>`;
  const shown = dates.filter(d => d >= addDays(last, -59));
  const W = 600, H = 200, L = 40, R = 12, T = 12, B = 26;
  const avgs = shown.map(d => wAvg(dates, dates.indexOf(d)));
  const all = shown.map(d => S.weights[d]).concat(avgs);
  let lo = Math.floor(Math.min(...all) - 0.5), hi = Math.ceil(Math.max(...all) + 0.5);
  if (hi - lo < 2) { lo -= 1; hi += 1; }
  const t0 = new Date(shown[0] + "T00:00:00").getTime(), t1 = new Date(last + "T00:00:00").getTime();
  const x = d => L + (t1 === t0 ? (W - L - R) / 2 : (new Date(d + "T00:00:00").getTime() - t0) / (t1 - t0) * (W - L - R));
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const grid = [lo, (lo + hi) / 2, hi].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${r1(v)}</text>`).join("");
  const dots = shown.map(d => `<circle cx="${x(d)}" cy="${y(S.weights[d])}" r="3" fill="var(--muted)" opacity=".55"><title>${d}: ${S.weights[d]} kg</title></circle>`).join("");
  const line = shown.map((d, i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(avgs[i]).toFixed(1)}`).join(" ");
  $("#wChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight over the last 60 days with 7-day average">${grid}
    ${dots}<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last)}" cy="${y(avgs.at(-1))}" r="4.5" fill="var(--accent)"/>
    <text x="${L}" y="${H - 6}">${fmtShort(shown[0])}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${fmtShort(last)}</text></svg>`;
  $("#wList").innerHTML = dates.slice().reverse().slice(0, 14).map(d => `<div class="li"><div><div class="nm num">${r1(S.weights[d])} kg</div><div class="sub">${d}</div></div>
    <div class="acts"><button class="x" data-delw="${d}" aria-label="Delete weight for ${d}">✕</button></div></div>`).join("");
}
$("#wForm").onsubmit = async e => {
  e.preventDefault();
  const day = $("#w-date").value, kg = r1($("#w-kg").value);
  if (!day || !kg) return;
  const { error } = await sb.from("weights").upsert({ day, kg }, { onConflict: "user_id,day" });
  if (error) return dbFail(error, "save your weight");
  S.weights = { ...S.weights, [day]: kg }; renderWeight(); renderBell();
  $("#w-kg").value = ""; $("#wStatus").textContent = "Saved."; setTimeout(() => { $("#wStatus").textContent = ""; }, 1500);
};
$("#wList").addEventListener("click", e => {
  const b = e.target.closest("[data-delw]"); if (!b) return;
  armDelete(b, async () => {
    const { error } = await sb.from("weights").delete().eq("day", b.dataset.delw);
    if (error) return dbFail(error, "delete that weigh-in");
    const w = { ...S.weights }; delete w[b.dataset.delw]; S.weights = w; renderWeight(); renderBell();
  });
});

/* ---------- weekly review ---------- */
function renderReviewLabel() { const ds = weekDates(S.date); $("#rvLbl").textContent = `${fmtShort(ds[0])} – ${fmtShort(ds[6])}`; }
$("#rvGo").onclick = async () => {
  const ds = weekDates(S.date);
  $("#rvStatus").textContent = "Loading the week...";
  const { data: rows, error } = await sb.from("entries").select("day,meal,name,grams,kcal,p,c,f,checked").gte("day", ds[0]).lte("day", ds[6]);
  if (error) { $("#rvStatus").textContent = ""; return dbFail(error, "load the week"); }
  const byDay = Object.fromEntries(ds.map(d => [d, []])); rows.forEach(e => byDay[e.day]?.push(e));
  const logged = ds.filter(d => byDay[d].length);
  if (!logged.length) { $("#rvStatus").textContent = "Nothing logged this week yet."; $("#rvStats").innerHTML = ""; return; }
  const days = ds.map(d => { const t = totals(byDay[d]); return { date: d, weekday: new Date(d + "T00:00:00").toLocaleDateString("en", { weekday: "short" }), logged: byDay[d].length > 0,
    kcal: Math.round(t.kcal), p: Math.round(t.p), c: Math.round(t.c), f: Math.round(t.f), checkedKcal: Math.round(totals(byDay[d].filter(e => e.checked)).kcal) }; });
  const byFood = {};
  rows.forEach(e => { const k = e.name.toLowerCase(); (byFood[k] ||= { name: e.name, kcal: 0, times: 0, checked: e.checked }); byFood[k].kcal += nut(e).kcal; byFood[k].times++; });
  const top = Object.values(byFood).sort((a, b) => b.kcal - a.kcal).slice(0, 12).map(x => ({ ...x, kcal: Math.round(x.kcal) }));
  const byMeal = {}; rows.forEach(e => { byMeal[e.meal] = (byMeal[e.meal] || 0) + nut(e).kcal; });
  Object.keys(byMeal).forEach(k => { byMeal[k] = Math.round(byMeal[k] / logged.length); });
  const ld = days.filter(d => d.logged), avg = k => Math.round(ld.reduce((a, d) => a + d[k], 0) / ld.length);
  const totK = ld.reduce((a, d) => a + d.kcal, 0), chkK = ld.reduce((a, d) => a + d.checkedKcal, 0);
  const pctChecked = totK ? Math.round(chkK / totK * 100) : 0;
  const weighIns = ds.filter(d => S.weights[d] != null).map(d => ({ date: d, kg: S.weights[d] }));
  $("#rvStats").innerHTML = `<div class="stat"><div class="v num">${avg("kcal")}</div><div class="k">Avg kcal / logged day (target ${S.settings.kcal})</div></div>
    <div class="stat"><div class="v num">${avg("p")} g</div><div class="k">Avg protein (target ${S.settings.p})</div></div>
    <div class="stat"><div class="v num">${ld.length}/7</div><div class="k">Days logged</div></div>
    <div class="stat"><div class="v num">${pctChecked}%</div><div class="k">Calories from checked foods</div></div>`;
  S.rvCtl = new AbortController();
  $("#rvGo").disabled = true; $("#rvStop").hidden = false; $("#rvStatus").textContent = "Thinking..."; $("#rvText").textContent = "";
  try {
    const out = await api("/api/review", { method: "POST", signal: S.rvCtl.signal,
      body: { targets: S.settings, days, byMeal, top, pctChecked, weighIns } });
    $("#rvText").textContent = out.text || ""; $("#rvStatus").textContent = "";
  } catch (e) {
    $("#rvStatus").textContent = e.name === "AbortError" ? "" : (e.message || "Couldn't reach Claude. Try again.");
  } finally { $("#rvGo").disabled = false; $("#rvStop").hidden = true; }
};
$("#rvStop").onclick = () => S.rvCtl?.abort();

/* ---------- reminders (bell) ---------- */
function reminders() {
  const now = new Date(), today = ymd(now), yday = addDays(today, -1);
  const out = [];
  if (S.ydayCount === 0) out.push({ id: "yday-" + yday, t: "Nothing logged yesterday", s: "Fill it in while you still remember.", act: "Log yesterday", go: () => { setDate(yday); openTab("today"); } });
  if (S.todayCount === 0 && now.getHours() >= 20) out.push({ id: "today-" + today, t: "No food logged today", s: "Log today's meals before bed.", act: "Log now", go: () => { setDate(today); openTab("today"); } });
  const wk = weekDates(today);
  if (S.weightsLoaded && !wk.some(d => S.weights[d] != null)) out.push({ id: "wt-" + wk[0], t: "Weekly weigh-in due", s: "Weigh in after the toilet, before eating.", act: "Add weight", go: () => { openTab("weight"); $("#w-date").value = today; $("#w-kg").focus(); } });
  const dismissed = lsGet("timbang-dismissed") || {};
  return out.filter(r => !dismissed[r.id]);
}
function renderBell() {
  const list = reminders();
  $("#badge").textContent = list.length; $("#badge").hidden = !list.length;
  $("#bell").classList.toggle("on", list.length > 0);
  $("#bell").setAttribute("aria-label", list.length ? `Reminders, ${list.length} due` : "Reminders, none due");
  S.remList = list;
  $("#bellPanel").innerHTML = list.length ? list.map((r, i) => `<div class="rem"><div><div class="t">${esc(r.t)}</div><div class="s">${esc(r.s)}</div></div>
    <div class="acts"><button class="btn primary" data-go="${i}">${esc(r.act)}</button><button class="x" data-dis="${i}" aria-label="Dismiss">✕</button></div></div>`).join("")
    : `<div class="empty">All caught up.</div>`;
}
$("#bell").onclick = e => { e.stopPropagation(); const p = $("#bellPanel"); p.hidden = !p.hidden; $("#bell").setAttribute("aria-expanded", String(!p.hidden)); };
document.addEventListener("click", e => { if (!e.target.closest(".bellwrap")) { $("#bellPanel").hidden = true; $("#bell").setAttribute("aria-expanded", "false"); } });
$("#bellPanel").addEventListener("click", e => {
  const g = e.target.closest("[data-go]"), d = e.target.closest("[data-dis]");
  if (g) { S.remList[+g.dataset.go]?.go(); $("#bellPanel").hidden = true; }
  if (d) { const r = S.remList[+d.dataset.dis]; const m = lsGet("timbang-dismissed") || {}; m[r.id] = 1; lsSet("timbang-dismissed", m); renderBell(); }
});
setInterval(renderBell, 10 * 60 * 1000);

/* ---------- targets & account ---------- */
function fillTargets() { ["kcal", "p", "c", "f"].forEach(k => { $("#t-" + k).value = S.settings[k]; }); }
$("#tgtForm").onsubmit = async e => {
  e.preventDefault();
  const next = {}; ["kcal", "p", "c", "f"].forEach(k => { next[k] = Math.max(0, Math.round(+$("#t-" + k).value || 0)); });
  const { error } = await sb.from("settings").upsert({ user_id: S.user.id, ...next });
  if (error) return dbFail(error, "save targets");
  S.settings = next; renderDay(); renderWeek();
  $("#tgtStatus").textContent = "Saved."; setTimeout(() => { $("#tgtStatus").textContent = ""; }, 1500);
};
$("#signOut").onclick = async () => { await sb.auth.signOut(); };

/* ---------- tabs & dates ---------- */
document.querySelectorAll("nav.tabs button").forEach(b => { b.onclick = () => {
  document.querySelectorAll("nav.tabs button").forEach(x => x.setAttribute("aria-selected", String(x === b)));
  ["today", "foods", "meals", "weight", "review", "targets"].forEach(t => { $("#tab-" + t).hidden = t !== b.dataset.tab; });
}; });
function openTab(name) { document.querySelector(`nav.tabs button[data-tab="${name}"]`)?.click(); }
function setDate(d) {
  const wkChanged = weekDates(d)[0] !== weekDates(S.date)[0];
  S.date = d; $("#date").value = d; $("#w-date").value = d;
  S.entries = []; renderDay();
  loadDay(); if (wkChanged) loadWeek();
  renderReviewLabel();
  if (wkChanged) { $("#rvText").textContent = ""; $("#rvStats").innerHTML = ""; $("#rvStatus").textContent = ""; }
}
$("#date").onchange = e => e.target.value && setDate(e.target.value);
$("#prev").onclick = () => setDate(addDays(S.date, -1));
$("#next").onclick = () => setDate(addDays(S.date, 1));
$("#meal").value = (h => h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 22 ? "dinner" : "snack")(new Date().getHours());

// refresh when you come back to the app (keeps phone and desktop in step)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.user) { loadDay(); loadWeek(); loadWeights(); checkYesterday(); }
});

/* ---------- auth ---------- */
let pendingEmail = "";
$("#loginForm").onsubmit = async e => {
  e.preventDefault();
  pendingEmail = $("#loginEmail").value.trim();
  $("#loginSend").disabled = true; $("#loginStatus").textContent = "Sending...";
  const { error } = await sb.auth.signInWithOtp({ email: pendingEmail, options: { emailRedirectTo: location.origin, shouldCreateUser: true } });
  $("#loginSend").disabled = false;
  if (error) { $("#loginStatus").textContent = error.message; return; }
  $("#loginStatus").textContent = "Check your email. Tap the link, or enter the code here.";
  $("#codeBox").hidden = false; $("#loginCode").focus();
};
$("#loginVerify").onclick = async () => {
  const token = $("#loginCode").value.trim();
  if (!pendingEmail || !token) return;
  const { error } = await sb.auth.verifyOtp({ email: pendingEmail, token, type: "email" });
  if (error) $("#loginStatus").textContent = error.message;
};

let booted = false;
function showApp(user) {
  S.user = user;
  $("#loginView").hidden = true; $("#appView").hidden = false;
  $("#acctEmail").textContent = "Signed in as " + user.email;
  if (!booted) {
    booted = true;
    $("#date").value = S.date; $("#w-date").value = S.date;
    renderDay(); renderWeek(); renderFoods(); renderMeals(); fillTargets(); renderWeight(); renderReviewLabel(); renderBell();
    loadAll();
  }
}
function showLogin() {
  S.user = null; booted = false;
  S.entries = []; S.foods = {}; S.meals = []; S.weights = {}; S.week = {}; S.review = [];
  $("#appView").hidden = true; $("#loginView").hidden = false;
}
// supabase-js: don't call other Supabase methods inside this callback; defer them
sb.auth.onAuthStateChange((_ev, session) => {
  setTimeout(() => { session?.user ? showApp(session.user) : showLogin(); }, 0);
});

/* ---------- offline shell ---------- */
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => { }));
}
