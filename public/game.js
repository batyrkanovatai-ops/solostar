const socket = io();

const BRAWLERS = [
    { id: 'atai', name: 'Атай', hp: 1800, speed: 5.5, damage: 280, color: '#ffd700' },
    { id: 'bekzhan', name: 'Бекжан', hp: 2600, speed: 4.2, damage: 160, color: '#4caf50' },
    { id: 'aidomur', name: 'Айдомур', hp: 2000, speed: 3.8, damage: 380, color: '#e53935' },
    { id: 'bilal', name: 'Билал', hp: 2200, speed: 3.5, damage: 250, color: '#8e24aa' },
    { id: 'arlen', name: 'Арлен', hp: 1300, speed: 6.5, damage: 130, color: '#00acc1' },
    { id: 'nurlis', name: 'Нурлис', hp: 1700, speed: 4.8, damage: 200, color: '#fb8c00' }
];

// Кусты для засады
const BUSHES = [
    { x: 100, y: 100, w: 150, h: 150 },
    { x: 1350, y: 100, w: 150, h: 150 },
    { x: 100, y: 950, w: 150, h: 150 },
    { x: 1350, y: 950, w: 150, h: 150 },
    { x: 700, y: 250, w: 200, h: 100 },
    { x: 700, y: 850, w: 200, h: 100 }
];

let selectedBrawler = BRAWLERS[0];
let currentRoom = null;
let gameState = { players: {}, bullets: [], obstacles: [], mapWidth: 1600, mapHeight: 1200 };

const brawlersGrid = document.getElementById('brawlers-list');

BRAWLERS.forEach((b, index) => {
    const card = document.createElement('div');
    card.className = `brawler-card ${index === 0 ? 'active' : ''}`;
    card.innerHTML = `<h4 style="color:${b.color}">${b.name}</h4><small>HP:${b.hp}</small>`;
    card.onclick = () => {
        document.querySelectorAll('.brawler-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selectedBrawler = b;
    };
    brawlersGrid.appendChild(card);
});

document.getElementById('btn-create').onclick = () => {
    socket.emit('createRoom', { brawler: selectedBrawler });
};

document.getElementById('btn-join').onclick = () => {
    const code = document.getElementById('room-input').value.trim().toUpperCase();
    if (code) {
        socket.emit('joinRoom', { roomId: code, brawler: selectedBrawler });
    }
};

socket.on('roomCreated', (roomId) => {
    currentRoom = roomId;
    document.getElementById('lobby-code').innerText = roomId;
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
});

socket.on('roomJoined', (roomId) => {
    currentRoom = roomId;
    document.getElementById('lobby-code').innerText = roomId;
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
});

socket.on('updateLobby', (players) => {
    document.getElementById('players-list').innerHTML = players.map((p, i) => 
        `<p style="color:${p.brawler.color}">Игрок ${i + 1}: ${p.brawler.name}</p>`
    ).join('');
});

document.getElementById('btn-start').onclick = () => {
    socket.emit('startGame', currentRoom);
};

socket.on('gameStarted', () => {
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    initGame();
});

function initGame() {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let moveX = 0;
    let moveY = 0;
    let lastAngle = 0;

    // Джойстик
    const base = document.getElementById('joystick-base');
    const stick = document.getElementById('joystick-stick');
    let touchId = null;

    base.addEventListener('touchstart', (e) => {
        touchId = e.changedTouches[0].identifier;
    });

    window.addEventListener('touchmove', (e) => {
        for (let touch of e.changedTouches) {
            if (touch.identifier === touchId) {
                const rect = base.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                
                let dx = touch.clientX - centerX;
                let dy = touch.clientY - centerY;
                let dist = Math.hypot(dx, dy);
                let maxDist = rect.width / 2;

                if (dist > maxDist) {
                    dx = (dx / dist) * maxDist;
                    dy = (dy / dist) * maxDist;
                }

                stick.style.transform = `translate(${dx}px, ${dy}px)`;
                moveX = dx / maxDist;
                moveY = dy / maxDist;
                lastAngle = Math.atan2(moveY, moveX);
            }
        }
    });

    const resetJoystick = (e) => {
        for (let touch of e.changedTouches) {
            if (touch.identifier === touchId) {
                touchId = null;
                stick.style.transform = `translate(0px, 0px)`;
                moveX = 0;
                moveY = 0;
            }
        }
    };

    window.addEventListener('touchend', resetJoystick);
    window.addEventListener('touchcancel', resetJoystick);

    // Атака
    document.getElementById('attack-btn').onclick = () => {
        socket.emit('attack', { roomId: currentRoom, angle: lastAngle });
    };

    socket.on('gameStateUpdate', (state) => {
        gameState = state;
    });

    setInterval(() => {
        if (moveX !== 0 || moveY !== 0) {
            socket.emit('playerMove', { roomId: currentRoom, dx: moveX, dy: moveY });
        }
    }, 1000 / 30);

    function loop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const myPlayer = gameState.players[socket.id];
        let camX = myPlayer ? myPlayer.x - canvas.width / 2 : 0;
        let camY = myPlayer ? myPlayer.y - canvas.height / 2 : 0;

        ctx.save();
        ctx.translate(-camX, -camY);

        // 1. Отрисовка Земли (Карты)
        ctx.fillStyle = '#2d3748';
        ctx.fillRect(0, 0, gameState.mapWidth, gameState.mapHeight);

        // Сетка для красоты
        ctx.strokeStyle = '#3a4a5e';
        ctx.lineWidth = 2;
        for (let x = 0; x < gameState.mapWidth; x += 80) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gameState.mapHeight); ctx.stroke();
        }
        for (let y = 0; y < gameState.mapHeight; y += 80) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(gameState.mapWidth, y); ctx.stroke();
        }

        // 2. Стены
        (gameState.obstacles || []).forEach(obs => {
            ctx.fillStyle = '#4a5568';
            ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
            ctx.strokeStyle = '#cbd5e0';
            ctx.lineWidth = 4;
            ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
        });

        // 3. Кусты
        BUSHES.forEach(bush => {
            ctx.fillStyle = 'rgba(46, 125, 50, 0.7)';
            ctx.fillRect(bush.x, bush.y, bush.w, bush.h);
            ctx.strokeStyle = '#81c784';
            ctx.lineWidth = 2;
            ctx.strokeRect(bush.x, bush.y, bush.w, bush.h);
        });

        // 4. Пули
        (gameState.bullets || []).forEach(b => {
            ctx.beginPath();
            ctx.arc(b.x, b.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = b.color || '#ffd700';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        });

        // 5. Игроки
        Object.values(gameState.players || {}).forEach(p => {
            let inBush = BUSHES.some(b => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h);
            
            // Если игрок в кустах и это не мы — делаем полупрозрачным
            ctx.globalAlpha = (inBush && p.id !== socket.id) ? 0.3 : 1.0;

            // Тело персонажа
            ctx.beginPath();
            ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
            ctx.fillStyle = p.brawler.color;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Дуло оружия (показывает куда смотрит)
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + Math.cos(p.angle) * 32, p.y + Math.sin(p.angle) * 32);
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 6;
            ctx.stroke();

            // Полоска Здоровья (HP)
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = '#111';
            ctx.fillRect(p.x - 30, p.y - 40, 60, 8);
            ctx.fillStyle = '#4caf50';
            ctx.fillRect(p.x - 30, p.y - 40, (p.hp / p.brawler.hp) * 60, 8);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.strokeRect(p.x - 30, p.y - 40, 60, 8);

            // Имя
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(p.brawler.name, p.x, p.y - 48);
        });

        ctx.restore();
        requestAnimationFrame(loop);
    }
    loop();
}
