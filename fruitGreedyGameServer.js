const SLICES = [
    { id: 1, type: 'apple', label: '🍎', color: '#ff3b30', angle: 0 },
    { id: 2, type: 'lemon', label: '🍋', color: '#ffcc00', angle: 45 },
    { id: 3, type: 'strawberry', label: '🍓', color: '#ff2d55', angle: 90 },
    { id: 4, type: 'mango', label: '🥭', color: '#ff9500', angle: 135 },
    { id: 5, type: 'fish', label: '🐟', color: '#5ac8fa', angle: 180 },
    { id: 6, type: 'burger', label: '🍔', color: '#a2845e', angle: 225 },
    { id: 7, type: 'pizza', label: '🍕', color: '#ffcc5c', angle: 270 },
    { id: 8, type: 'chicken', label: '🍗', color: '#8b4513', angle: 315 },
];

const MULTIPLIERS = {
    chicken: 45, pizza: 25, burger: 15, fish: 10,
    apple: 5, lemon: 5, strawberry: 5, mango: 5
};

let fruitGreedyGameState = 'betting';
let timeLeft = 15;
let winningSlice = null;
let roundBets = [];
let recentResults = ['apple', 'strawberry', 'lemon', 'mango'];

function startFruitGreedyGameLoop(io, db, admin) {
    console.log("⚡ Starting Global Fruit Greedy Game Loop");
    setInterval(() => {
        if (fruitGreedyGameState === 'betting') {
            timeLeft--;
            io.emit('fruit_greedy_game_tick', { timeLeft, gameState: fruitGreedyGameState });
            
            if (timeLeft <= 0) {
                fruitGreedyGameState = 'spinning';
                
                // --- HOUSE EDGE & PROFIT CONTROL LOGIC ---
                winningSlice = pickWinningSlice(roundBets);
                
                io.emit('fruit_greedy_game_spin', { winningSlice, gameState: fruitGreedyGameState });
                
                // Spin animation duration is 5s
                setTimeout(() => {
                    fruitGreedyGameState = 'result';
                    recentResults = [winningSlice.type, ...recentResults].slice(0, 8);
                    
                    io.emit('fruit_greedy_game_result', { winningSlice, recentResults, gameState: fruitGreedyGameState });
                    
                    // Process payouts!
                    processPayouts(db, admin, winningSlice.type);
                    
                    // Result shows for 5s
                    setTimeout(() => {
                        fruitGreedyGameState = 'betting';
                        timeLeft = 15;
                        roundBets = []; // Reset bets for new round
                        winningSlice = null;
                        
                        io.emit('fruit_greedy_game_state', { gameState: fruitGreedyGameState, timeLeft, recentResults });
                    }, 5000);
                    
                }, 5000);
            }
        }
    }, 1000);
}

function pickWinningSlice(currentBets) {
    let newPlayerBet = null;
    let totalBetPool = 0;
    const payouts = { chicken: 0, pizza: 0, burger: 0, fish: 0, apple: 0, lemon: 0, strawberry: 0, mango: 0 };

    for (const bet of currentBets) {
        totalBetPool += bet.amount;
        payouts[bet.type] += (bet.amount * MULTIPLIERS[bet.type]);
        
        // Check for Beginner's Luck
        if (bet.isNewPlayer && bet.amount <= 1000) {
            newPlayerBet = bet.type;
        }
    }

    // Rule 1: Beginner's Luck (force win)
    let chosenType = null;
    if (newPlayerBet) {
        chosenType = newPlayerBet;
    } 
    // Rule 2: Rigged for Profit (If high stakes, pick lowest payout)
    else if (totalBetPool > 5000) {
        let lowestPayoutType = 'apple';
        let lowestAmount = Infinity;
        
        for (const type of Object.keys(payouts)) {
            if (payouts[type] < lowestAmount) {
                lowestAmount = payouts[type];
                lowestPayoutType = type;
            }
        }
        
        chosenType = lowestPayoutType;
    } 
    // Rule 3: Weighted Math (Normal Play)
    else {
        const rand = Math.random();
        if (rand < 0.15) chosenType = 'apple';
        else if (rand < 0.30) chosenType = 'lemon';
        else if (rand < 0.45) chosenType = 'strawberry';
        else if (rand < 0.60) chosenType = 'mango';
        else if (rand < 0.75) chosenType = 'fish'; // x10
        else if (rand < 0.88) chosenType = 'burger'; // x15
        else if (rand < 0.96) chosenType = 'pizza'; // x25
        else chosenType = 'chicken'; // x45
    }

    const possibleSlices = SLICES.filter(s => s.type === chosenType);
    return possibleSlices[Math.floor(Math.random() * possibleSlices.length)];
}

async function processPayouts(db, admin, winningType) {
    if (roundBets.length === 0) return;
    
    // Group winning bets by user
    const userWinnings = {};
    for (const bet of roundBets) {
        if (bet.type === winningType) {
            const multiplier = MULTIPLIERS[winningType];
            const winAmount = bet.amount * multiplier;
            if (!userWinnings[bet.userId]) userWinnings[bet.userId] = 0;
            userWinnings[bet.userId] += winAmount;
        }
    }
    
    // Execute payouts directly to Firebase
    for (const [userId, amount] of Object.entries(userWinnings)) {
        try {
            const userRef = db.collection('userProfiles').doc(userId);
            await userRef.update({
                coins: admin.firestore.FieldValue.increment(amount)
            });
            console.log(`[FruitGreedyGame] Paid ${amount} coins to user ${userId}`);
        } catch (e) {
            console.error(`[FruitGreedyGame] Error paying out user ${userId}:`, e);
        }
    }
}

function registerFruitGreedyGameHandlers(socket, db, admin) {
    // Client wants to know current game state when opening sheet
    socket.on('get_fruit_greedy_game_state', () => {
        socket.emit('fruit_greedy_game_state', {
            gameState: fruitGreedyGameState,
            timeLeft: timeLeft,
            recentResults: recentResults,
            winningSlice: winningSlice
        });
    });

    // Client places a bet
    socket.on('fruit_greedy_place_bet', async (data) => {
        const { userId, type, amount } = data;
        
        if (fruitGreedyGameState !== 'betting') {
            socket.emit('fruit_greedy_bet_error', { message: 'Betting is closed for this round!' });
            return;
        }
        
        if (!userId || !type || !amount || amount <= 0) return;
        
        try {
            const userRef = db.collection('userProfiles').doc(userId);
            
            // Deduct securely in a transaction and check if new player
            let isNewPlayer = false;
            await db.runTransaction(async (transaction) => {
                const userDoc = await transaction.get(userRef);
                if (!userDoc.exists) throw new Error("User does not exist");
                
                const userData = userDoc.data();
                const currentCoins = userData.coins || 0;
                
                // Flag as new player if they haven't won fruit greedy game before
                if (!userData.hasPlayedFruitGreedy) {
                    isNewPlayer = true;
                    transaction.update(userRef, { hasPlayedFruitGreedy: true });
                }

                if (currentCoins < amount) {
                    throw new Error("Insufficient coins");
                }
                
                transaction.update(userRef, {
                    coins: admin.firestore.FieldValue.increment(-amount)
                });
            });
            
            // Record bet
            roundBets.push({ userId, type, amount, isNewPlayer });
            
            // Send success acknowledgement to THIS specific user only
            socket.emit('fruit_greedy_bet_success', { type, amount }); 
            
        } catch (e) {
            console.error(`[FruitGreedyGame] Error placing bet for user ${userId}:`, e);
            socket.emit('fruit_greedy_bet_error', { message: e.message });
        }
    });
}

module.exports = { startFruitGreedyGameLoop, registerFruitGreedyGameHandlers };
