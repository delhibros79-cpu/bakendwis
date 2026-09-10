const SLICES = [
    { id: 1, type: 'watermelon', label: '🍉', color: '#ffb347', angle: 0 },
    { id: 2, type: 'mango', label: '🥭', color: '#ffcc5c', angle: 40 },
    { id: 3, type: 'watermelon', label: '🍉', color: '#ffb347', angle: 80 },
    { id: 4, type: 'mango', label: '🥭', color: '#ffcc5c', angle: 120 },
    { id: 5, type: '77', label: '77', color: '#ff6f69', angle: 160 },
    { id: 6, type: 'watermelon', label: '🍉', color: '#ffb347', angle: 200 },
    { id: 7, type: 'mango', label: '🥭', color: '#ffcc5c', angle: 240 },
    { id: 8, type: 'watermelon', label: '🍉', color: '#ffb347', angle: 280 },
    { id: 9, type: 'mango', label: '🥭', color: '#ffcc5c', angle: 320 },
];

let greedyGameState = 'betting';
let timeLeft = 15;
let winningSlice = null;
let roundBets = [];
let recentResults = ['watermelon', '77', 'mango', 'watermelon', 'mango'];

function startGreedyGameLoop(io, db, admin) {
    console.log("⚡ Starting Global Greedy Game Loop");
    setInterval(() => {
        if (greedyGameState === 'betting') {
            timeLeft--;
            io.emit('greedy_game_tick', { timeLeft, gameState: greedyGameState });
            
            if (timeLeft <= 0) {
                greedyGameState = 'spinning';
                
                // --- HOUSE EDGE & PROFIT CONTROL LOGIC ---
                winningSlice = pickWinningSlice(roundBets);
                
                io.emit('greedy_game_spin', { winningSlice, gameState: greedyGameState });
                
                // Spin animation duration is 5s
                setTimeout(() => {
                    greedyGameState = 'result';
                    recentResults = [winningSlice.type, ...recentResults].slice(0, 8);
                    
                    io.emit('greedy_game_result', { winningSlice, recentResults, gameState: greedyGameState });
                    
                    // Process payouts!
                    processPayouts(db, admin, winningSlice.type);
                    
                    // Result shows for 5s
                    setTimeout(() => {
                        greedyGameState = 'betting';
                        timeLeft = 15;
                        roundBets = []; // Reset bets for new round
                        winningSlice = null;
                        
                        io.emit('greedy_game_state', { gameState: greedyGameState, timeLeft, recentResults });
                    }, 5000);
                    
                }, 5000);
            }
        }
    }, 1000);
}

function pickWinningSlice(currentBets) {
    let newPlayerBet = null;
    let totalBetPool = 0;
    const payouts = { 'watermelon': 0, 'mango': 0, '77': 0 };

    for (const bet of currentBets) {
        totalBetPool += bet.amount;
        payouts[bet.type] += (bet.type === '77' ? bet.amount * 8 : bet.amount * 2);
        
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
        let lowestPayoutType = 'watermelon';
        let lowestAmount = Infinity;
        
        for (const type of ['watermelon', 'mango', '77']) {
            if (payouts[type] < lowestAmount) {
                lowestAmount = payouts[type];
                lowestPayoutType = type;
            }
        }
        
        // If they all pay out less than total bet pool, maybe be nice. But default to lowest.
        chosenType = lowestPayoutType;
    } 
    // Rule 3: Weighted Math (Normal Play)
    else {
        const rand = Math.random();
        if (rand < 0.46) chosenType = 'watermelon';
        else if (rand < 0.92) chosenType = 'mango';
        else chosenType = '77';
    }

    // Map chosenType back to a random visual slice of that type
    const possibleSlices = SLICES.filter(s => s.type === chosenType);
    return possibleSlices[Math.floor(Math.random() * possibleSlices.length)];
}

async function processPayouts(db, admin, winningType) {
    if (roundBets.length === 0) return;
    
    // Group winning bets by user
    const userWinnings = {};
    for (const bet of roundBets) {
        if (bet.type === winningType) {
            const multiplier = winningType === '77' ? 8 : 2;
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
            console.log(`[GreedyGame] Paid ${amount} coins to user ${userId}`);
        } catch (e) {
            console.error(`[GreedyGame] Error paying out user ${userId}:`, e);
        }
    }
}

function registerGreedyGameHandlers(socket, db, admin) {
    // Client wants to know current game state when opening sheet
    socket.on('get_greedy_game_state', () => {
        socket.emit('greedy_game_state', {
            gameState: greedyGameState,
            timeLeft: timeLeft,
            recentResults: recentResults,
            winningSlice: winningSlice
        });
    });

    // Client places a bet
    socket.on('greedy_place_bet', async (data) => {
        const { userId, type, amount } = data;
        
        if (greedyGameState !== 'betting') {
            socket.emit('greedy_bet_error', { message: 'Betting is closed for this round!' });
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
                
                // Flag as new player if they haven't won greedy game before
                if (!userData.hasPlayedGreedy) {
                    isNewPlayer = true;
                    transaction.update(userRef, { hasPlayedGreedy: true });
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
            socket.emit('greedy_bet_success', { type, amount }); 
            
        } catch (e) {
            console.error(`[GreedyGame] Error placing bet for user ${userId}:`, e);
            socket.emit('greedy_bet_error', { message: e.message });
        }
    });
}

module.exports = { startGreedyGameLoop, registerGreedyGameHandlers };
