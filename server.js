const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const ROOMS = {};
const MAP_WIDTH = 1600;
const MAP_HEIGHT = 1200;

// Препятствия (стены)
const OBSTACLES = [
    { x: 400, y: 300, w: 200, h: 40 },
    { x: 1000, y: 300, w: 200, h: 40 },
    { x: 700, y: 500, w: 200, h: 200 },
    { x: 400, y: 860, w: 200, h: 40 },
    { x: 1000, y: 860, w: 200, h: 40 }
];

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    socket.on('createRoom', ({ brawler }) => {
        const roomId = generateRoomId();
        ROOMS[roomId] = {
            id: roomId,
            started: false,
            players: {},
            bullets: []
        };
        socket.join(roomId);
        socket.roomId = roomId;
        
        // Безопасный спавн (слева внизу)
        ROOMS[roomId].players[socket.id] = {
            id: socket.id,
            x: 200,
            y: 1000,
            angle: 0,
            hp: brawler.hp,
            maxHp: brawler.hp,
            brawler: brawler
        };

        socket.emit('roomCreated', roomId);
        io.to(roomId).emit('updateLobby', Object.values(ROOMS[roomId].players));
    });

    socket.on('joinRoom', ({ roomId, brawler }) => {
        const room = ROOMS[roomId];
        if (room && !room.started) {
            socket.join(roomId);
            socket.roomId = roomId;

            // Безопасный спавн (справа вверху)
            room.players[socket.id] = {
                id: socket.id,
                x: 1400,
                y: 200,
                angle: 0,
                hp: brawler.hp,
                maxHp: brawler.hp,
                brawler: brawler
            };

            socket.emit('roomJoined', roomId);
            io.to(roomId).emit('updateLobby', Object.values(room.players));
        }
    });

    socket.on('startGame', (roomId) => {
        const room = ROOMS[roomId];
        if (room) {
            room.started = true;
            io.to(roomId).emit('gameStarted');
        }
    });

    socket.on('playerMove', ({ roomId, dx, dy }) => {
        const room = ROOMS[roomId];
        if (!room || !room.players[socket.id]) return;

        const p = room.players[socket.id];
        let nextX = p.x + dx * p.brawler.speed;
        let nextY = p.y + dy * p.brawler.speed;

        nextX = Math.max(30, Math.min(MAP_WIDTH - 30, nextX));
        nextY = Math.max(30, Math.min(MAP_HEIGHT - 30, nextY));

        let canMove = true;
        OBSTACLES.forEach(obs => {
            if (nextX + 20 > obs.x && nextX - 20 < obs.x + obs.w &&
                nextY + 20 > obs.y && nextY - 20 < obs.y + obs.h) {
                canMove = false;
            }
        });

        if (canMove) {
            p.x = nextX;
            p.y = nextY;
            p.angle = Math.atan2(dy, dx);
        }
    });

    socket.on('attack', ({ roomId, angle }) => {
        const room = ROOMS[roomId];
        if (!room || !room.players[socket.id]) return;

        const p = room.players[socket.id];
        const shootAngle = angle !== undefined ? angle : p.angle;

        room.bullets.push({
            id: Math.random().toString(),
            ownerId: socket.id,
            x: p.x + Math.cos(shootAngle) * 25,
            y: p.y + Math.sin(shootAngle) * 25,
            vx: Math.cos(shootAngle) * 12,
            vy: Math.sin(shootAngle) * 12,
            damage: p.brawler.damage,
            color: p.brawler.color,
            life: 60
        });
    });

    socket.on('disconnect', () => {
        if (socket.roomId && ROOMS[socket.roomId]) {
            delete ROOMS[socket.roomId].players[socket.id];
            io.to(socket.roomId).emit('updateLobby', Object.values(ROOMS[socket.roomId].players));
        }
    });
});

setInterval(() => {
    Object.values(ROOMS).forEach(room => {
        if (!room.started) return;

        for (let i = room.bullets.length - 1; i >= 0; i--) {
            const b = room.bullets[i];
            b.x += b.vx;
            b.y += b.vy;
            b.life--;

            let hitWall = false;
            OBSTACLES.forEach(obs => {
                if (b.x > obs.x && b.x < obs.x + obs.w && b.y > obs.y && b.y < obs.y + obs.h) {
                    hitWall = true;
                }
            });

            if (hitWall || b.life <= 0 || b.x < 0 || b.x > MAP_WIDTH || b.y < 0 || b.y > MAP_HEIGHT) {
                room.bullets.splice(i, 1);
                continue;
            }

            Object.values(room.players).forEach(p => {
                if (p.id !== b.ownerId) {
                    const dist = Math.hypot(p.x - b.x, p.y - b.y);
                    if (dist < 25) {
                        p.hp -= b.damage;
                        if (p.hp <= 0) {
                            p.hp = p.maxHp;
                            p.x = 200;
                            p.y = 1000;
                        }
                        room.bullets.splice(i, 1);
                    }
                }
            });
        }

        io.to(room.id).emit('gameStateUpdate', {
            players: room.players,
            bullets: room.bullets,
            obstacles: OBSTACLES,
            mapWidth: MAP_WIDTH,
            mapHeight: MAP_HEIGHT
        });
    });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
