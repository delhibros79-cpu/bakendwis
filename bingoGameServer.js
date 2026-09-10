const activeBingoGames = new Map();

// Generate a random 5x5 Bingo card
function generateBingoCard() {
    const card = [];
    const ranges = [
        { min: 1, max: 15 },
        { min: 16, max: 30 },
        { min: 31, max: 45 },
        { min: 46, max: 60 },
        { min: 61, max: 75 }
    ];

    for (let col = 0; col < 5; col++) {
        const columnNumbers = [];
        while (columnNumbers.length < 5) {
            const num = Math.floor(Math.random() * (ranges[col].max - ranges[col].min + 1)) + ranges[col].min;
            if (!columnNumbers.includes(num)) {
                columnNumbers.push(num);
            }
        }
        card.push(columnNumbers);
    }

    // Transpose to get rows (so row 0 has one from B, I, N, G, O)
    const finalCard = [];
    for (let row = 0; row < 5; row++) {
        const newRow = [];
        for (let col = 0; col < 5; col++) {
            newRow.push(card[col][row]);
        }
        finalCard.push(newRow);
    }
    
    // Middle is free space (0 or -1)
    finalCard[2][2] = 0; 
    
    return finalCard;
}

// Check winning pattern
function hasBingo(card, markedCells) {
    // markedCells is an array of marked numbers or '0' for free space
    const isMarked = (num) => markedCells.includes(num) || num === 0;

    // Check rows
    for (let i = 0; i < 5; i++) {
        if (card[i].every(num => isMarked(num))) return true;
    }
    // Check columns
    for (let i = 0; i < 5; i++) {
        if ([0, 1, 2, 3, 4].every(row => isMarked(card[row][i]))) return true;
    }
    // Check diagonals
    if ([0, 1, 2, 3, 4].every(i => isMarked(card[i][i]))) return true;
    if ([0, 1, 2, 3, 4].every(i => isMarked(card[i][4 - i]))) return true;
    
    // Check 4 corners
    if (isMarked(card[0][0]) && isMarked(card[0][4]) && isMarked(card[4][0]) && isMarked(card[4][4])) return true;

    return false;
}

function registerBingoHandlers(io, socket, db, admin) {
    
    socket.on('bingo_get_state', (data) => {
        const { roomId } = data;
        let gameState = activeBingoGames.get(roomId);
        if (!gameState) {
            gameState = {
                status: 'waiting',
                players: {},
                shopCards: [generateBingoCard(), generateBingoCard(), generateBingoCard(), generateBingoCard()],
                totalCards: 0,
                drawnNumbers: [],
                winners: [],
                countdown: 0
            };
            activeBingoGames.set(roomId, gameState);
        }
        socket.emit('bingo_state_update', gameState);
    });

    socket.on('bingo_join', (data) => {
        const { roomId, userId, username, photoURL } = data;
        let gameState = activeBingoGames.get(roomId);
        if (!gameState) {
            gameState = {
                status: 'waiting',
                players: {},
                shopCards: [generateBingoCard(), generateBingoCard(), generateBingoCard(), generateBingoCard()],
                totalCards: 0,
                drawnNumbers: [],
                winners: [],
                countdown: 0
            };
            activeBingoGames.set(roomId, gameState);
        }

        if (gameState.status === 'waiting') {
            if (!gameState.players[userId]) {
                gameState.players[userId] = { cards: [], username, photoURL, marked: [0], boughtIndices: [] };
                io.to(roomId).emit('bingo_state_update', gameState);
            } else {
                // Just send state if already joined
                socket.emit('bingo_state_update', gameState);
            }
        } else {
            // If playing or ended, just send state to spectate
            socket.emit('bingo_state_update', gameState);
        }
    });

    socket.on('bingo_buy_card', async (data) => {
        const { roomId, userId, username, photoURL, cardIndex } = data;
        let gameState = activeBingoGames.get(roomId);
        if (!gameState) return;
        if (gameState.status !== 'waiting') return;

        const player = gameState.players[userId] || { cards: [], username, photoURL, marked: [0], boughtIndices: [] };
        if (player.cards.length >= 4) {
            socket.emit('bingo_error', { message: 'Maximum 4 cards per round.' });
            return;
        }

        if (cardIndex < 0 || cardIndex > 3 || !gameState.shopCards[cardIndex]) {
            socket.emit('bingo_error', { message: 'Invalid card selected.' });
            return;
        }

        if (player.boughtIndices.includes(cardIndex)) {
            socket.emit('bingo_error', { message: 'You already bought this card.' });
            return;
        }

        try {
            const userRef = db.collection('userProfiles').doc(userId);
            await db.runTransaction(async (t) => {
                const doc = await t.get(userRef);
                if (!doc.exists) throw new Error('User not found');
                const coins = doc.data().coins || 0;
                if (coins < 20) throw new Error('Insufficient coins');
                t.update(userRef, { coins: coins - 20 });
            });

            player.cards.push(gameState.shopCards[cardIndex]);
            player.boughtIndices.push(cardIndex);
            gameState.players[userId] = player;
            gameState.totalCards += 1;

            io.to(roomId).emit('bingo_state_update', gameState);
            socket.emit('bingo_card_purchased', { cards: player.cards });
        } catch (e) {
            socket.emit('bingo_error', { message: e.message });
        }
    });

    socket.on('bingo_return_card', async (data) => {
        const { roomId, userId } = data;
        let gameState = activeBingoGames.get(roomId);
        if (!gameState || gameState.status !== 'waiting') return;

        const player = gameState.players[userId];
        if (!player || player.cards.length === 0) return;

        const cardsCount = player.cards.length;
        const refundAmount = cardsCount * 20;

        try {
            const userRef = db.collection('userProfiles').doc(userId);
            await db.runTransaction(async (t) => {
                const doc = await t.get(userRef);
                if (!doc.exists) return;
                t.update(userRef, { coins: (doc.data().coins || 0) + refundAmount });
            });

            gameState.totalCards -= cardsCount;
            delete gameState.players[userId];

            io.to(roomId).emit('bingo_state_update', gameState);
        } catch (e) {
            console.error(e);
        }
    });

    socket.on('bingo_start_game', (data) => {
        const { roomId } = data;
        let gameState = activeBingoGames.get(roomId);
        if (!gameState || gameState.status !== 'waiting') return;

        const playersWithCards = Object.values(gameState.players).filter(p => p.cards && p.cards.length > 0);
        if (playersWithCards.length < 2) {
            socket.emit('bingo_error', { message: 'Need at least 2 players with cards to start.' });
            return;
        }

        gameState.status = 'countdown';
        gameState.countdown = 3;
        io.to(roomId).emit('bingo_state_update', gameState);

        let count = 3;
        const countInterval = setInterval(() => {
            count--;
            gameState.countdown = count;
            io.to(roomId).emit('bingo_state_update', gameState);
            if (count <= 0) {
                clearInterval(countInterval);
                gameState.status = 'playing';
                io.to(roomId).emit('bingo_state_update', gameState);
                startGameLoop(roomId);
            }
        }, 1000);
    });

    function startGameLoop(roomId) {
        let gameState = activeBingoGames.get(roomId);
        if (!gameState) return;

        const allNumbers = [];
        const letters = ['B', 'I', 'N', 'G', 'O'];
        for (let i = 0; i < 5; i++) {
            for (let j = 1; j <= 15; j++) {
                allNumbers.push({ letter: letters[i], number: i * 15 + j });
            }
        }

        // Shuffle
        for (let i = allNumbers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allNumbers[i], allNumbers[j]] = [allNumbers[j], allNumbers[i]];
        }

        const loopInterval = setInterval(() => {
            gameState = activeBingoGames.get(roomId);
            if (!gameState || gameState.status !== 'playing') {
                clearInterval(loopInterval);
                return;
            }

            if (allNumbers.length === 0) {
                clearInterval(loopInterval);
                endBingoGame(roomId);
                return;
            }

            const nextNum = allNumbers.pop();
            gameState.drawnNumbers.push(nextNum);
            io.to(roomId).emit('bingo_number_drawn', nextNum);

        }, 5000);
        
        Object.defineProperty(gameState, 'loopInterval', {
            value: loopInterval,
            enumerable: false,
            writable: true
        });
    }

    socket.on('bingo_mark_number', (data) => {
        const { roomId, userId, number } = data;
        let gameState = activeBingoGames.get(roomId);
        if (!gameState || gameState.status !== 'playing') return;

        const player = gameState.players[userId];
        if (!player) return;

        const isDrawn = gameState.drawnNumbers.some(n => n.number === number);
        if (isDrawn) {
            if (!player.marked.includes(number)) {
                player.marked.push(number);
                socket.emit('bingo_mark_success', { number });
            }
        } else {
            // Apply 6 second penalty
            socket.emit('bingo_penalty');
        }
    });

    socket.on('bingo_claim', async (data) => {
        const { roomId, userId } = data;
        let gameState = activeBingoGames.get(roomId);
        if (!gameState || gameState.status !== 'playing') return;

        const player = gameState.players[userId];
        if (!player) return;

        let hasWon = false;
        for (const card of player.cards) {
            if (hasBingo(card, player.marked)) {
                hasWon = true;
                break;
            }
        }

        if (hasWon) {
            if (!gameState.winners.some(w => w.userId === userId)) {
                gameState.winners.push({ userId, username: player.username, rank: gameState.winners.length + 1 });
                io.to(roomId).emit('bingo_winner_announced', { username: player.username, rank: gameState.winners.length });
                
                // Give others 5 seconds to claim Bingo too
                if (gameState.winners.length === 1) {
                    setTimeout(() => {
                        endBingoGame(roomId);
                    }, 5000);
                }
            }
        } else {
            socket.emit('bingo_penalty');
        }
    });

    async function endBingoGame(roomId) {
        let gameState = activeBingoGames.get(roomId);
        if (!gameState || gameState.status !== 'playing') return;

        if (gameState.loopInterval) clearInterval(gameState.loopInterval);
        gameState.status = 'ended';

        const totalRewards = gameState.totalCards * 20 * 10;
        
        // Calculate distribution
        const results = [];
        if (gameState.winners.length > 0) {
            const numWinners = gameState.winners.length;
            // Simple logic: 1st place gets 60% of total pool + basic bonus, others split the rest.
            // But we will follow roughly: Total rewards distributed among winners.
            const baseBonus = 20 * 10; 
            const distributablePool = Math.max(0, totalRewards - (baseBonus * numWinners));
            
            for (let i = 0; i < numWinners; i++) {
                const w = gameState.winners[i];
                let share = 0;
                if (numWinners === 1) {
                    share = distributablePool;
                } else if (i === 0) {
                    share = Math.floor(distributablePool * 0.7);
                } else {
                    share = Math.floor((distributablePool * 0.3) / (numWinners - 1));
                }
                const reward = baseBonus + share;
                results.push({ ...w, reward });
                
                try {
                    const userRef = db.collection('userProfiles').doc(w.userId);
                    await userRef.update({ coins: admin.firestore.FieldValue.increment(reward) });
                } catch (e) {
                    console.error("Failed to pay bingo winner:", e);
                }
            }
        }

        io.to(roomId).emit('bingo_game_ended', { results });
        
        // Clear game state after 15 seconds
        setTimeout(() => {
            const newGameState = {
                status: 'waiting',
                players: {},
                shopCards: [generateBingoCard(), generateBingoCard(), generateBingoCard(), generateBingoCard()],
                totalCards: 0,
                drawnNumbers: [],
                winners: [],
                countdown: 0
            };
            activeBingoGames.set(roomId, newGameState);
            io.to(roomId).emit('bingo_state_update', newGameState);
        }, 15000);
    }
}

module.exports = { registerBingoHandlers };
