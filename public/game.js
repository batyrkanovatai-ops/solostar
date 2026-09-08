// ============================================================
// SOLOSTAR — game.js (клиент)
// Рендер на Canvas (60 FPS), связь с сервером через Socket.io.
// Сервер авторитетен: этот файл только рисует и шлёт инпут.
// ============================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const socket = io(); // сервер сам отдаёт /socket.io/socket.io.js

let myId = null;
let mapSize = 2400;
let players = [];       // последнее полученное состояние с сервера
let renderPlayers = [];  // сглаженные позиции для отрисовки (интерполяция)
let projectiles = [];
let zone = null;
let brawlersData = {};
let mapData = { walls: [], bushes: [] };
let matchActive = false;

fetch('map.json').then(r => r.json()).then(data => { mapData = data; });

// подгружаем характеристики бойцов (для цвета/размера в рендере + для меню выбора)
let selectedBrawlerId = 'atai';
fetch('brawlers/stats.json').then(r => r.json()).then(data => {
  brawlersData = data;
  buildBrawlerGrid();
});

const RARITY_LABEL = {
  legendary: 'Легендарный', mythic: 'Мифический', epic: 'Эпический',
  superRare: 'Сверхредкий', rare: 'Редкий'
};

function buildBrawlerGrid() {
  const grid = document.getElementById('brawlerGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const [id, b] of Object.entries(brawlersData)) {
    const card = document.createElement('div');
    card.className = 'brawler-card' + (id === selectedBrawlerId ? ' selected' : '');
    card.style.setProperty('--brawler-color', b.color);
    card.innerHTML = `
      <div class="brawler-icon"></div>
      <div class="brawler-name">${b.name}</div>
      <div class="brawler-rarity">${RARITY_LABEL[b.rarity] || b.rarity}</div>
    `;
    card.addEventListener('click', () => {
      selectedBrawlerId = id;
      document.querySelectorAll('.brawler-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
    grid.appendChild(card);
  }
}

function getPlayerName() {
  const el = document.getElementById('nameInput');
  const val = el ? el.value.trim() : '';
  return val || 'Игрок';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('quickplayBtn')?.addEventListener('click', () => {
    window.Solostar.quickplay(getPlayerName(), selectedBrawlerId);
  });
  document.getElementById('createRoomBtn')?.addEventListener('click', () => {
    window.Solostar.createRoom(getPlayerName(), selectedBrawlerId);
  });
  document.getElementById('joinRoomBtn')?.addEventListener('click', () => {
    const code = document.getElementById('roomCodeInput')?.value.trim();
    if (!code) { setStatus('Введи код комнаты'); return; }
    window.Solostar.joinRoom(code, getPlayerName(), selectedBrawlerId);
  });
  document.getElementById('startRoomBtn')?.addEventListener('click', () => {
    socket.emit('startRoom');
  });
});

// ---------------- Джойстики (левый — движение, правый — прицел/стрельба) ----------------
function makeStick(side) {
  return {
    side,               // 'left' | 'right'
    active: false,
    touchId: null,
    baseX: 0, baseY: 0,
    knobX: 0, knobY: 0,
    dx: 0, dy: 0,        // нормализованный вектор -1..1
    maxRadius: 60
  };
}
const moveStick = makeStick('left');
const aimStick = makeStick('right');

function stickFromTouch(x) {
  return x < canvas.width / 2 ? moveStick : aimStick;
}

function handleStart(x, y, id) {
  const stick = stickFromTouch(x);
  if (stick.active) return;
  stick.active = true;
  stick.touchId = id;
  stick.baseX = x; stick.baseY = y;
  stick.knobX = x; stick.knobY = y;
}
function handleMove(x, y, id) {
  for (const stick of [moveStick, aimStick]) {
    if (stick.active && stick.touchId === id) {
      let dx = x - stick.baseX;
      let dy = y - stick.baseY;
      const dist = Math.hypot(dx, dy);
      if (dist > stick.maxRadius) {
        dx = (dx / dist) * stick.maxRadius;
        dy = (dy / dist) * stick.maxRadius;
      }
      stick.knobX = stick.baseX + dx;
      stick.knobY = stick.baseY + dy;
      stick.dx = dx / stick.maxRadius;
      stick.dy = dy / stick.maxRadius;
    }
  }
}
function handleEnd(id) {
  for (const stick of [moveStick, aimStick]) {
    if (stick.active && stick.touchId === id) {
      stick.active = false;
      stick.touchId = null;
      stick.dx = 0; stick.dy = 0;
    }
  }
}

canvas.addEventListener('touchstart', e => {
  for (const t of e.changedTouches) handleStart(t.clientX, t.clientY, t.identifier);
}, { passive: true });
canvas.addEventListener('touchmove', e => {
  for (const t of e.changedTouches) handleMove(t.clientX, t.clientY, t.identifier);
}, { passive: true });
canvas.addEventListener('touchend', e => {
  for (const t of e.changedTouches) handleEnd(t.identifier);
}, { passive: true });

// поддержка мыши для тестов на ПК
let mouseId = 'mouse';
canvas.addEventListener('mousedown', e => handleStart(e.clientX, e.clientY, mouseId));
canvas.addEventListener('mousemove', e => handleMove(e.clientX, e.clientY, mouseId));
canvas.addEventListener('mouseup', e => handleEnd(mouseId));

// ---------------- Отправка инпута серверу (20 раз в секунду, не привязано к рендеру) ----------------
setInterval(() => {
  if (!matchActive) return;
  const aim = Math.atan2(aimStick.dy, aimStick.dx);
  socket.emit('input', {
    dx: moveStick.dx,
    dy: moveStick.dy,
    aim: aimStick.active ? aim : (window.__lastAim || 0),
    shooting: aimStick.active
  });
  if (aimStick.active) window.__lastAim = aim;
}, 50);

// ---------------- Сокет: подключение к матчу ----------------
socket.on('connect', () => { myId = socket.id; });

socket.on('queued', () => setStatus('Ищем соперников...'));
socket.on('roomCreated', ({ code }) => setStatus(`Комната создана: ${code}`));
socket.on('roomUpdate', ({ code, players: list, need, isHost, canStart }) => {
  setStatus(`Комната ${code}: ${list.length}/${need} игроков`);
  const btn = document.getElementById('startRoomBtn');
  if (btn) btn.style.display = (isHost && canStart) ? 'block' : 'none';
});
socket.on('error', ({ message }) => setStatus(message));

socket.on('matchStart', (data) => {
  mapSize = data.mapSize;
  players = data.players;
  renderPlayers = data.players.map(p => ({ ...p }));
  matchActive = true;
  hideMenu();
});

socket.on('state', (data) => {
  players = data.players;
  projectiles = data.projectiles;
  zone = data.zone;
});

socket.on('playerEliminated', ({ name }) => setStatus(`${name} выбыл`));

socket.on('matchEnd', ({ winnerId, trophies }) => {
  matchActive = false;
  const won = winnerId === myId;
  showMenu(won ? '🏆 Победа! +8 трофеев' : 'Матч окончен. −4 трофея');
});

function setStatus(text) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = text;
}
function hideMenu() {
  const el = document.getElementById('menuScreen');
  if (el) el.style.display = 'none';
}
function showMenu(text) {
  const el = document.getElementById('menuScreen');
  if (el) el.style.display = 'flex';
  setStatus(text);
}

// ---------------- Публичное API для меню (index.html будет это вызывать) ----------------
window.Solostar = {
  quickplay(name, brawlerId) { socket.emit('quickplay', { name, brawlerId }); },
  createRoom(name, brawlerId) { socket.emit('createRoom', { name, brawlerId }); },
  joinRoom(code, name, brawlerId) { socket.emit('joinRoom', { code, name, brawlerId }); }
};

// ---------------- Рендер: 60 FPS, плавная интерполяция позиций ----------------
function lerp(a, b, t) { return a + (b - a) * t; }

function updateRenderPlayers() {
  for (const p of players) {
    let rp = renderPlayers.find(r => r.id === p.id);
    if (!rp) { rp = { ...p }; renderPlayers.push(rp); }
    rp.x = lerp(rp.x, p.x, 0.3);
    rp.y = lerp(rp.y, p.y, 0.3);
    rp.rot = p.rot;
    rp.hp = p.hp; rp.maxHp = p.maxHp;
    rp.alive = p.alive;
    rp.name = p.name; rp.brawlerId = p.brawlerId;
  }
  renderPlayers = renderPlayers.filter(r => players.some(p => p.id === r.id));
}

function getCamera() {
  const me = renderPlayers.find(r => r.id === myId) || renderPlayers[0];
  if (!me) return { x: mapSize / 2, y: mapSize / 2 };
  return { x: me.x, y: me.y };
}

function draw() {
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cam = getCamera();
  ctx.save();
  ctx.translate(canvas.width / 2 - cam.x, canvas.height / 2 - cam.y);

  // фон-сетка (заглушка карты — стены/кусты добавим следующим шагом)
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  for (let x = 0; x <= mapSize; x += 100) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mapSize); ctx.stroke();
  }
  for (let y = 0; y <= mapSize; y += 100) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mapSize, y); ctx.stroke();
  }
  ctx.strokeStyle = '#e63946';
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, mapSize, mapSize);
  ctx.lineWidth = 1;

  drawZone();
  drawObstacles();

  // снаряды
  for (const pr of projectiles) {
    ctx.beginPath();
    ctx.fillStyle = effectColor(pr.effect);
    ctx.arc(pr.x, pr.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // игроки
  for (const p of renderPlayers) {
    if (!p.alive) continue;
    const stats = brawlersData[p.brawlerId] || { size: 28, color: '#ffffff' };

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot || 0);
    ctx.globalAlpha = p.inBush ? 0.55 : 1; // прячется в кустах
    ctx.fillStyle = stats.color;
    ctx.beginPath();
    ctx.arc(0, 0, stats.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(stats.size - 4, -3, 14, 6); // "дуло" — направление прицела
    ctx.globalAlpha = 1;
    ctx.restore();

    // HP-бар
    const w = 50;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(p.x - w / 2, p.y - stats.size - 16, w, 6);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(p.x - w / 2, p.y - stats.size - 16, w * Math.max(0, p.hp / p.maxHp), 6);

    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - stats.size - 20);
  }

  ctx.restore();

  drawSticks();
  requestAnimationFrame(loop);
}

function drawZone() {
  if (!zone) return;
  ctx.save();
  ctx.fillStyle = 'rgba(140, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.rect(0, 0, mapSize, mapSize);
  ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2, true); // "дыра" под безопасную зону
  ctx.fill('evenodd');
  ctx.restore();

  ctx.beginPath();
  ctx.strokeStyle = '#ff5252';
  ctx.lineWidth = 6;
  ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawObstacles() {
  // кусты — под всем, полупрозрачная зелень
  ctx.fillStyle = 'rgba(76, 175, 80, 0.35)';
  ctx.strokeStyle = 'rgba(76, 175, 80, 0.7)';
  ctx.setLineDash([6, 4]);
  for (const b of mapData.bushes || []) {
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }
  ctx.setLineDash([]);

  // стены — твёрдые, с тенью снизу для объёма
  for (const w of mapData.walls || []) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(w.x, w.y + 6, w.w, w.h);
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeStyle = '#3e2723';
    ctx.strokeRect(w.x, w.y, w.w, w.h);
  }
}

function effectColor(effect) {
  return {
    default: '#ffffff', knockback: '#ffb300', splash: '#ff5252',
    pierce: '#69f0ae', shield_regen: '#90caf9', heal_regen: '#a5d6a7',
    sniper: '#ff1744', dash: '#ffd54f'
  }[effect] || '#ffffff';
}

function drawStick(stick) {
  if (!stick.active) return;
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 3;
  ctx.arc(stick.baseX, stick.baseY, stick.maxRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.arc(stick.knobX, stick.knobY, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1;
}
function drawSticks() { drawStick(moveStick); drawStick(aimStick); }

function loop() {
  updateRenderPlayers();
  draw();
}
requestAnimationFrame(loop);
