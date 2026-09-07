const socket = io();

const BRAWLERS = [
    { id: 'atai', name: 'Атай', hp: 1800, speed: 4.2, damage: 280, color: '#ffd700' },
    { id: 'bekzhan', name: 'Бекжан', hp: 2600, speed: 3.2, damage: 160, color: '#4caf50' },
    { id: 'aidomur', name: 'Айдомур', hp: 2000, speed: 2.7, damage: 380, color: '#e53935' },
    { id: 'bilal', name: 'Билал', hp: 2200, speed: 2.4, damage: 250, color: '#8e24aa' },
    { id: 'arlen', name: 'Арлен', hp: 1300, speed: 5.2, damage: 130, color: '#00acc1' },
    { id: 'nurlis', name: 'Нурлис', hp: 1700, speed: 3.6, damage: 200, color: '#fb8c00' }
];

let selectedBrawler = BRAWLERS[0];
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

document.getElementById('btn-create').onclick = () => socket.emit('createRoom');
document.getElementById('btn-join').onclick = () => {
    const code = document.getElementById('room-input').value.trim().toUpperCase();
    if (code) socket.emit('joinRoom', code);
};

socket.on('roomCreated', (roomId) => {
    document.getElementById('lobby-code').innerText = roomId;
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
});

socket.on('playerJoined', (players) => {
    document.getElementById('players-list').innerHTML = players.map((p, i) => `<p>Игрок ${i + 1}</p>`).join('');
});

document.getElementById('btn-start').onclick = () => {
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    initGame();
};

function initGame() {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 800;
    canvas.height = 500;

    let player = {
        x: 400, y: 250,
        hp: selectedBrawler.hp, maxHp: selectedBrawler.hp,
        speed: selectedBrawler.speed, color: selectedBrawler.color
    };

    let moveX = 0;
    let moveY = 0;

    // Сенсорный Джойстик
    const base = document.getElementById('joystick-base');
    const stick = document.getElementById('joystick-stick');
    let touchId = null;

    base.addEventListener('touchstart', (e) => {
        const touch = e.changedTouches[0];
        touchId = touch.identifier;
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

    function loop() {
        player.x += moveX * player.speed;
        player.y += moveY * player.speed;

        player.x = Math.max(20, Math.min(canvas.width - 20, player.x));
        player.y = Math.max(20, Math.min(canvas.height - 20, player.y));

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.beginPath();
        ctx.arc(player.x, player.y, 20, 0, Math.PI * 2);
        ctx.fillStyle = player.color;
        ctx.fill();

        ctx.fillStyle = 'red';
        ctx.fillRect(player.x - 25, player.y - 35, 50, 6);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(player.x - 25, player.y - 35, (player.hp / player.maxHp) * 50, 6);

        requestAnimationFrame(loop);
    }
    loop();
}
