const socket = io();

// Состояние игры
let selectedBrawler = (typeof BRAWLERS !== 'undefined' && BRAWLERS.SHELLY) ? BRAWLERS.SHELLY : null;
let currentRoom = null;
let gameState = null;

// Элементы UI
const menuScreen = document.getElementById('menu');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const brawlersList = document.getElementById('brawlers-list');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const roomInput = document.getElementById('room-input');
const roomIdDisplay = document.getElementById('room-id-display');
const btnStartGame = document.getElementById('start-game-btn');

// --- 1. Отрисовка списка бойцов ---
function renderBrawlerCards() {
    if (!brawlersList || typeof BRAWLERS === 'undefined') return;
    brawlersList.innerHTML = '';

    Object.values(BRAWLERS).forEach(brawler => {
        const card = document.createElement('div');
        const isActive = selectedBrawler && selectedBrawler.id === brawler.id;
        card.className = `brawler-card ${isActive ? 'active' : ''}`;
        card.style.borderColor = brawler.color || '#fff';
        card.innerHTML = `
            <h3 style="color: ${brawler.color || '#fff'}">${brawler.name}</h3>
            <p>❤️ HP: ${brawler.hp}</p>
            <p>⚔️ Урон: ${brawler.damage}</p>
            <p>⚡ Скорость: ${brawler.speed}</p>
        `;
        card.onclick = () => {
            selectedBrawler = brawler;
            renderBrawlerCards();
        };
        brawlersList.appendChild(card);
    });
}

// Запуск показа бойцов
renderBrawlerCards();

// --- 2. Сетевое взаимодействие (Socket.io) ---
btnCreate.onclick = () => {
    if (!selectedBrawler) return alert('Выберите бойца!');
    socket.emit('createRoom', { brawler: selectedBrawler });
};

btnJoin.onclick = () => {
    const code = roomInput.value.trim().toUpperCase();
    if (!code) return alert('Введите код комнаты!');
    if (!selectedBrawler) return alert('Выберите бойца!');
    socket.emit('joinRoom', { roomId: code, brawler: selectedBrawler });
};

if (btnStartGame) {
    btnStartGame.onclick = () => {
        socket.emit('startGame', { roomId: currentRoom });
    };
}

socket.on('roomCreated', (data) => {
    currentRoom = data.roomId;
    roomIdDisplay.innerText = currentRoom;
    menuScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
});

socket.on('roomJoined', (data) => {
    currentRoom = data.roomId;
    roomIdDisplay.innerText = currentRoom;
    menuScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
});

socket.on('gameStarted', () => {
    lobbyScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    initCanvas();
});

socket.on('stateUpdate', (state) => {
    gameState = state;
});

// --- 3. Оптимизированное управление (Ходьба + Выстрел) ---
const keys = {};

window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    checkAndSendInput();
});

window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    checkAndSendInput();
});

function checkAndSendInput() {
    if (!currentRoom) return;

    let dx = 0;
    let dy = 0;

    if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) dx += 1;

    // Нормализация вектора движения
    if (dx !== 0 && dy !== 0) {
        dx *= 0.7071;
        dy *= 0.7071;
    }

    const isAttacking = !!(keys['Space'] || keys['KeyK']);

    socket.emit('playerInput', {
        roomId: currentRoom,
        dx: dx,
        dy: dy,
        attacking: isAttacking
    });
}

// Кнопка атаки для сенсорных экранов
const attackBtn = document.getElementById('attack-btn');
if (attackBtn) {
    attackBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        keys['Space'] = true;
        checkAndSendInput();
    });
    attackBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        keys['Space'] = false;
        checkAndSendInput();
    });
}

// --- 4. Игровой цикл и оптимизированный Canvas ---
let canvas, ctx;

function initCanvas() {
    canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    
    // Адаптивный размер под экран
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    requestAnimationFrame(gameLoop);
}

function gameLoop() {
    if (gameState && ctx) {
        // Очистка экрана
        ctx.fillStyle = '#1e1e28';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Используем внешний рендер, если он доступен
        if (typeof renderGame === 'function') {
            renderGame(ctx, gameState);
        }
    }
    requestAnimationFrame(gameLoop);
}
