'use strict';
const http = require('node:http');
const { randomUUID } = require('node:crypto');

const PORT = Number(process.env.PORT || process.env.MOON_BACKEND_PORT || 3210);
const HOST = '0.0.0.0';
const WAIT_MS = 90_000;
const MODES = {
  solo: { label: 'Solo', minimum: 1, servers: 4 },
  duo: { label: 'Duo', minimum: 2, servers: 3 },
  section: { label: 'Section', minimum: 4, servers: 3 },
};

const serverSlots = [];
for (const [mode, config] of Object.entries(MODES)) {
  for (let i = 1; i <= config.servers; i++) {
    serverSlots.push({ id: `${mode.toUpperCase()}-${String(i).padStart(2, '0')}`, mode, region: 'EU', state: 'available', players: [] });
  }
}
const queues = new Map();
const tickets = new Map();
const matches = new Map();

function json(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 16_384) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function publicServer(s) {
  return { id: s.id, mode: s.mode, region: s.region, state: s.state, playerCount: s.players.length };
}
function publicTicket(t) {
  const q = queues.get(t.mode);
  const now = Date.now();
  return {
    ticketId: t.id, playerId: t.playerId, mode: t.mode, status: t.status,
    queueStartedAt: q ? q.startedAt : null,
    secondsRemaining: q ? Math.max(0, Math.ceil((q.deadline - now) / 1000)) : 0,
    playersInQueue: q ? q.players.length : 0,
    minimumPlayers: MODES[t.mode].minimum,
    match: t.matchId ? matches.get(t.matchId) : null,
    message: t.message || null,
  };
}
function finalizeQueue(mode) {
  const q = queues.get(mode);
  if (!q || q.finalized) return;
  q.finalized = true;
  const active = q.players.filter(id => tickets.get(id)?.status === 'searching');
  const minimum = MODES[mode].minimum;
  if (active.length < minimum) {
    for (const id of active) {
      const t = tickets.get(id);
      t.status = 'not_enough_players';
      t.message = `Pas assez de joueurs après 90 secondes (minimum : ${minimum}).`;
    }
    queues.delete(mode);
    return;
  }
  const slot = serverSlots.find(s => s.mode === mode && s.state === 'available');
  if (!slot) {
    for (const id of active) {
      const t = tickets.get(id);
      t.status = 'no_server_available';
      t.message = 'Aucun emplacement de serveur disponible.';
    }
    queues.delete(mode);
    return;
  }
  slot.state = 'reserved';
  slot.players = active.map(id => tickets.get(id).playerId);
  const match = {
    matchId: randomUUID(), mode, region: 'EU', serverId: slot.id,
    players: slot.players, state: 'reserved',
    note: 'Emplacement logique réservé : aucun serveur de jeu réel n’est démarré par ce prototype.',
  };
  matches.set(match.matchId, match);
  for (const id of active) {
    const t = tickets.get(id);
    t.status = 'matched';
    t.matchId = match.matchId;
  }
  queues.delete(mode);
}
function joinQueue({ mode, playerId, displayName }) {
  if (!MODES[mode]) throw new Error('Mode invalide. Valeurs : solo, duo, section.');
  if (typeof playerId !== 'string' || !playerId.trim() || playerId.length > 100) throw new Error('playerId requis (100 caractères maximum).');
  const existing = [...tickets.values()].find(t => t.playerId === playerId && t.status === 'searching');
  if (existing) return existing;
  let q = queues.get(mode);
  if (!q || q.finalized) {
    q = { mode, startedAt: Date.now(), deadline: Date.now() + WAIT_MS, players: [], finalized: false };
    queues.set(mode, q);
    setTimeout(() => finalizeQueue(mode), WAIT_MS).unref?.();
  }
  const id = randomUUID();
  const ticket = { id, playerId: playerId.trim(), displayName: String(displayName || playerId).slice(0, 40), mode, status: 'searching', matchId: null, message: null };
  tickets.set(id, ticket);
  q.players.push(id);
  return ticket;
}

const app = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'MOON Backend', version: '0.1.0' });
    if (req.method === 'GET' && url.pathname === '/servers') return json(res, 200, { servers: serverSlots.map(publicServer) });
    if (req.method === 'GET' && url.pathname === '/queues') {
      return json(res, 200, { queues: [...queues.values()].map(q => ({ mode: q.mode, players: q.players.filter(id => tickets.get(id)?.status === 'searching').length, minimum: MODES[q.mode].minimum, secondsRemaining: Math.max(0, Math.ceil((q.deadline - Date.now()) / 1000)) })) });
    }
    if (req.method === 'POST' && url.pathname === '/queue/join') {
      const body = await readBody(req);
      return json(res, 201, publicTicket(joinQueue(body)));
    }
    const statusMatch = url.pathname.match(/^\/queue\/([^/]+)$/);
    if (req.method === 'GET' && statusMatch) {
      const ticket = tickets.get(statusMatch[1]);
      if (!ticket) return json(res, 404, { error: 'Ticket introuvable.' });
      return json(res, 200, publicTicket(ticket));
    }
    const cancelMatch = url.pathname.match(/^\/queue\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const ticket = tickets.get(cancelMatch[1]);
      if (!ticket) return json(res, 404, { error: 'Ticket introuvable.' });
      if (ticket.status === 'searching') {
        ticket.status = 'cancelled';
        const q = queues.get(ticket.mode);
        if (q) q.players = q.players.filter(id => id !== ticket.id);
      }
      return json(res, 200, publicTicket(ticket));
    }
    return json(res, 404, { error: 'Route inconnue.' });
  } catch (error) {
    return json(res, 400, { error: error.message || 'Erreur serveur.' });
  }
});
app.listen(PORT, HOST, () => {
  console.log(`MOON Backend prêt sur ${HOST}:${PORT}`);
  console.log('Prototype indépendant : files de 90 s et 10 emplacements logiques EU.');
});
