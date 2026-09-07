// ============================================================
// SOLOSTAR — server.js
// Express раздаёт статику (public/), Socket.io держит онлайн:
// комнаты с друзьями, автоподбор (matchmaking), и авторитетный
// игровой цикл (сервер решает движение/урон, клиент только рисует).
// ============================================================

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // на проде лучше сузить до своего домена
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Данные бойцов и карты ----------
const BRAWLERS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'public/brawlers/stats.json'), 'utf8')
);
const MAP = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'public/map.json'), 'utf8')
);

// ---------- Настройки матча ----------
const PLAYERS_PER_MATCH = 6;
const TICK_RATE = 30;          // раз в секунду сервер шлёт состояние
const TICK_MS = 1000 / TICK_RATE;
const MAP_SIZE = MAP.mapSize;
const BUSH_REVEAL_RADIUS = MAP.bushRevealRadius;

// ---------- Геометрия: стены и кусты ----------
function circleHitsRect(cx, cy, r, rect) {
  const nearestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const nearestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nearestX, dy = cy - nearestY;
  return dx * dx + dy * dy < r * r;
}
function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}
function hitsAnyWall(x, y, r) {
  return MAP.walls.some(w => circleHitsRect(x, y, r, w));
}
function isInBush(x, y) {
  return MAP.bushes.some(b => pointInRect(x, y, b));
}
// Игрок виден наблюдателю, если сам не в кустах, недавно стрелял,
// это он сам, или наблюдатель подошёл достаточно близко.
function isVisibleTo(viewer, target) {
  if (viewer.id === target.id) return true;
  if (!target.inBush) return true;
  if (target.revealTimer > 0) return true;
  return Math.hypot(viewer.x - target.x, viewer.y - target.y) < BUSH_REVEAL_RADIUS;
}

// ---------- Хранилища в памяти ----------
const queue = [];               // очередь автоподбора: [socket.id, ...]
const rooms = new Map();        // roomId -> Room
const trophies = new Map();     // name -> число трофеев (временно, без БД)

function makeRoomId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function createRoom(isPrivate) {
  const id = makeRoomId();
  const room = {
    id,
    isPrivate,
    hostId: null,
    players: new Map(), // socket.id -> playerState
    projectiles: [],
    started: false,
    loop: null
  };
  rooms.set(id, room);
  return room;
}

function spawnPoint(index, total) {
  // раскидываем игроков по кругу вокруг центра карты
  const angle = (index / total) * Math.PI * 2;
  const radius = MAP_SIZE * 0.35;
  return {
    x: MAP_SIZE / 2 + Math.cos(angle) * radius,
    y: MAP_SIZE / 2 + Math.sin(angle) * radius
  };
}

function startMatch(room) {
  room.started = true;
  let i = 0;
  const total = room.players.size;
  for (const p of room.players.values()) {
    const pos = spawnPoint(i++, total);
    p.x = pos.x;
    p.y = pos.y;
    p.rot = 0;
    p.hp = BRAWLERS[p.brawlerId].hp;
    p.maxHp = p.hp;
    p.cooldown = 0;
    p.alive = true;
    p.inBush = false;
    p.revealTimer = 0;
    p.input = { dx: 0, dy: 0, aim: 0, shooting: false };
  }

  io.to(room.id).emit('matchStart', {
    mapSize: MAP_SIZE,
    players: [...room.players.values()].map(publicPlayer)
  });

  room.loop = setInterval(() => tickRoom(room), TICK_MS);
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    brawlerId: p.brawlerId,
    x: p.x, y: p.y, rot: p.rot,
    hp: p.hp, maxHp: p.maxHp,
    alive: p.alive,
    inBush: !!p.inBush
  };
}

function tickRoom(room) {
  const dt = TICK_MS / 1000;

  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const stats = BRAWLERS[p.brawlerId];
    const { dx, dy, aim, shooting } = p.input;

    // движение (сервер авторитетно считает позицию, со скольжением вдоль стен)
    const len = Math.hypot(dx, dy) || 1;
    if (dx || dy) {
      const targetX = Math.max(stats.size, Math.min(MAP_SIZE - stats.size, p.x + (dx / len) * stats.speed * dt));
      const targetY = Math.max(stats.size, Math.min(MAP_SIZE - stats.size, p.y + (dy / len) * stats.speed * dt));

      if (!hitsAnyWall(targetX, targetY, stats.size)) {
        p.x = targetX; p.y = targetY;
      } else if (!hitsAnyWall(targetX, p.y, stats.size)) {
        p.x = targetX; // скользим по X, если по Y упёрлись в стену
      } else if (!hitsAnyWall(p.x, targetY, stats.size)) {
        p.y = targetY; // скользим по Y
      }
    }
    p.rot = aim;
    p.inBush = isInBush(p.x, p.y);
    p.revealTimer = Math.max(0, p.revealTimer - dt);

    // стрельба / КД
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (shooting && p.cooldown <= 0) {
      p.cooldown = stats.cooldown;
      p.revealTimer = 1.0; // выстрел на секунду выдаёт позицию, даже из куста
      room.projectiles.push({
        ownerId: p.id,
        x: p.x, y: p.y,
        vx: Math.cos(aim) * 700,
        vy: Math.sin(aim) * 700,
        range: stats.range,
        traveled: 0,
        damage: stats.damage,
        effect: stats.effect,
        pierce: stats.effect === 'pierce'
      });
    }

    // пассивные эффекты
    if (stats.effect === 'heal_regen') p.hp = Math.min(p.maxHp, p.hp + 15 * dt);
    if (stats.effect === 'shield_regen') p.hp = Math.min(p.maxHp, p.hp + 8 * dt);
  }

  // снаряды
  room.projectiles = room.projectiles.filter(pr => {
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.traveled += Math.hypot(pr.vx, pr.vy) * dt;
    if (pr.traveled > pr.range) return false;
    if (hitsAnyWall(pr.x, pr.y, 4)) return false; // снаряд гаснет о стену

    for (const p of room.players.values()) {
      if (!p.alive || p.id === pr.ownerId) continue;
      const stats = BRAWLERS[p.brawlerId];
      const dist = Math.hypot(p.x - pr.x, p.y - pr.y);
      if (dist < stats.size) {
        p.hp -= pr.damage;
        if (pr.effect === 'knockback') {
          const a = Math.atan2(p.y - pr.y, p.x - pr.x);
          p.x += Math.cos(a) * 40;
          p.y += Math.sin(a) * 40;
        }
        if (p.hp <= 0 && p.alive) {
          p.alive = false;
          io.to(room.id).emit('playerEliminated', { id: p.id, name: p.name });
        }
        if (!pr.pierce) return false; // снаряд гаснет, кроме "pierce"
      }
    }
    return true;
  });

  const allPlayers = [...room.players.values()];
  const projSnapshot = room.projectiles.map(pr => ({ x: pr.x, y: pr.y, effect: pr.effect }));

  for (const viewer of allPlayers) {
    const visible = allPlayers.filter(p => isVisibleTo(viewer, p)).map(publicPlayer);
    io.to(viewer.id).emit('state', { players: visible, projectiles: projSnapshot });
  }

  checkMatchEnd(room);
}

function checkMatchEnd(room) {
  const alive = [...room.players.values()].filter(p => p.alive);
  if (alive.length > 1) return;

  clearInterval(room.loop);
  const winner = alive[0];

  for (const p of room.players.values()) {
    const cur = trophies.get(p.name) || 0;
    const delta = p.id === winner?.id ? 8 : -4;
    trophies.set(p.name, Math.max(0, cur + delta));
  }

  io.to(room.id).emit('matchEnd', {
    winnerId: winner ? winner.id : null,
    trophies: Object.fromEntries(
      [...room.players.values()].map(p => [p.name, trophies.get(p.name) || 0])
    )
  });

  // чистим комнату через пару секунд, чтобы клиент успел показать экран результатов
  setTimeout(() => rooms.delete(room.id), 5000);
}

// ---------- Socket.io события ----------
io.on('connection', (socket) => {

  socket.on('quickplay', ({ name, brawlerId }) => {
    socket.data.name = name || 'Игрок';
    socket.data.brawlerId = BRAWLERS[brawlerId] ? brawlerId : 'atai';
    queue.push(socket.id);
    socket.emit('queued');
    tryMatchmake();
  });

  socket.on('createRoom', ({ name, brawlerId }) => {
    socket.data.name = name || 'Игрок';
    socket.data.brawlerId = BRAWLERS[brawlerId] ? brawlerId : 'atai';
    const room = createRoom(true);
    room.hostId = socket.id;
    socket.emit('roomCreated', { code: room.id });
    joinRoomInternal(socket, room);
  });

  socket.on('joinRoom', ({ code, name, brawlerId }) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room || room.started) {
      socket.emit('error', { message: 'Комната не найдена или игра уже началась' });
      return;
    }
    socket.data.name = name || 'Игрок';
    socket.data.brawlerId = BRAWLERS[brawlerId] ? brawlerId : 'atai';
    joinRoomInternal(socket, room);
  });

  socket.on('startRoom', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room || room.started) return;
    if (room.hostId !== socket.id) {
      socket.emit('error', { message: 'Только создатель комнаты может начать матч' });
      return;
    }
    if (room.players.size < 2) {
      socket.emit('error', { message: 'Нужно минимум 2 игрока' });
      return;
    }
    startMatch(room);
  });

  socket.on('input', (input) => {
    const room = rooms.get(socket.data.roomId);
    if (!room || !room.started) return;
    const p = room.players.get(socket.id);
    if (p) p.input = input;
  });

  socket.on('leaveRoom', () => leaveCurrentRoom(socket));
  socket.on('disconnect', () => {
    const idx = queue.indexOf(socket.id);
    if (idx !== -1) queue.splice(idx, 1);
    leaveCurrentRoom(socket);
  });
});

function broadcastRoomUpdate(room) {
  const list = [...room.players.values()].map(p => ({ name: p.name, brawlerId: p.brawlerId }));
  for (const id of room.players.keys()) {
    io.to(id).emit('roomUpdate', {
      code: room.id,
      players: list,
      need: PLAYERS_PER_MATCH,
      isHost: room.hostId === id,
      canStart: room.isPrivate && room.players.size >= 2
    });
  }
}

function joinRoomInternal(socket, room) {
  socket.join(room.id);
  socket.data.roomId = room.id;
  room.players.set(socket.id, {
    id: socket.id,
    name: socket.data.name,
    brawlerId: socket.data.brawlerId
  });
  broadcastRoomUpdate(room);

  if (room.players.size >= PLAYERS_PER_MATCH && !room.started) {
    startMatch(room);
  }
}

function tryMatchmake() {
  while (queue.length >= PLAYERS_PER_MATCH) {
    const room = createRoom(false);
    for (let i = 0; i < PLAYERS_PER_MATCH; i++) {
      const id = queue.shift();
      const s = io.sockets.sockets.get(id);
      if (s) joinRoomInternal(s, room);
    }
  }
}

function leaveCurrentRoom(socket) {
  const room = rooms.get(socket.data.roomId);
  if (!room) return;
  room.players.delete(socket.id);
  socket.leave(room.id);
  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value || null;
  }
  if (room.players.size === 0) {
    if (room.loop) clearInterval(room.loop);
    rooms.delete(room.id);
  } else {
    broadcastRoomUpdate(room);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Solostar server running on port ${PORT}`));
