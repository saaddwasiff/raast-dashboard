/*
 * Looks for Payment Systems Review issues on SBP's website that the dashboard has not seen yet,
 * and downloads them into data/inbox/ so build/update.js reads them in the same run.
 *
 * Where SBP publishes:
 *   https://www.sbp.org.pk/our-operations/publications/payment-systems-review/365
 *     -> one sub-page per fiscal year ("Payment Systems Quarterly Reports 2025 - 2026")
 *        -> "Download" links such as /assets/document/publications/PS-Review-Q3FY26.pdf
 *
 * As a fallback (if SBP changes the page layout) it also tries the predictable PDF address
 * for the next expected issue directly.
 *
 * data/psr-seen.json records which issues have already been taken, so nothing is downloaded twice.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INBOX = path.join(ROOT, 'data', 'inbox');
const SEEN = path.join(ROOT, 'data', 'psr-seen.json');
const BASE = 'https://www.sbp.org.pk';
const LANDING = BASE + '/our-operations/publications/payment-systems-review/365';
const PDF_RE = /href="([^"]*PS-?Review-?Q([1-4])\s*-?FY\s*-?(\d{2})[^"]*\.pdf)"/gi;
const YEAR_RE = /href="([^"]*payment-systems-quarterly-reports-(\d{4})-(\d{4})[^"]*)"/gi;

const issueIdx = (q, fy) => +fy * 4 + +q;
const issueName = idx => `Q${((idx - 1) % 4) + 1}FY${String(Math.floor((idx - 1) / 4)).padStart(2, '0')}`;
const abs = u => (u.startsWith('http') ? u : BASE + (u.startsWith('/') ? '' : '/') + u);

async function get(url, binary) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (raast-dashboard update check)' }, redirect: 'follow' });
  if (!r.ok) { const e = new Error(`${r.status} for ${url}`); e.status = r.status; throw e; }
  return binary ? Buffer.from(await r.arrayBuffer()) : r.text();
}

function latestOnDashboard() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/id="raast-data"[^>]*>([\s\S]*?)<\/script>/);
  const D = JSON.parse(m[1].replace(/\\u003c/g, '<'));
  let best = 0;
  for (const r of D.quarterly.concat(D.channels)) {
    const s = String(r.src || ''); let x; const re = /Q\s*([1-4])\s*-?\s*FY\s*-?\s*(\d{2})/gi;
    while ((x = re.exec(s))) best = Math.max(best, issueIdx(x[1], x[2]));
  }
  return best;
}

(async () => {
  fs.mkdirSync(INBOX, { recursive: true });
  const seen = fs.existsSync(SEEN) ? JSON.parse(fs.readFileSync(SEEN, 'utf8')) : { issues: [] };
  const have = new Set(seen.issues);
  const floor = Math.max(latestOnDashboard(), ...seen.issues.map(n => { const m = n.match(/Q(\d)FY(\d+)/); return issueIdx(m[1], m[2]); }), 0);
  console.log(`Newest PSR issue already used: ${floor ? issueName(floor) : 'none'}`);

  // 1. Read SBP's pages
  const found = new Map(); // idx -> url
  let pageOk = false;
  try {
    const landing = await get(LANDING);
    const years = []; let m;
    while ((m = YEAR_RE.exec(landing))) years.push({ url: abs(m[1]), end: +m[3] });
    years.sort((a, b) => b.end - a.end);
    for (const y of years.slice(0, 2)) {           // the current and previous fiscal year are enough
      const page = await get(y.url);
      while ((m = PDF_RE.exec(page))) found.set(issueIdx(m[2], m[3]), abs(m[1]));
    }
    pageOk = years.length > 0;
    if (!pageOk) console.log('Warning: no fiscal-year pages found on the SBP Payment Systems Review page. Its layout may have changed.');
  } catch (e) {
    console.log('Warning: could not read the SBP page: ' + e.message);
  }

  // 2. Fallback: try the predictable address for the next two expected issues
  for (const idx of [floor + 1, floor + 2]) {
    if (found.has(idx)) continue;
    const n = issueName(idx);
    for (const u of [`${BASE}/assets/document/publications/PS-Review-${n}.pdf`, `${BASE}/assets/document/publications/reports/PS-Review-${n}.pdf`]) {
      try { const r = await fetch(u, { method: 'HEAD' }); if (r.ok) { found.set(idx, u); break; } } catch (_) { /* not published yet */ }
    }
  }

  // 3. Download anything newer than what the dashboard already has
  const fresh = [...found.entries()].filter(([idx]) => idx > floor && !have.has(issueName(idx))).sort((a, b) => a[0] - b[0]);
  if (!fresh.length) {
    console.log('No new Payment Systems Review on SBP yet.');
    if (!pageOk) process.exitCode = 1;   // make a broken page visible in the Actions tab
    return;
  }
  for (const [idx, url] of fresh) {
    const buf = await get(url, true);
    if (buf.slice(0, 4).toString() !== '%PDF') throw new Error(`${url} did not return a PDF`);
    const name = `PS-Review-${issueName(idx)}.pdf`;
    fs.writeFileSync(path.join(INBOX, name), buf);
    seen.issues.push(issueName(idx));
    console.log(`Downloaded ${name} from ${url}`);
  }
  fs.writeFileSync(SEEN, JSON.stringify(seen, null, 2) + '\n');
})().catch(e => { console.error(e.message || e); process.exitCode = 1; });
