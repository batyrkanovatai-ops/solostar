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

// ---------- Данные бойцов ----------
const BRAWLERS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'public/brawlers/stats.json'), 'utf8')
);

// ---------- Настройки матча ----------
const PLAYERS_PER_MATCH = 6;
const TICK_RATE = 30;          // раз в секунду сервер шлёт состояние
const TICK_MS = 1000 / TICK_RATE;

// Временные границы карты (реальная карта со стенами/кустами — следующий шаг)
const MAP_SIZE = 2400;

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
    alive: p.alive
  };
}

function tickRoom(room) {
  const dt = TICK_MS / 1000;

  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const stats = BRAWLERS[p.brawlerId];
    const { dx, dy, aim, shooting } = p.input;

    // движение (сервер авторитетно считает позицию)
    const len = Math.hypot(dx, dy) || 1;
    if (dx || dy) {
      p.x += (dx / len) * stats.speed * dt;
      p.y += (dy / len) * stats.speed * dt;
      p.x = Math.max(stats.size, Math.min(MAP_SIZE - stats.size, p.x));
      p.y = Math.max(stats.size, Math.min(MAP_SIZE - stats.size, p.y));
    }
    p.rot = aim;

    // стрельба / КД
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (shooting && p.cooldown <= 0) {
      p.cooldown = stats.cooldown;
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

  io.to(room.id).emit('state', {
    players: [...room.players.values()].map(publicPlayer),
    projectiles: room.projectiles.map(pr => ({ x: pr.x, y: pr.y, effect: pr.effect }))
  });

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
    joinRoomInternal(socket, room);
    socket.emit('roomCreated', { code: room.id });
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

function joinRoomInternal(socket, room) {
  socket.join(room.id);
  socket.data.roomId = room.id;
  room.players.set(socket.id, {
    id: socket.id,
    name: socket.data.name,
    brawlerId: socket.data.brawlerId
  });
  io.to(room.id).emit('roomUpdate', {
    code: room.id,
    players: [...room.players.values()].map(p => ({ name: p.name, brawlerId: p.brawlerId })),
    need: PLAYERS_PER_MATCH
  });

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
  if (room.players.size === 0) {
    if (room.loop) clearInterval(room.loop);
    rooms.delete(room.id);
  } else {
    io.to(room.id).emit('roomUpdate', {
      code: room.id,
      players: [...room.players.values()].map(p => ({ name: p.name, brawlerId: p.brawlerId })),
      need: PLAYERS_PER_MATCH
    });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Solostar server running on port ${PORT}`));
