import { createHmac } from 'node:crypto';
import axios from 'axios';

const BASE_URL = process.env.OKX_API_BASE_URL ?? 'https://www.okx.com';
const key = process.env.OKX_API_KEY ?? '';
const secret = process.env.OKX_API_SECRET ?? '';
const pass = process.env.OKX_API_PASSPHRASE ?? '';
const simulated = process.env.OKX_SIMULATED === 'true';

const client = axios.create({ baseURL: BASE_URL, timeout: 15000 });

function fromInstId(instId) {
  const p = String(instId).trim().toUpperCase().split('-');
  return p.length < 2 ? String(instId).toUpperCase() : `${p[0]}${p[1]}`;
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

async function get(path, query = {}, signed = true) {
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const qs = entries.map(([k, v]) => `${k}=${v}`).join('&');
  const requestPath = qs ? `${path}?${qs}` : path;
  const headers = { 'Content-Type': 'application/json' };
  if (simulated) headers['x-simulated-trading'] = '1';
  if (signed) {
    const ts = new Date().toISOString();
    headers['OK-ACCESS-KEY'] = key;
    headers['OK-ACCESS-SIGN'] = createHmac('sha256', secret).update(`${ts}GET${requestPath}`).digest('base64');
    headers['OK-ACCESS-TIMESTAMP'] = ts;
    headers['OK-ACCESS-PASSPHRASE'] = pass;
  }
  const res = await client.get(requestPath, { headers });
  if (res.data?.code != null && res.data.code !== '0') {
    throw new Error(`OKX ${path} ${res.data.code}: ${res.data.msg}`);
  }
  return res.data.data;
}

const ctValCache = new Map();
async function ctValOf(symbol) {
  if (ctValCache.has(symbol)) return ctValCache.get(symbol);
  const base = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  const instId = `${base}-USDT-SWAP`;
  const rows = await get('/api/v5/public/instruments', { instType: 'SWAP', instId }, false);
  const row = (rows ?? []).find((r) => r.instId === instId) ?? rows?.[0];
  const v = num(row?.ctVal) > 0 ? num(row.ctVal) : 1;
  ctValCache.set(symbol, v);
  return v;
}

const rows = await get('/api/v5/account/positions', { instType: 'SWAP' });
const open = (rows ?? []).filter((p) => Math.abs(num(p.pos)) > 0);
const out = [];
for (const r of open) {
  const symbol = fromInstId(r.instId ?? '');
  const ctVal = await ctValOf(symbol).catch(() => 1);
  const signedPos = num(r.pos);
  const side = (r.posSide === 'long' || r.posSide === 'short') ? r.posSide : (signedPos < 0 ? 'short' : 'long');
  out.push({
    posId: String(r.posId ?? ''),
    externalId: `okx-${r.posId}`,
    symbol,
    side,
    entryPrice: num(r.avgPx),
    quantity: Math.abs(signedPos) * ctVal,
    leverage: num(r.lever) > 0 ? num(r.lever) : null,
    openedAtMs: num(r.cTime),
    openedAt: new Date(num(r.cTime)).toISOString(),
  });
}
console.log(JSON.stringify(out, null, 2));
