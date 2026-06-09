import { initDiscord } from './discord_sdk.js';
import { CanvasDrawer } from './canvas_drawer.js';
import { SocketClient } from './socket_client.js';

async function start() {
    const loading = document.getElementById('loading-overlay');
    
    // 1. Инициализация Discord
    const discordData = await initDiscord();
    document.getElementById('room-id').innerText = `Room: ${discordData.channelId}`;

    // 2. Инициализация Canvas
    const canvas = document.getElementById('whiteboard');
    const drawer = new CanvasDrawer({
        canvas,
        onStrokeStart: (data) => socket.send(data),
        onStrokePoint: (data) => {
            // Оптимизация: шлем курсор при движении
            socket.send({ type: 'cursor', x: data.x, y: data.y, color: drawer.color });
        },
        onStrokeEnd: (data) => socket.send(data)
    });

    // 3. Инициализация WebSocket
    const serverUrl = window.BACKEND_URL || "wss://vibeboard-server.onrender.com";
    const socket = new SocketClient({
        serverUrl,
        roomId: discordData.channelId,
        userId: discordData.userId,
        onMessage: (msg) => {
            if (msg.type === 'full_state') {
                drawer.replayAll(msg.strokes);
            } else if (msg.type === 'stroke_end') {
                drawer.replayStroke(msg);
            } else if (msg.type === 'cursor') {
                drawer.updateRemoteCursor(msg.user_id, msg.x, msg.y, msg.color, msg.name);
            } else if (msg.type === 'clear') {
                drawer.clear();
            } else if (msg.type === 'user_joined' || msg.type === 'user_left') {
                document.getElementById('user-count').innerHTML = `<i class="fas fa-users"></i> ${msg.count}`;
            }
        },
        onOpen: () => {
            loading.style.display = 'none';
        }
    });
    socket.connect();

    // 4. Обработка UI событий
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelector('.tool-btn.active').classList.remove('active');
            btn.classList.add('active');
            drawer.setTool(btn.dataset.tool);
        };
    });

    document.getElementById('color-picker').oninput = (e) => drawer.setColor(e.target.value);
    document.getElementById('size-slider').oninput = (e) => drawer.setSize(parseInt(e.target.value));
    document.getElementById('opacity-slider').oninput = (e) => drawer.setOpacity(parseFloat(e.target.value));
    
    document.getElementById('btn-clear').onclick = () => {
        if(confirm("Clear canvas for everyone?")) {
            socket.send({ type: 'clear' });
            drawer.clear();
        }
    };

    document.getElementById('btn-undo').onclick = () => {
        socket.send({ type: 'undo' });
    };

    document.getElementById('btn-export').onclick = () => {
        const link = document.createElement('a');
        link.download = 'vibe-board.png';
        link.href = drawer.getDataURL();
        link.click();
    };
}

window.onload = start;
