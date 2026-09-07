const socket = io();

// Твои 6 уникальных бойцов
const BRAWLERS = [
    { id: 'atai', name: 'Атай', hp: 1800, speed: 4.2, damage: 280, color: '#ffd700' },
    { id: 'bekzhan', name: 'Бекжан', hp: 2600, speed: 3.2, damage: 160, color: '#4caf50' },
    { id: 'aidomur', name: 'Айдомур', hp: 2000, speed: 2.7, damage: 380, color: '#e53935' },
    { id: 'bilal', name: 'Билал', hp: 2200, speed: 2.4, damage: 250, color: '#8e24aa' },
    { id: 'arlen', name: 'Арлен', hp: 1300, speed: 5.2, damage: 130, color: '#00acc1' },
    { id: 'nurlis', name: 'Нурлис', hp: 1700, speed: 3.6, damage: 200, color: '#fb8c00' }
];

let selectedBrawler = BRAWLERS[0];
let currentRoom = null;

// Отрисовка списка героев в меню
const brawlersGrid = document.getElementById('brawlers-list');
BRAWLERS.forEach((b, index) => {
    const card = document.createElement('div');
    card.className = `brawler-card ${index === 0 ? 'active' : ''}`;
    card.innerHTML = `
        <h4 style="color:${b.color}">${b.name}</h4>
        <small>HP: ${b.hp} | SPD: ${b.speed}</small>
    `;
    card.onclick = () => {
        document.querySelectorAll('.brawler-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selectedBrawler = b;
    };
    brawlersGrid.appendChild(card);
});

// Кнопки управления комнатами
document.getElementById('btn-create').onclick = () => {
    socket.emit('createRoom');
};

document.getElementById('btn-join').onclick = () => {
    const code = document.getElementById('room-input').value.trim().toUpperCase();
    if (code) socket.emit('joinRoom', code);
};

socket.on('roomCreated', (roomId) => {
    currentRoom = roomId;
    document.getElementById('lobby-code').innerText = roomId;
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
});

socket.on('playerJoined', (players) => {
    const list = document.getElementById('players-list');
    list.innerHTML = players.map((p, i) => `<p>Игрок ${i + 1}: ${p.substring(0, 5)}</p>`).join('');
});

socket.on('errorMsg', (msg) => alert(msg));

document.getElementById('btn-start').onclick = () => {
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    initGame();
};

// Логика самой игры
function initGame() {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 800;
    canvas.height = 500;

    let player = {
        x: 400,
        y: 250,
        hp: selectedBrawler.hp,
        maxHp: selectedBrawler.hp,
        speed: selectedBrawler.speed,
        color: selectedBrawler.color
    };

    const keys = {};
    window.onkeydown = (e) => keys[e.code] = true;
    window.onkeyup = (e) => keys[e.code] = false;

    function loop() {
        if (keys['KeyW'] || keys['ArrowUp']) player.y -= player.speed;
        if (keys['KeyS'] || keys['ArrowDown']) player.y += player.speed;
        if (keys['KeyA'] || keys['ArrowLeft']) player.x -= player.speed;
        if (keys['KeyD'] || keys['ArrowRight']) player.x += player.speed;

        // Границы карты
        player.x = Math.max(20, Math.min(canvas.width - 20, player.x));
        player.y = Math.max(20, Math.min(canvas.height - 20, player.y));

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Отрисовка игрока
        ctx.beginPath();
        ctx.arc(player.x, player.y, 20, 0, Math.PI * 2);
        ctx.fillStyle = player.color;
        ctx.fill();
        ctx.closePath();

        // Полоска HP
        ctx.fillStyle = 'red';
        ctx.fillRect(player.x - 25, player.y - 35, 50, 6);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(player.x - 25, player.y - 35, (player.hp / player.maxHp) * 50, 6);

        requestAnimationFrame(loop);
    }
    loop();
}
