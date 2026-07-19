// importa-alimenti.js
// Pipeline di importazione alimenti per Rotta 80 — nessuna dipendenza, solo Node.
//
// USO:
//   node importa-alimenti.js dati.csv                          (preset generico)
//   node importa-alimenti.js ABBREV.csv --preset=usda-abbrev   (file USDA SR "abbreviated")
//   opzioni: --app=index.html --out=nuovi-alimenti.js --report=report.csv --tolleranza=0.10
//
// PRESET GENERICO — intestazioni CSV riconosciute (separatore ; o , — decimali con virgola ok):
//   nome; categoria; kcal; proteine; carboidrati; grassi; [stagione]; [ruolo]
//   stagione: "6-9" oppure "6,7,8,9" (vuoto = tutto l'anno) · ruolo: p c v fr g x s b d
//
// CONTROLLI APPLICATI (in quest'ordine, ogni riga passa o finisce nel report con la ragione):
//   1. numeri validi e nei range di plausibilità (kcal 0-920, macro 0-100 g)
//   2. coerenza energetica: kcal ≈ 4·prot + 4·carb + 9·grassi (tolleranza ±10% o ±15 kcal)
//   3. duplicati contro il FOOD_DB già presente in index.html (nomi normalizzati)
//   4. duplicati interni al file importato
// Le voci accettate escono in formato FOOD_DB pronte da incollare; quelle senza categoria
// certa vengono marcate RIVEDI per la revisione umana (o del comitato scientifico).

const fs = require("fs");

/* ---------- argomenti ---------- */
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"));
const opt = k => (args.find(a => a.startsWith("--" + k + "=")) || "").split("=")[1];
const PRESET = opt("preset") || "generico";
const APP = opt("app") || "index.html";
const OUT = opt("out") || "nuovi-alimenti.js";
const REPORT = opt("report") || "report.csv";
const TOL = parseFloat(opt("tolleranza") || "0.10");
if (!file) { console.error("Uso: node importa-alimenti.js <file.csv> [--preset=generico|usda-abbrev]"); process.exit(1); }

/* ---------- util ---------- */
const norm = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\(.*?\)/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const num = v => { if (v == null) return NaN; const n = parseFloat(String(v).replace(",", ".").trim()); return isNaN(n) ? NaN : n; };

function parseCSV(txt) {
  const lines = txt.replace(/\r/g, "").split("\n").filter(l => l.trim());
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
  const split = l => { const out = []; let cur = "", q = false;
    for (const ch of l) { if (ch === '"') q = !q;
      else if (ch === sep && !q) { out.push(cur); cur = ""; }
      else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
  const head = split(lines[0]).map(h => norm(h));
  return lines.slice(1).map(l => { const cells = split(l); const row = {};
    head.forEach((h, i) => row[h] = cells[i]); return row; });
}

/* ---------- mappature preset ---------- */
function extract(row) {
  if (PRESET === "usda-abbrev") {
    return { nome: row["shrt desc"] || row["shrt_desc"] || row["descrip"] || "",
      kcal: num(row["energ kcal"] ?? row["energ_kcal"]),
      p: num(row["protein g"] ?? row["protein_(g)"] ?? row["protein"]),
      c: num(row["carbohydrt g"] ?? row["carbohydrt_(g)"] ?? row["carbohydrate"]),
      f: num(row["lipid tot g"] ?? row["lipid_tot_(g)"] ?? row["fat"]),
      categoria: "", stagione: "", ruolo: "", nota: "TRADUCI" };
  }
  return { nome: row["nome"] || row["alimento"] || row["name"] || "",
    kcal: num(row["kcal"] ?? row["energia"] ?? row["calorie"]),
    p: num(row["proteine"] ?? row["prot"] ?? row["protein"]),
    c: num(row["carboidrati"] ?? row["carb"] ?? row["carbo"]),
    f: num(row["grassi"] ?? row["lipidi"] ?? row["fat"]),
    categoria: (row["categoria"] || "").toLowerCase(),
    stagione: row["stagione"] || "", ruolo: (row["ruolo"] || "").toLowerCase(), nota: "" };
}

/* ---------- euristiche categoria/ruolo ---------- */
const CAT_RULES = [
  [/pesce|orata|branzino|merluzz|tonno|salmon|sgombro|alic|sardin|trota|polp|calamar|sepp|gamber|cozz|vongol|acciug/, ["pesce", "p"]],
  [/pollo|tacchin|manzo|vitell|maiale|suino|bovin|agnell|conigl|salsicc/, ["carne", "p"]],
  [/prosciutt|bresaol|speck|salame|mortadell|coppa|pancett|guancial/, ["salumi", "p"]],
  [/yogurt|latte|formagg|mozzarell|ricott|parmigian|grana|pecorin|skyr|kefir|scamorz|stracchin|burrat|feta|fiocchi/, ["latticini", "p"]],
  [/uovo|uova|albume/, ["uova", "p"]],
  [/fagiol|lenticch|cec[io]|fave|pisell|lupin|soia|legum/, ["legumi", "p"]],
  [/pasta|riso|farro|orzo|pane|farina|couscous|quinoa|avena|cereal|grissin|crackers?|fett[ae] biscottat|polenta|gnocch/, ["cereali", "c"]],
  [/mandorl|noc[ei]|nocciol|pistacch|anacard|pinol|semi di|arachid/, ["fruttasecca", "s"]],
  [/mela|pera|aranc|banana|kiwi|fragol|cilieg|pesc[ah]|albicocc|uva|fico|melon|anguri|mirtill|lampon|frutt/, ["frutta", "fr"]],
  [/olio|aceto|burro|salsa|pesto|maiones|senape|passata|pelati|concentrat|miele|marmellat|zuccher/, ["condimenti", "g"]],
  [/pomodor|zucchin|melanzan|peperon|insalat|lattug|spinac|broccol|cavol|carot|cipoll|zucca|carciof|asparag|verdur|bietol|cicoria|rucola|sedano|funghi/, ["verdura", "v"]],
  [/acqua|succo|te |the |caffe|birra|vino|bibita|bevanda/, ["bevande", "b"]],
  [/biscott|torta|crostat|gelato|cioccolat|dolce|merendin|brioche|cornett/, ["dolci", "d"]],
];
function guessCat(nome) { const n = norm(nome);
  for (const [re, v] of CAT_RULES) if (re.test(n)) return v; return ["", ""]; }

/* ---------- carica FOOD_DB esistente per dedup ---------- */
let existing = new Set();
try {
  const app = fs.readFileSync(APP, "utf8");
  const m = app.match(/const FOOD_DB=\[([\s\S]*?)\n\];/);
  if (m) for (const line of m[1].split("\n")) {
    const n = line.match(/^\["([^"]+)"/); if (n) existing.add(norm(n[1]));
  }
  console.log(`FOOD_DB esistente: ${existing.size} voci caricate da ${APP} per il controllo duplicati`);
} catch (e) { console.warn(`⚠ ${APP} non trovato: salto il controllo duplicati contro l'app`); }

/* ---------- elaborazione ---------- */
const rows = parseCSV(fs.readFileSync(file, "utf8"));
const ok = [], ko = [], seen = new Set();
let daRivedere = 0;

for (const [idx, row] of rows.entries()) {
  const r = extract(row);
  const riga = idx + 2;
  const scarta = motivo => ko.push({ riga, nome: r.nome || "(vuoto)", motivo });

  if (!r.nome) { scarta("nome mancante"); continue; }
  if ([r.kcal, r.p, r.c, r.f].some(isNaN)) { scarta("valori numerici mancanti o non validi"); continue; }
  if (r.kcal < 0 || r.kcal > 920) { scarta(`kcal fuori range (${r.kcal})`); continue; }
  if ([r.p, r.c, r.f].some(v => v < 0 || v > 100)) { scarta("macro fuori range 0-100 g"); continue; }

  /* coerenza energetica (saltata per alimenti quasi acalorici tipo acqua, tè, brodo) */
  const calc = 4 * r.p + 4 * r.c + 9 * r.f;
  if (r.kcal >= 20 && Math.abs(calc - r.kcal) / r.kcal > TOL && Math.abs(calc - r.kcal) > 15) {
    scarta(`incoerenza energetica: dichiarate ${r.kcal} kcal, dai macro ${Math.round(calc)}`); continue;
  }

  const key = norm(r.nome);
  if (existing.has(key)) { scarta("duplicato: già nel FOOD_DB dell'app"); continue; }
  if (seen.has(key)) { scarta("duplicato interno al file"); continue; }
  seen.add(key);

  let [cat, ruolo] = r.categoria && r.ruolo ? [r.categoria, r.ruolo] : guessCat(r.nome);
  if (r.categoria) cat = r.categoria;
  if (r.ruolo) ruolo = r.ruolo;
  let flag = r.nota ? [r.nota] : [];
  if (!cat || !ruolo) { cat = cat || "daClassificare"; ruolo = ruolo || "x"; flag.push("RIVEDI categoria/ruolo"); daRivedere++; }

  let stag = "0";
  if (r.stagione) {
    const mm = r.stagione.includes("-")
      ? (() => { const [a, b] = r.stagione.split("-").map(Number); const out = [];
          for (let m2 = a; ; m2 = m2 % 12 + 1) { out.push(m2); if (m2 === b) break; } return out; })()
      : r.stagione.split(/[,; ]+/).map(Number).filter(Boolean);
    if (mm.length && mm.length < 12) stag = "[" + mm.join(",") + "]";
  }

  ok.push({ line: `["${r.nome.replace(/"/g, "'")}","${cat}",${r.kcal},${r.p},${r.c},${r.f},${stag},"${ruolo}"],` +
    (flag.length ? ` /* ${flag.join(" · ")} */` : ""), flag: flag.length > 0 });
}

/* ---------- output ---------- */
fs.writeFileSync(OUT,
  `/* nuovi-alimenti.js — generato da importa-alimenti.js il ${new Date().toISOString().slice(0, 10)}\n` +
  `   Righe da APPENDERE dentro const FOOD_DB=[...] in index.html (prima di "];").\n` +
  `   Voci accettate: ${ok.length} · scartate: ${ko.length} · da rivedere: ${daRivedere}\n` +
  `   Le voci marcate RIVEDI vanno controllate a mano (categoria, ruolo, stagione, fascia pasto). */\n\n` +
  ok.map(o => o.line).join("\n") + "\n");

fs.writeFileSync(REPORT, "\ufeffriga;nome;motivo_scarto\n" +
  ko.map(k => `${k.riga};"${k.nome.replace(/"/g, "'")}";"${k.motivo}"`).join("\n") + "\n");

console.log(`\n═══ RISULTATO ═══`);
console.log(`✅ Accettate:   ${ok.length} voci  →  ${OUT}`);
console.log(`⚠️  Da rivedere: ${daRivedere} (marcate RIVEDI nel file di output)`);
console.log(`❌ Scartate:    ${ko.length}  →  ${REPORT}`);
if (ko.length) { console.log(`\nPrime cause di scarto:`);
  const causes = {}; ko.forEach(k => { const c = k.motivo.split(":")[0]; causes[c] = (causes[c] || 0) + 1; });
  Object.entries(causes).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`   ${n}× ${c}`)); }
