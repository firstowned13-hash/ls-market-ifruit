import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const db = new Database(path.join(__dirname, 'marketplace.db'));

const PORT = Number(process.env.PORT || 3000);
const APP_ORIGIN = process.env.APP_ORIGIN || '';
const API_BASE = (process.env.API_BASE || '').replace(/\/$/, '');
const MERCHANT_KEY = process.env.IFRUIT_MERCHANT_KEY || '';
const LISTING_FEE = Number(process.env.LISTING_FEE || 500);
const BOOST_FEE = Number(process.env.BOOST_FEE || 750);
const BOOST_HOURS = Number(process.env.BOOST_HOURS || 24);
const ADMIN_KEY = process.env.ADMIN_KEY || '';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: APP_ORIGIN || true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  seller_username TEXT NOT NULL,
  phone TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price INTEGER NOT NULL,
  category TEXT NOT NULL,
  images_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  boosted_until INTEGER,
  payment_transaction_id TEXT,
  boost_transaction_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_boosted ON listings(boosted_until);
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  transaction_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}
function cleanImages(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(v => typeof v === 'string' && /^https:\/\//i.test(v)).slice(0, 10);
}
function cleanUsername(v) {
  return cleanText(v, 64).replace(/[^a-zA-Z0-9_.-]/g, '');
}

async function unitedFetch(endpoint, options = {}) {
  if (!API_BASE || !MERCHANT_KEY) {
    throw new Error('Payment API is not configured');
  }
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MERCHANT_KEY}`,
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) {
    const err = new Error(body?.error || `United API error ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

app.get('/api/config', (req, res) => {
  res.json({ listingFee: LISTING_FEE, boostFee: BOOST_FEE, boostHours: BOOST_HOURS });
});

app.get('/api/listings', (req, res) => {
  const now = Date.now();
  const q = cleanText(req.query.q, 80).toLowerCase();
  const category = cleanText(req.query.category, 40);
  let rows = db.prepare(`SELECT * FROM listings WHERE status='active'`).all();
  if (category && category !== 'Todos') rows = rows.filter(r => r.category === category);
  if (q) rows = rows.filter(r => `${r.title} ${r.description}`.toLowerCase().includes(q));
  rows.sort((a, b) => {
    const ab = (a.boosted_until || 0) > now ? 1 : 0;
    const bb = (b.boosted_until || 0) > now ? 1 : 0;
    if (ab !== bb) return bb - ab;
    return (b.published_at || 0) - (a.published_at || 0);
  });
  res.json(rows.map(r => ({ ...r, images: JSON.parse(r.images_json), images_json: undefined })));
});

app.get('/api/listings/:id', (req, res) => {
  const r = db.prepare(`SELECT * FROM listings WHERE id=?`).get(req.params.id);
  if (!r || r.status !== 'active') return res.status(404).json({ error: 'not_found' });
  res.json({ ...r, images: JSON.parse(r.images_json), images_json: undefined });
});

app.post('/api/listings/draft', async (req, res) => {
  try {
    const seller = cleanUsername(req.body.sellerUsername);
    const phone = cleanText(req.body.phone, 24);
    const title = cleanText(req.body.title, 90);
    const description = cleanText(req.body.description, 1200);
    const price = Math.max(0, Math.floor(Number(req.body.price || 0)));
    const category = cleanText(req.body.category, 40);
    const images = cleanImages(req.body.images);
    if (!seller || !title || !description || !category || images.length === 0) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    const id = nanoid(12);
    const now = Date.now();
    db.prepare(`INSERT INTO listings
      (id,seller_username,phone,title,description,price,category,images_json,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        id, seller, phone, title, description, price, category, JSON.stringify(images), 'pending_payment', now
      );

    const idempotencyKey = `listing:${id}`;
    const tx = await unitedFetch('/v1/phone/transactions', {
      method: 'POST',
      body: JSON.stringify({
        amount: LISTING_FEE,
        metadata: { kind: 'listing', listing_id: id, seller_username: seller },
        idempotency_key: idempotencyKey
      })
    });
    db.prepare(`UPDATE listings SET payment_transaction_id=? WHERE id=?`).run(tx.id, id);
    db.prepare(`INSERT INTO payment_events (id,listing_id,kind,transaction_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(nanoid(12), id, 'listing', tx.id, tx.status || 'pending', now, now);
    res.json({ listingId: id, transactionId: tx.id, status: tx.status || 'pending' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, details: e.body || null });
  }
});

app.post('/api/listings/:id/boost', async (req, res) => {
  try {
    const listing = db.prepare(`SELECT * FROM listings WHERE id=?`).get(req.params.id);
    if (!listing || listing.status !== 'active') return res.status(404).json({ error: 'not_found' });
    const seller = cleanUsername(req.body.sellerUsername);
    if (!seller || seller !== listing.seller_username) return res.status(403).json({ error: 'seller_mismatch' });
    const now = Date.now();
    const tx = await unitedFetch('/v1/phone/transactions', {
      method: 'POST',
      body: JSON.stringify({
        amount: BOOST_FEE,
        metadata: { kind: 'boost', listing_id: listing.id, seller_username: seller },
        idempotency_key: `boost:${listing.id}:${Math.floor(now / 60000)}`
      })
    });
    db.prepare(`UPDATE listings SET boost_transaction_id=? WHERE id=?`).run(tx.id, listing.id);
    db.prepare(`INSERT INTO payment_events (id,listing_id,kind,transaction_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(nanoid(12), listing.id, 'boost', tx.id, tx.status || 'pending', now, now);
    res.json({ transactionId: tx.id, status: tx.status || 'pending' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, details: e.body || null });
  }
});

app.get('/api/payments/:transactionId/status', async (req, res) => {
  try {
    const event = db.prepare(`SELECT * FROM payment_events WHERE transaction_id=?`).get(req.params.transactionId);
    if (!event) return res.status(404).json({ error: 'not_found' });
    const tx = await unitedFetch(`/v1/phone/transactions/${encodeURIComponent(req.params.transactionId)}`);
    const now = Date.now();
    db.prepare(`UPDATE payment_events SET status=?,updated_at=? WHERE transaction_id=?`).run(tx.status, now, req.params.transactionId);

    if (tx.status === 'succeeded') {
      const listing = db.prepare(`SELECT * FROM listings WHERE id=?`).get(event.listing_id);
      const metadata = tx.metadata || {};
      const metadataOk = metadata.listing_id === event.listing_id && metadata.kind === event.kind;
      if (!metadataOk) return res.status(409).json({ error: 'metadata_mismatch' });

      if (event.kind === 'listing' && listing.status === 'pending_payment') {
        db.prepare(`UPDATE listings SET status='active',published_at=? WHERE id=?`).run(now, listing.id);
      }
      if (event.kind === 'boost') {
        const current = Math.max(now, Number(listing.boosted_until || 0));
        const until = current + BOOST_HOURS * 60 * 60 * 1000;
        db.prepare(`UPDATE listings SET boosted_until=? WHERE id=?`).run(until, listing.id);
      }
    }
    res.json({ status: tx.status, metadata: tx.metadata || null, fee: tx.fee, net: tx.net });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, details: e.body || null });
  }
});

app.post('/api/listings/:id/mark-sold', (req, res) => {
  const listing = db.prepare(`SELECT * FROM listings WHERE id=?`).get(req.params.id);
  if (!listing) return res.status(404).json({ error: 'not_found' });
  const seller = cleanUsername(req.body.sellerUsername);
  if (!seller || seller !== listing.seller_username) return res.status(403).json({ error: 'seller_mismatch' });
  db.prepare(`UPDATE listings SET status='sold' WHERE id=?`).run(listing.id);
  res.json({ ok: true });
});

app.delete('/api/admin/listings/:id', (req, res) => {
  if (!ADMIN_KEY || req.header('x-admin-key') !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  db.prepare(`UPDATE listings SET status='removed' WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Marketplace listening on :${PORT}`));
