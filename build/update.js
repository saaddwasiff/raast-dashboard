/*
 * Rebuilds the data embedded in index.html from files dropped into data/inbox/.
 *  - SBP monthly Raast workbook (.xlsx with P2P / P2M / Bulk sheets)
 *  - SBP Payment Systems Review PDFs (quarterly)
 *  - optional: Raast PSR template (.xlsx with a Raast_Quarterly sheet)
 * Processed files move to data/processed/<date>/. A summary is written to data/last-update.md.
 * Exits with code 1 (and changes nothing) if any file cannot be read correctly.
 */
const fs = require('fs');
const path = require('path');
global.XLSX = require('xlsx');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const { parseMonthly, parsePSR } = require('./lib/parse.js');
const { psrLines, parsePSRText, mergePSR } = require('./lib/pdfparse.js');
const { derive } = require('./lib/compute.js');

const ROOT = path.resolve(__dirname, '..');
const INBOX = path.join(ROOT, 'data', 'inbox');
const INDEX = path.join(ROOT, 'index.html');
const DATA_RE = /(<script type="application\/json" id="raast-data"[^>]*>)([\s\S]*?)(<\/script>)/;

function qIndex(q) { const m = q.match(/Q(\d) FY(\d+)/); return +m[2] * 4 + +m[1]; }
function pct(x) { return (x * 100).toFixed(1) + '%'; }

(async () => {
  const files = fs.existsSync(INBOX) ? fs.readdirSync(INBOX).filter(f => !f.startsWith('.') && /\.(xlsx|xls|pdf)$/i.test(f)) : [];
  if (!files.length) { console.log('No new files in data/inbox. Nothing to do.'); return; }

  const html = fs.readFileSync(INDEX, 'utf8');
  const m = html.match(DATA_RE);
  if (!m) throw new Error('Could not find the embedded data block in index.html');
  const before = JSON.parse(m[2].replace(/\\u003c/g, '<'));
  const D = JSON.parse(JSON.stringify(before));
  const notes = [], errors = [];
  let warnings = [];

  // 1. Excel files
  for (const f of files.filter(f => /\.xlsx?$/i.test(f))) {
    const wb = XLSX.read(fs.readFileSync(path.join(INBOX, f)), { type: 'buffer' });
    if (wb.SheetNames.some(s => /p2p/i.test(s))) {
      const M = parseMonthly(wb);
      warnings = warnings.concat(M.warnings.map(w => ({ ...w, msg: f + ': ' + w.msg })));
      if (M.monthly.length) {
        D.monthly = M.monthly; D.cumulative = M.cumulative || D.cumulative; D.meta.monthlyFile = f;
        notes.push(`${f}: monthly data to ${M.monthly[M.monthly.length - 1].m} (${M.monthly.length} months).`);
      } else errors.push(`${f}: no monthly rows could be read.`);
    } else if (wb.SheetNames.some(s => /raast_?q/i.test(s))) {
      const P = parsePSR(wb);
      warnings = warnings.concat(P.warnings.map(w => ({ ...w, msg: f + ': ' + w.msg })));
      if (P.quarterly.length && P.channels.length) {
        Object.assign(D, { quarterly: P.quarterly, channels: P.channels, eco: P.eco, annual: P.annual });
        D.meta.psrFile = f; notes.push(`${f}: PSR template loaded (${P.quarterly.length} quarters).`);
      } else errors.push(`${f}: PSR template has no usable rows.`);
    } else errors.push(`${f}: not recognised (expected the SBP monthly Raast workbook or the PSR template).`);
  }

  // 2. PSR PDFs, oldest issue first so the newest revisions win
  const pdfs = [];
  for (const f of files.filter(f => /\.pdf$/i.test(f))) {
    const lines = await psrLines(pdfjs, new Uint8Array(fs.readFileSync(path.join(INBOX, f))));
    pdfs.push({ f, R: parsePSRText(lines) });
  }
  pdfs.sort((a, b) => (a.R.latest ? qIndex(a.R.latest) : 0) - (b.R.latest ? qIndex(b.R.latest) : 0));
  for (const { f, R } of pdfs) {
    R.warnings.forEach(w => (w.lvl === 'error' ? errors : warnings).push(w.lvl === 'error' ? `${f}: ${w.msg}` : { ...w, msg: `${f}: ${w.msg}` }));
    if (!R.latest) { errors.push(`${f}: no PSR annexure tables found.`); continue; }
    const res = mergePSR(D, R, 'PSR ' + R.latest.replace(' ', '') + ' (PDF)');
    notes.push(`${f}: ${R.latest} issue read, covering ${Object.keys(R.channels).sort((a, b) => qIndex(a) - qIndex(b)).join(', ')}.`);
    res.changed.forEach(c => notes.push(`  updated ${c}`));
    if (res.skipped.length) notes.push(`  kept newer figures already on file for ${res.skipped.join(', ')}`);
    D.meta.psrFile = f;
  }

  // 3. Validate by computing everything the dashboard shows
  let X = null;
  try { X = derive(D); } catch (e) { errors.push('Dashboard calculations failed: ' + e.message); }
  const report = [];
  const now = new Date().toISOString().slice(0, 10);
  report.push(`# Last dashboard update: ${now}`, '');
  report.push('Files: ' + files.join(', '), '');
  if (errors.length) {
    report.push('## Not applied: fix these and upload again', '', ...errors.map(e => '- ' + e), '');
    fs.writeFileSync(path.join(ROOT, 'data', 'last-update.md'), report.join('\n'));
    console.error(report.join('\n'));
    process.exitCode = 1;
    return;
  }
  const OX = derive(before), lc = X.ch[X.ch.length - 1], olc = OX.ch[OX.ch.length - 1];
  report.push('## Summary', '',
    `| | Before | After |`, `|---|---|---|`,
    `| Latest month | ${OX.m[OX.m.length - 1].m} | ${X.m[X.m.length - 1].m} |`,
    `| Latest PSR quarter | ${olc.q} | ${lc.q} |`,
    `| Raast share of digital volume (latest quarter) | ${pct(olc.share_v)} | ${pct(lc.share_v)} |`,
    `| Raast share of digital value (latest quarter) | ${pct(olc.share_val)} | ${pct(lc.share_val)} |`, '');
  report.push('## What was read', '', ...notes.map(n => (n.startsWith('  ') ? '  - ' + n.trim() : '- ' + n)), '');
  if (warnings.length) report.push('## Checks to confirm with SBP', '', ...warnings.map(w => '- ' + w.msg), '');

  // 4. Write index.html and move processed files
  D.meta.updated = now;
  D.warnings = warnings.map(w => ({ lvl: w.lvl, msg: w.msg.replace(/^[^:]+\.(xlsx|xls|pdf): /i, '') }));
  const json = JSON.stringify(D).replace(/</g, '\\u003c');
  fs.writeFileSync(INDEX, html.replace(DATA_RE, (_, a, __, c) => a + json + c));
  const dest = path.join(ROOT, 'data', 'processed', now);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) fs.renameSync(path.join(INBOX, f), path.join(dest, f));
  fs.writeFileSync(path.join(ROOT, 'data', 'last-update.md'), report.join('\n'));
  console.log(report.join('\n'));
})().catch(e => { console.error(e); process.exitCode = 1; });
