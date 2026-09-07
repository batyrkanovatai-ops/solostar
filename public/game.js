const socket = io();

let currentRoomId = null;
let selectedBrawler = BRAWLERS.atai;
let gameState = { players: {}, bullets: [], obstacles: [] };

const canvas = document.getElementById('game-canvas');
const renderer = new GameRenderer(canvas);

// Обновление трофеев на экране
function updateTrophyDisplay() {
    const trophies = getTrophies();
    const elem1 = document.getElementById('trophy-count');
    const elem2 = document.getElementById('ingame-trophy-count');
    if (elem1) elem1.innerText = trophies;
    if (elem2) elem2.innerText = trophies;
}
updateTrophyDisplay();

// Карточки выбора
function renderBrawlerCards() {
    const grid = document.getElementById('brawlers-grid');
    if (!grid) return;
    grid.innerHTML = '';

    Object.values(BRAWLERS).forEach(brawler => {
        const card = document.createElement('div');
        card.className = `brawler-card ${selectedBrawler.id === brawler.id ? 'active' : ''}`;
        card.style.borderColor = brawler.color;
        card.innerHTML = `
            <h3 style="color: ${brawler.color}">${brawler.name}</h3>
            <small>(${brawler.origName})</small>
            <p>❤️ HP: ${brawler.hp}</p>
            <p>⚔️ Урон: ${brawler.damage}</p>
        `;
        card.onclick = () => {
            selectedBrawler = brawler;
            renderBrawlerCards();
        };
        grid.appendChild(card);
    });
}
renderBrawlerCards();

// Сетевые события
socket.on('trophyChange', ({ change, reason }) => {
    const newTotal = addTrophies(change);
    updateTrophyDisplay();
});

document.getElementById('create-room-btn').onclick = () => {
    socket.emit('createRoom', { brawler: selectedBrawler });
};

document.getElementById('join-room-btn').onclick = () => {
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (code) {
        socket.emit('joinRoom', { roomId: code, brawler: selectedBrawler });
    }
};

document.getElementById('start-game-btn').onclick = () => {
    if (currentRoomId) {
        socket.emit('startGame', currentRoomId);
    }
};

socket.on('roomCreated', (roomId) => {
    currentRoomId = roomId;
    showLobbyScreen(roomId, true);
});

socket.on('roomJoined', (roomId) => {
    currentRoomId = roomId;
    showLobbyScreen(roomId, false);
});

socket.on('updateLobby', (players) => {
    const list = document.getElementById('players-list');
    if (list) {
        list.innerHTML = players.map(p => `<div>• ${p.brawler.name} (${p.brawler.origName})</div>`).join('');
    }
});

socket.on('gameStarted', () => {
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    requestAnimationFrame(gameLoop);
});

socket.on('gameStateUpdate', (state) => {
    gameState = state;
});

// Управление
let moveDir = { x: 0, y: 0 };
const controls = new ControlManager(
    (dx, dy) => { moveDir.x = dx; moveDir.y = dy; },
    () => { if (currentRoomId) socket.emit('attack', { roomId: currentRoomId }); }
);

setInterval(() => {
    if (currentRoomId && (moveDir.x !== 0 || moveDir.y !== 0)) {
        socket.emit('playerMove', { roomId: currentRoomId, dx: moveDir.x, dy: moveDir.y });
    }
}, 1000 / 60);

function gameLoop() {
    renderer.render(gameState, socket.id);
    requestAnimationFrame(gameLoop);
}

function showLobbyScreen(roomId, isHost) {
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
    document.getElementById('room-id-display').innerText = roomId;
    if (!isHost) {
        document.getElementById('start-game-btn').style.display = 'none';
    }
}
