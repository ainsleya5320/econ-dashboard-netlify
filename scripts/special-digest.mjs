#!/usr/bin/env node
// ============================================================================
// SPECIAL SITUATIONS DIGEST — build the feed, score it, email what is new.
//
// Runs from GitHub Actions on weekday mornings (.github/workflows/special-
// digest.yml) or by hand:
//   node scripts/special-digest.mjs            build, score, send
//   node scripts/special-digest.mjs --dry-run  write special-digest-preview.html
//                                              instead of sending; state untouched
// Environment:
//   FMP_KEY            the dashboard's FMP key (insider buys, 13D stakes, caps)
//   RESEND_API_KEY     Resend, the same service the WARN digest uses
//   DIGEST_TO_EMAIL    where it goes
//   DIGEST_FROM_EMAIL  sender (default onboarding@resend.dev, which Resend only
//                      delivers to the account owner's own address)
//   MIN_SCORE          email ideas scoring at least this (default 50)
//   RESCORE_JUMP       re-send an idea whose score has risen this much (default 15)
//   STATE_FILE         what has been sent (default state/special-digest.json)
// An idea is emailed once. It comes back only if its score jumps — a second
// insider cluster, a 13D landing on a name already on the buyback board.
// Locally, ideas dismissed on the Top ideas view are skipped too.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSpecialSituations } from '../server/specialSituations.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Local runs read keys from the dashboard's own .env; Actions passes secrets.
function envFile() {
  try {
    return Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)
      .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]))
  } catch { return {} }
}
const local = envFile()
const FMP_KEY = process.env.FMP_KEY || local.FMP_KEY || local.VITE_FMP_KEY || ''
const MIN_SCORE = Number(process.env.MIN_SCORE || 50)
const JUMP = Number(process.env.RESCORE_JUMP || 15)
const STATE_FILE = path.resolve(ROOT, process.env.STATE_FILE || 'state/special-digest.json')

async function fetchYahooSparkline(symbol, range = '1mo', interval = '1d') {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`, { headers: { 'User-Agent': UA } })
    if (!r.ok) return []
    const res = (await r.json())?.chart?.result?.[0]
    const ts = res?.timestamp || [], closes = res?.indicators?.quote?.[0]?.close || []
    return ts.map((t, i) => ({ ts: t * 1000, v: closes[i] })).filter(p => p.v != null)
  } catch { return [] }
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const CAT = { spinoff: 'Spin-off', merger: 'Merger arb', reorg: 'Post-reorg', rights: 'Rights offering', recap: 'Recap', insider: 'Insider buying', '13D': 'Activist 13D', spac: 'SPAC', buyback: 'Buyback' }
const GRADE_COLOR = { A: '#15803d', B: '#0e7490', C: '#64748b' }

function render(ideas, feed) {
  const rows = ideas.map(i => {
    const links = [
      i.url && `<a href="${esc(i.url)}" style="color:#1d4ed8">filing</a>`,
      i.ticker && `<a href="https://finance.yahoo.com/quote/${encodeURIComponent(i.ticker)}" style="color:#1d4ed8">quote</a>`,
      i.ticker && `<a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=${encodeURIComponent(i.ticker)}&amp;type=&amp;dateb=&amp;owner=include&amp;count=40" style="color:#1d4ed8">all filings</a>`,
    ].filter(Boolean).join(' · ')
    const reasons = i.reasons.slice(0, 5).map(r => `<div style="font-size:13px;color:#334155;line-height:1.5"><span style="color:#15803d;display:inline-block;width:34px">+${r.pts}</span>${esc(r.why)}</div>`).join('')
    const risks = i.risks.map(r => `<div style="font-size:13px;color:#b45309;line-height:1.5"><span style="display:inline-block;width:34px">${r.pts}</span>${esc(r.why)}</div>`).join('')
    const cat = i.catalyst ? ` · <b>${esc(i.catalyst.label)} ${esc(i.catalyst.date)}</b>` : ''
    return `
      <tr><td style="padding:14px 0;border-bottom:1px solid #e2e8f0">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
          <td width="56" valign="top"><div style="width:46px;height:46px;border-radius:23px;border:2px solid ${GRADE_COLOR[i.grade] || '#64748b'};color:${GRADE_COLOR[i.grade] || '#64748b'};font:700 17px/46px Arial,sans-serif;text-align:center">${i.score}</div></td>
          <td valign="top">
            <div style="font:12px Arial,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.5px">${esc(CAT[i.cat] || i.cat)} · grade ${esc(i.grade)} · ${esc(i.verdict)}${cat}</div>
            <div style="font:700 16px Arial,sans-serif;color:#0f172a;margin-top:2px">${esc(i.ticker || '—')} <span style="font-weight:400;color:#334155">${esc(i.name)}</span></div>
            <div style="font:14px Arial,sans-serif;color:#0f172a;margin:4px 0 6px">${esc(i.headline)}</div>
            <div style="font-family:Arial,sans-serif">${reasons}${risks}</div>
            <div style="font:12px Arial,sans-serif;margin-top:6px">${links}</div>
          </td>
        </tr></table>
      </td></tr>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:24px;background:#f8fafc">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px">
      <tr><td style="padding:20px 24px 6px">
        <div style="font:12px Arial,sans-serif;color:#64748b;text-transform:uppercase;letter-spacing:.6px">Special situations · new ideas</div>
        <div style="font:700 20px Arial,sans-serif;color:#0f172a;margin-top:4px">${ideas.length} new idea${ideas.length === 1 ? '' : 's'} scoring ${MIN_SCORE}+</div>
        <div style="font:13px Arial,sans-serif;color:#475569;margin-top:6px;line-height:1.5">Ranked on situation quality, freshness, a catalyst inside six weeks and confluence across boards. A ≥ 60 research now, B ≥ 45 worth a look. Every point is listed with its reason; the parsed terms are regular-expression matches on the filing, so read the filing before acting.</div>
      </td></tr>
      <tr><td style="padding:0 24px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table></td></tr>
      <tr><td style="padding:14px 24px 20px;font:11px Arial,sans-serif;color:#94a3b8;line-height:1.5">Feed built ${esc(feed.built)} from SEC EDGAR full-text search, FMP insider and ownership data and Yahoo quotes. Research leads, not recommendations. Sent by the econ-dashboard digest; each idea is sent once unless its score rises by ${JUMP}+.</td></tr>
    </table></body></html>`
}

function text(ideas) {
  return ideas.map(i => `${i.score} (${i.grade}) ${CAT[i.cat] || i.cat} — ${i.ticker || ''} ${i.name}\n${i.headline}\n${i.reasons.slice(0, 5).map(r => `  +${r.pts} ${r.why}`).join('\n')}${i.risks.length ? '\n' + i.risks.map(r => `  ${r.pts} ${r.why}`).join('\n') : ''}\n${i.url || ''}`).join('\n\n')
}

async function send(subject, html, body) {
  const key = process.env.RESEND_API_KEY, to = process.env.DIGEST_TO_EMAIL
  if (!key || !to) throw new Error('RESEND_API_KEY and DIGEST_TO_EMAIL must be set to send')
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.DIGEST_FROM_EMAIL || 'Special situations <onboarding@resend.dev>', to: [to], subject, html, text: body }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Resend ${r.status}: ${j.message || j.name || 'send failed'}`)
  return j.id
}

async function main() {
  if (!FMP_KEY) console.warn('digest: no FMP key — insider buying, 13D stakes and buyback sizes will be thin')
  const svc = createSpecialSituations({ fetchYahooSparkline, FMP_KEY, UA, dir: ROOT, bankruptcy: async () => null })
  const t0 = Date.now()
  const feed = await svc.get()
  const failed = Object.entries(feed.status || {}).filter(([, v]) => v !== 'ok')
  console.log(`digest: feed ${feed.built} (${Math.round((Date.now() - t0) / 1000)}s) · ${feed.ideas.length} ideas scored${failed.length ? ` · partial: ${failed.map(([k]) => k).join(', ')}` : ''}`)

  let state = { sent: {} }
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch {}
  state.sent = state.sent || {}
  let dismissed = new Set()
  try { dismissed = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'special-dealbook.json'), 'utf8')).dismissed || []) } catch {}

  const fresh = feed.ideas.filter(i => i.score >= MIN_SCORE && !dismissed.has(i.id) && (!state.sent[i.id] || i.score >= state.sent[i.id].score + JUMP))
  console.log(`digest: ${fresh.length} new at ${MIN_SCORE}+ (${feed.ideas.filter(i => i.score >= MIN_SCORE).length} on the list, ${Object.keys(state.sent).length} sent before)`)
  if (!fresh.length) return

  const top = fresh[0]
  const subject = `Special situations: ${fresh.length} new idea${fresh.length === 1 ? '' : 's'} — top ${top.ticker || top.name} ${top.score} (${CAT[top.cat] || top.cat})`
  const html = render(fresh, feed)
  if (DRY) {
    const out = path.join(ROOT, 'special-digest-preview.html')
    fs.writeFileSync(out, html)
    console.log(`digest: dry run — wrote ${path.relative(ROOT, out)} · subject "${subject}"`)
    return
  }
  const id = await send(subject, html, text(fresh))
  console.log(`digest: sent ${fresh.length} idea(s), Resend id ${id}`)
  const now = new Date().toISOString().slice(0, 10)
  for (const i of fresh) state.sent[i.id] = { score: i.score, at: now, ticker: i.ticker }
  const cutoff = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10)
  for (const [k, v] of Object.entries(state.sent)) if (v.at < cutoff) delete state.sent[k]
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1))
}

main().catch(e => { console.error('digest failed:', e.message); process.exit(1) })
