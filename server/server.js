import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { customAlphabet } from 'nanoid';
import Redis from 'ioredis';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nano6 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const nano8 = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || null;
const redis = REDIS_URL ? new Redis(REDIS_URL) : null;
const sub = REDIS_URL ? new Redis(REDIS_URL) : null;
const MIN_PLAYERS = parseInt(process.env.MIN_PLAYERS || '2', 10);

const app = express();
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---- Game constants ----
const DEFAULT_TARGET_SCORE = 100;
const DEFAULT_DECK_DEF = [
  { v: -2, n: 5 }, { v: -1, n: 10 }, { v: 0, n: 15 },
  ...Array.from({ length: 12 }, (_, i) => ({ v: i + 1, n: 10 }))
];

// ---- State ----
const memoryRooms = new Map(); // fallback if no Redis

const roomKey = (id) => `room:${id}`;
const roomChan = (id) => `roomchan:${id}`;

async function getRoom(id){
  if (!redis) return memoryRooms.get(id) || null;
  const raw = await redis.get(roomKey(id));
  return raw ? JSON.parse(raw) : null;
}
async function setRoom(id, room){
  if (!redis) { memoryRooms.set(id, room); return; }
  await redis.set(roomKey(id), JSON.stringify(room));
  await redis.publish(roomChan(id), 'update');
}
async function delRoom(id){
  if (!redis) { memoryRooms.delete(id); return; }
  await redis.del(roomKey(id));
}

if (sub) {
  sub.on('message', async (channel) => {
    const id = channel.replace('roomchan:', '');
    broadcastState(id);
  });
}

function buildDeck(def = DEFAULT_DECK_DEF) {
  const deck = [];
  def.forEach(({ v, n }) => { for (let i=0;i<n;i++) deck.push(v); });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function newRoom(targetScore = DEFAULT_TARGET_SCORE) {
  return {
    players: [], // { id, name, connected, grid[12], faceUp:number[], revealedAll, scoreRound, total }
    deck: [],
    discard: [],
    turn: 0,
    started: false,
    endedByIndex: null,
    roundClosing: false,
    targetScore
  };
}

function applyColumnRemoval(p) {
  for (let col=0; col<4; col++) {
    const idxs = [col, col+4, col+8];
    const open = idxs.every(i => p.faceUp.includes(i));
    if (open) {
      const vals = idxs.map(i => p.grid[i]);
      if (vals[0] !== null && vals.every(v => v === vals[0])) {
        idxs.forEach(i => { p.grid[i] = 0; }); // Spalte zählt 0
      }
    }
  }
}

function dealInitial(room) {
  room.deck = buildDeck();
  room.discard = [];
  room.players.forEach(p => {
    p.grid = room.deck.splice(0, 12);
    p.faceUp = [];
    p.revealedAll = false;
    p.scoreRound = 0;
  });
  // Zwei Startkarten aufdecken
  room.players.forEach(p => {
    const a = Math.floor(Math.random()*12);
    let b = Math.floor(Math.random()*12);
    while (b===a) b = Math.floor(Math.random()*12);
    if (!p.faceUp.includes(a)) p.faceUp.push(a);
    if (!p.faceUp.includes(b)) p.faceUp.push(b);
  });
  // Erste Ablagekarte
  room.discard.push(room.deck.pop());
  // Startspieler
  room.turn = Math.floor(Math.random()*room.players.length);
  room.endedByIndex = null;
  room.roundClosing = false;
}

function calcScore(values) { return values.reduce((a,b)=>a + (b ?? 0), 0); }
function nextTurn(room){ room.turn = (room.turn + 1) % room.players.length; }

async function endRound(roomId, room){
  // Alle Karten aufdecken
  room.players.forEach(p => { for (let i=0;i<12;i++) if (!p.faceUp.includes(i)) p.faceUp.push(i); });
  room.players.forEach(applyColumnRemoval);
  room.players.forEach(p => p.scoreRound = calcScore(p.grid));
  const ender = room.players[room.endedByIndex];
  const minScore = Math.min(...room.players.map(p => p.scoreRound));
  if (ender && ender.scoreRound > minScore && ender.scoreRound > 0) ender.scoreRound *= 2;
  room.players.forEach(p => p.total += p.scoreRound);
  const gameOver = room.players.some(p => p.total >= room.targetScore);
  if (gameOver) {
    room.started = false;
  } else {
    room.started = true;
    dealInitial(room);
  }
  await setRoom(roomId, room);
  broadcastState(roomId);
}

const EMPTY_GRID = Array(12).fill(null);
const getGrid   = (p) => Array.isArray(p?.grid)   ? p.grid   : EMPTY_GRID;
const getFaceUp = (p) => Array.isArray(p?.faceUp) ? p.faceUp : [];

function publicState(room){
  return {
    players: room.players.map((p, idx) => {
      const faceUp = getFaceUp(p);
      const grid   = getGrid(p);
      return {
        id: p.id,
        name: p.name,
        total: p.total ?? 0,
        scoreRound: p.scoreRound ?? 0,
        revealedAll: !!p.revealedAll,
        isTurn: idx === room.turn,
        gridPublic: grid.map((v,i) => faceUp.includes(i) ? v : null),
        faceUp
      };
    }),
    discardTop: room.discard?.at?.(-1) ?? null,
    drawCount: Array.isArray(room.deck) ? room.deck.length : 0,
    turn: room.turn ?? 0,
    started: !!room.started,
    endedByIndex: room.endedByIndex ?? null,
    roundClosing: !!room.roundClosing,
    targetScore: room.targetScore ?? DEFAULT_TARGET_SCORE
  };
}


function send(ws, payload){ try{ ws.send(JSON.stringify(payload)); } catch{} }

function broadcastState(roomId){
  const targets = [];
  wss.clients.forEach(c => { if (c.readyState===1 && c.roomId===roomId) targets.push(c); });
  if (targets.length === 0) return;
  getRoom(roomId).then(room => {
    if (!room) return;
    const common = { t:'state', roomId, state: publicState(room) };
    targets.forEach(c => {
      const me = room.players.find(p => p.id === c.playerId);
      const mine = me ? { grid: getGrid(me), faceUp: getFaceUp(me) } : null;
      send(c, { ...common, you: mine });
    });
  });
}

// -------------- WebSocket handling --------------
wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    // Create
    if (msg.t === 'create') {
      const roomId = nano6();
      const room = newRoom(msg.targetScore ?? DEFAULT_TARGET_SCORE);
      ws.roomId = roomId;
      ws.playerId = nano8();
      room.players.push({ id: ws.playerId, name: msg.name || 'Spieler', connected: true, total: 0 });
      await setRoom(roomId, room);
      if (sub) await sub.subscribe(roomChan(roomId));

      // Antwort + sofortiger eigener State-Snapshot
      send(ws, { t:'created', roomId, playerId: ws.playerId });
      const snap = await getRoom(roomId);
      const me   = snap.players.find(p => p.id === ws.playerId);
      send(ws, { t:'state', roomId, state: publicState(snap), you: { grid: getGrid(me), faceUp: getFaceUp(me) } });

      // Broadcast an alle (falls schon weitere Clients dran hängen)
      broadcastState(roomId);
      return;
    }


    // Join
    if (msg.t === 'join') {
      const room = await getRoom(msg.roomId);
      if (!room) { send(ws, { t:'error', m:'Raum nicht gefunden.' }); return; }
      ws.roomId = msg.roomId;
      ws.playerId = nano8();
      room.players.push({ id: ws.playerId, name: msg.name || 'Spieler', connected: true, total: 0 });
      await setRoom(ws.roomId, room);
      if (sub) await sub.subscribe(roomChan(ws.roomId));

      // Antwort + sofortiger eigener State-Snapshot
      send(ws, { t:'joined', roomId: ws.roomId, playerId: ws.playerId });
      const snap = await getRoom(ws.roomId);
      const me   = snap.players.find(p => p.id === ws.playerId);
      send(ws, { t:'state', roomId, state: publicState(snap), you: { grid: getGrid(me), faceUp: getFaceUp(me) } });

      // Broadcast an alle
      broadcastState(ws.roomId);
      return;
    }


    if (!ws.roomId) return;
    let room = await getRoom(ws.roomId);
    if (!room) return;
    const meIdx = room.players.findIndex(p => p.id === ws.playerId);
    if (meIdx < 0) return;
    const me = room.players[meIdx];

    // Start
  if (msg.t === 'start') {
    if (room.started) {
      send(ws, { t:'info', m:'Spiel läuft bereits.' });
      return;
    }
    if (room.players.length < MIN_PLAYERS) {
      send(ws, { t:'error', m:`Mindestens ${MIN_PLAYERS} Spieler:innen erforderlich.` });
      console.log(`[START] abgelehnt: players=${room.players.length} < ${MIN_PLAYERS} (room ${ws.roomId})`);
      return;
    }

  room.started = true;
  dealInitial(room);
  await setRoom(ws.roomId, room);
  broadcastState(ws.roomId);
  console.log(`[START] ok: players=${room.players.length} (room ${ws.roomId})`);
  return;
}

    // Only active player's turn
    if (room.turn !== meIdx) { send(ws, { t:'info', m:'Nicht dein Zug.' }); return; }

    // Draw from deck
    if (msg.t === 'drawDeck') {
      if (room.deck.length === 0) {
        const keepTop = room.discard.pop();
        room.deck = room.discard;
        room.discard = keepTop != null ? [keepTop] : [];
        for (let i = room.deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [room.deck[i], room.deck[j]] = [room.deck[j], room.deck[i]];
        }
      }
      const card = room.deck.pop();
      ws.pendingCard = card;
      await setRoom(ws.roomId, room);
      send(ws, { t:'drew', card });
      return;
    }

    // Swap with drawn
    if (msg.t === 'swapWithDrawn' && ws.pendingCard != null) {
      const idx = msg.index; if (idx < 0 || idx > 11) return;
      const out = me.grid[idx];
      me.grid[idx] = ws.pendingCard;
      if (!me.faceUp.includes(idx)) me.faceUp.push(idx);
      room.discard.push(out);
      ws.pendingCard = null;
      applyColumnRemoval(me);
      if (me.faceUp.length === 12 && !me.revealedAll) {
        me.revealedAll = true;
        if (room.endedByIndex === null) { room.endedByIndex = meIdx; room.roundClosing = true; }
      }
      nextTurn(room);
      if (room.roundClosing && room.turn === room.endedByIndex) {
        await setRoom(ws.roomId, room);
        await endRound(ws.roomId, room);
        return;
      }
      await setRoom(ws.roomId, room);
      broadcastState(ws.roomId);
      return;
    }

    // Reject drawn (place on discard, flip one of your hidden)
    if (msg.t === 'rejectDrawn' && ws.pendingCard != null) {
      room.discard.push(ws.pendingCard);
      ws.pendingCard = null;
      const idx = msg.index;
      if (idx>=0 && idx<=11 && !me.faceUp.includes(idx)) me.faceUp.push(idx);
      applyColumnRemoval(me);
      if (me.faceUp.length === 12 && !me.revealedAll) {
        me.revealedAll = true;
        if (room.endedByIndex === null) { room.endedByIndex = meIdx; room.roundClosing = true; }
      }
      nextTurn(room);
      if (room.roundClosing && room.turn === room.endedByIndex) {
        await setRoom(ws.roomId, room);
        await endRound(ws.roomId, room);
        return;
      }
      await setRoom(ws.roomId, room);
      broadcastState(ws.roomId);
      return;
    }

    // Take from discard
    if (msg.t === 'takeDiscard') {
      const card = room.discard.pop();
      if (card == null) return;
      const idx = msg.index; if (idx < 0 || idx > 11) return;
      const out = me.grid[idx];
      me.grid[idx] = card;
      if (!me.faceUp.includes(idx)) me.faceUp.push(idx);
      room.discard.push(out);
      applyColumnRemoval(me);
      if (me.faceUp.length === 12 && !me.revealedAll) {
        me.revealedAll = true;
        if (room.endedByIndex === null) { room.endedByIndex = meIdx; room.roundClosing = true; }
      }
      nextTurn(room);
      if (room.roundClosing && room.turn === room.endedByIndex) {
        await setRoom(ws.roomId, room);
        await endRound(ws.roomId, room);
        return;
      }
      await setRoom(ws.roomId, room);
      broadcastState(ws.roomId);
      return;
    }
  });

  ws.on('close', async () => {
    if (!ws.roomId) return;
    const room = await getRoom(ws.roomId);
    if (!room) return;
    const p = room.players.find(pl => pl.id === ws.playerId);
    if (p) p.connected = false;
    await setRoom(ws.roomId, room);
    broadcastState(ws.roomId);
  });
});

server.listen(PORT, () => console.log(`Server läuft auf http://localhost:${PORT}`));
