const activeJakaroGames = new Map();
const jakaroBotTimers = new Map();

// Random bot generator
function generateRandomBot(seatIndex) {
    const randomNames = ['Oliver', 'Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'William', 'Sophia', 'James', 'Isabella', 'Rusta', 'izzat', 'crose'];
    const name = randomNames[Math.floor(Math.random() * randomNames.length)];
    const avatarId = Math.floor(Math.random() * 70) + 1; // 1 to 70 pravatar
    return {
        id: `bot_${Math.random().toString(36).substring(2, 9)}`,
        username: `${name}_bot`,
        photoURL: `https://i.pravatar.cc/150?u=${avatarId}`,
        isBot: true,
        seatIndex
    };
}

function registerJakaroHandlers(io, socket, db, admin) {
    
    socket.on('jakaro_join_room', (data) => {
        const { roomId, userId, username, photoURL } = data || {};
        
        if (!roomId || !userId) {
            socket.emit('jakaro_error', { message: 'Missing roomId or userId' });
            return;
        }

        let gameState = activeJakaroGames.get(roomId);
        if (!gameState) {
            gameState = {
                status: 'waiting',
                players: {}, // mapped by seatIndex: 0, 1, 2, 3
                startedAt: null
            };
            activeJakaroGames.set(roomId, gameState);
        }

        if (gameState.status === 'playing') {
            socket.emit('jakaro_error', { message: 'Game already in progress' });
            return;
        }

        // Check if player is already in the room
        let playerSeat = Object.keys(gameState.players).find(seat => gameState.players[seat]?.id === userId);
        
        if (!playerSeat) {
            // Find first empty seat
            const emptySeat = [0, 1, 2, 3].find(seat => !gameState.players[seat]);
            if (emptySeat !== undefined) {
                gameState.players[emptySeat] = {
                    id: userId,
                    username: username || 'Player',
                    photoURL: photoURL || `https://i.pravatar.cc/150?u=${userId}`,
                    isBot: false,
                    seatIndex: emptySeat
                };
            } else {
                socket.emit('jakaro_error', { message: 'Room is full' });
                return;
            }
        }

        socket.join(roomId);
        
        // Broadcast updated room state
        io.to(roomId).emit('jakaro_room_update', gameState);

        // If we just created the room or it's waiting, start bot matching timer
        if (!jakaroBotTimers.has(roomId) && gameState.status === 'waiting') {
            const botInterval = setInterval(() => {
                const currentState = activeJakaroGames.get(roomId);
                if (!currentState || currentState.status !== 'waiting') {
                    clearInterval(botInterval);
                    jakaroBotTimers.delete(roomId);
                    return;
                }

                const emptySeats = [0, 1, 2, 3].filter(seat => !currentState.players[seat]);
                
                if (emptySeats.length > 0) {
                    // Add one bot
                    const seatForBot = emptySeats[0];
                    currentState.players[seatForBot] = generateRandomBot(seatForBot);
                    io.to(roomId).emit('jakaro_room_update', currentState);
                    
                    // Check if full after adding bot
                    if (emptySeats.length === 1) { // It was 1 before adding, now 0
                        clearInterval(botInterval);
                        jakaroBotTimers.delete(roomId);
                        currentState.status = 'playing';
                        currentState.startedAt = new Date().toISOString();
                        
                        setTimeout(() => {
                            io.to(roomId).emit('jakaro_game_start', currentState);
                        }, 1000); // Small delay for UX
                    }
                }
            }, 2500); // Bot joins every 2.5 seconds
            
            jakaroBotTimers.set(roomId, botInterval);
        }
    });

    socket.on('jakaro_leave_room', (data) => {
        const { roomId, userId } = data || {};
        if (!roomId || !userId) return;

        socket.leave(roomId);
        
        const gameState = activeJakaroGames.get(roomId);
        if (gameState) {
            // Find player seat
            const seat = Object.keys(gameState.players).find(s => gameState.players[s]?.id === userId);
            if (seat !== undefined) {
                delete gameState.players[seat];
                io.to(roomId).emit('jakaro_room_update', gameState);
                
                // If no real players left, cleanup room
                const hasRealPlayers = Object.values(gameState.players).some(p => !p.isBot);
                if (!hasRealPlayers) {
                    const timer = jakaroBotTimers.get(roomId);
                    if (timer) {
                        clearInterval(timer);
                        jakaroBotTimers.delete(roomId);
                    }
                    activeJakaroGames.delete(roomId);
                }
            }
        }
    });
}

module.exports = {
    registerJakaroHandlers
};
