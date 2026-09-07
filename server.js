const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Раздаем ВСЕ статические файлы из папки public
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Генерация короткого кода комнаты
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('Игрок подключился:', socket.id);

    // Создание комнаты
    socket.on('createRoom', (data) => {
        const roomId = generateRoomId();
        rooms[roomId] = {
            id: roomId,
            players: {},
            started: false
        };

        rooms[roomId].players[socket.id] = {
            id: socket.id,
            brawler: data.brawler,
            x: 100 + Math.random() * 200,
            y: 100 + Math.random() * 200,
            dx: 0,
            dy: 0,
            attacking: false
        };

        socket.join(roomId);
        socket.emit('roomCreated', { roomId, players: rooms[roomId].players });
    });

    // Подключение к комнате
    socket.on('joinRoom', (data) => {
        const roomId = data.roomId;
        if (rooms[roomId]) {
            rooms[roomId].players[socket.id] = {
                id: socket.id,
                brawler: data.brawler,
                x: 100 + Math.random() * 200,
                y: 100 + Math.random() * 200,
                dx: 0,
                dy: 0,
                attacking: false
            };

            socket.join(roomId);
            socket.emit('roomJoined', { roomId, players: rooms[roomId].players });
            io.to(roomId).emit('updatePlayers', rooms[roomId].players);
        } else {
            socket.emit('errorMsg', 'Комната не найдена!');
        }
    });

    // Старт игры
    socket.on('startGame', (data) => {
        if (rooms[data.roomId]) {
            rooms[data.roomId].started = true;
            io.to(data.roomId).emit('gameStarted');
        }
    });

    // Обработка ввода (движение + атака)
    socket.on('playerInput', (data) => {
        const room = rooms[data.roomId];
        if (room && room.players[socket.id]) {
            const player = room.players[socket.id];
            const speed = player.brawler ? player.brawler.speed : 5;

            player.x += data.dx * speed;
            player.y += data.dy * speed;
            player.attacking = data.attacking;
        }
    });

    // Отключение
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            if (rooms[roomId].players[socket.id]) {
                delete rooms[roomId].players[socket.id];
                io.to(roomId).emit('updatePlayers', rooms[roomId].players);
                break;
            }
        }
    });
});

// Игровой цикл на сервере (30 FPS)
setInterval(() => {
    for (const roomId in rooms) {
        if (rooms[roomId].started) {
            io.to(roomId).emit('stateUpdate', rooms[roomId]);
        }
    }
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
