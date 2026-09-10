// =============================================
// SUPER SLOT GAME SERVER — 5 Reels × 3 Rows
// 40 Paylines, WILD, BONUS Free Spins
// =============================================

// --- SYMBOL DEFINITIONS ---
const SYMBOLS = {
    WATERMELON: 'watermelon',
    GREEN_FRUIT: 'green_fruit',
    BANANA: 'banana',
    STRAWBERRY: 'strawberry',
    ONION: 'onion',
    PINEAPPLE: 'pineapple',
    MANGOSTEEN: 'mangosteen',
    PEARL: 'pearl',
    DIAMOND: 'diamond',
    WILD: 'wild',
    BONUS: 'bonus',
};

// --- PAYOUT TABLE (multiplied by bet-per-line) ---
const PAYOUTS = {
    [SYMBOLS.DIAMOND]:    { 5: 400, 4: 120, 3: 40, 2: 10 },
    [SYMBOLS.PEARL]:      { 5: 300, 4: 80,  3: 35, 2: 8 },
    [SYMBOLS.MANGOSTEEN]: { 5: 250, 4: 60,  3: 30, 2: 5 },
    [SYMBOLS.PINEAPPLE]:  { 5: 240, 4: 50,  3: 12, 2: 3 },
    [SYMBOLS.STRAWBERRY]: { 5: 200, 4: 40,  3: 8,  2: 0 },
    [SYMBOLS.ONION]:      { 5: 150, 4: 35,  3: 12, 2: 0 },
    [SYMBOLS.BANANA]:     { 5: 125, 4: 30,  3: 10, 2: 0 },
    [SYMBOLS.GREEN_FRUIT]:{ 5: 100, 4: 25,  3: 7,  2: 0 },
    [SYMBOLS.WATERMELON]: { 5: 75,  4: 20,  3: 5,  2: 0 },
};

// --- REEL STRIPS (weighted for ~93% RTP) ---
// Each reel has different symbol distributions to control house edge
const REEL_STRIPS = [
    // Reel 1
    [SYMBOLS.WATERMELON, SYMBOLS.GREEN_FRUIT, SYMBOLS.BANANA, SYMBOLS.WATERMELON, SYMBOLS.STRAWBERRY,
     SYMBOLS.ONION, SYMBOLS.WATERMELON, SYMBOLS.GREEN_FRUIT, SYMBOLS.BANANA, SYMBOLS.PINEAPPLE,
     SYMBOLS.WATERMELON, SYMBOLS.MANGOSTEEN, SYMBOLS.GREEN_FRUIT, SYMBOLS.BANANA, SYMBOLS.STRAWBERRY,
     SYMBOLS.WATERMELON, SYMBOLS.PEARL, SYMBOLS.GREEN_FRUIT, SYMBOLS.ONION, SYMBOLS.BANANA,
     SYMBOLS.WATERMELON, SYMBOLS.DIAMOND, SYMBOLS.GREEN_FRUIT, SYMBOLS.WILD, SYMBOLS.BANANA,
     SYMBOLS.STRAWBERRY, SYMBOLS.WATERMELON, SYMBOLS.BONUS, SYMBOLS.GREEN_FRUIT, SYMBOLS.PINEAPPLE],
    // Reel 2
    [SYMBOLS.BANANA, SYMBOLS.WATERMELON, SYMBOLS.STRAWBERRY, SYMBOLS.GREEN_FRUIT, SYMBOLS.WATERMELON,
     SYMBOLS.ONION, SYMBOLS.BANANA, SYMBOLS.WATERMELON, SYMBOLS.PINEAPPLE, SYMBOLS.GREEN_FRUIT,
     SYMBOLS.BANANA, SYMBOLS.WATERMELON, SYMBOLS.MANGOSTEEN, SYMBOLS.STRAWBERRY, SYMBOLS.GREEN_FRUIT,
     SYMBOLS.BANANA, SYMBOLS.PEARL, SYMBOLS.WATERMELON, SYMBOLS.GREEN_FRUIT, SYMBOLS.ONION,
     SYMBOLS.BANANA, SYMBOLS.WILD, SYMBOLS.WATERMELON, SYMBOLS.DIAMOND, SYMBOLS.GREEN_FRUIT,
     SYMBOLS.STRAWBERRY, SYMBOLS.BANANA, SYMBOLS.BONUS, SYMBOLS.WATERMELON, SYMBOLS.PINEAPPLE],
    // Reel 3
    [SYMBOLS.GREEN_FRUIT, SYMBOLS.BANANA, SYMBOLS.WATERMELON, SYMBOLS.STRAWBERRY, SYMBOLS.GREEN_FRUIT,
     SYMBOLS.BANANA, SYMBOLS.ONION, SYMBOLS.WATERMELON, SYMBOLS.GREEN_FRUIT, SYMBOLS.PINEAPPLE,
     SYMBOLS.BANANA, SYMBOLS.WATERMELON, SYMBOLS.MANGOSTEEN, SYMBOLS.GREEN_FRUIT, SYMBOLS.STRAWBERRY,
     SYMBOLS.BANANA, SYMBOLS.WATERMELON, SYMBOLS.PEARL, SYMBOLS.GREEN_FRUIT, SYMBOLS.ONION,
     SYMBOLS.BANANA, SYMBOLS.WATERMELON, SYMBOLS.WILD, SYMBOLS.GREEN_FRUIT, SYMBOLS.DIAMOND,
     SYMBOLS.BANANA, SYMBOLS.STRAWBERRY, SYMBOLS.BONUS, SYMBOLS.WATERMELON, SYMBOLS.PINEAPPLE],
    // Reel 4
    [SYMBOLS.WATERMELON, SYMBOLS.BANANA, SYMBOLS.GREEN_FRUIT, SYMBOLS.STRAWBERRY, SYMBOLS.WATERMELON,
     SYMBOLS.BANANA, SYMBOLS.GREEN_FRUIT, SYMBOLS.ONION, SYMBOLS.WATERMELON, SYMBOLS.PINEAPPLE,
     SYMBOLS.BANANA, SYMBOLS.GREEN_FRUIT, SYMBOLS.WATERMELON, SYMBOLS.MANGOSTEEN, SYMBOLS.STRAWBERRY,
     SYMBOLS.BANANA, SYMBOLS.GREEN_FRUIT, SYMBOLS.PEARL, SYMBOLS.WATERMELON, SYMBOLS.ONION,
     SYMBOLS.BANANA, SYMBOLS.GREEN_FRUIT, SYMBOLS.WILD, SYMBOLS.WATERMELON, SYMBOLS.DIAMOND,
     SYMBOLS.BANANA, SYMBOLS.STRAWBERRY, SYMBOLS.BONUS, SYMBOLS.GREEN_FRUIT, SYMBOLS.PINEAPPLE],
    // Reel 5
    [SYMBOLS.BANANA, SYMBOLS.GREEN_FRUIT, SYMBOLS.WATERMELON, SYMBOLS.BANANA, SYMBOLS.STRAWBERRY,
     SYMBOLS.GREEN_FRUIT, SYMBOLS.WATERMELON, SYMBOLS.ONION, SYMBOLS.BANANA, SYMBOLS.PINEAPPLE,
     SYMBOLS.GREEN_FRUIT, SYMBOLS.WATERMELON, SYMBOLS.BANANA, SYMBOLS.MANGOSTEEN, SYMBOLS.STRAWBERRY,
     SYMBOLS.GREEN_FRUIT, SYMBOLS.WATERMELON, SYMBOLS.PEARL, SYMBOLS.BANANA, SYMBOLS.ONION,
     SYMBOLS.GREEN_FRUIT, SYMBOLS.WATERMELON, SYMBOLS.DIAMOND, SYMBOLS.BANANA, SYMBOLS.WILD,
     SYMBOLS.GREEN_FRUIT, SYMBOLS.STRAWBERRY, SYMBOLS.BONUS, SYMBOLS.WATERMELON, SYMBOLS.PINEAPPLE],
];

// --- 40 PAYLINES (row indices: 0=top, 1=middle, 2=bottom) ---
const PAYLINES = [
    [1,1,1,1,1],  // 1: straight middle
    [0,0,0,0,0],  // 2: straight top
    [2,2,2,2,2],  // 3: straight bottom
    [0,1,2,1,0],  // 4: V shape
    [2,1,0,1,2],  // 5: inverted V
    [0,0,1,0,0],  // 6
    [2,2,1,2,2],  // 7
    [1,0,0,0,1],  // 8
    [1,2,2,2,1],  // 9
    [0,1,1,1,0],  // 10
    [2,1,1,1,2],  // 11
    [1,0,1,0,1],  // 12
    [1,2,1,2,1],  // 13
    [0,1,0,1,0],  // 14
    [2,1,2,1,2],  // 15
    [1,1,0,1,1],  // 16
    [1,1,2,1,1],  // 17
    [0,0,1,2,2],  // 18
    [2,2,1,0,0],  // 19
    [0,1,2,2,2],  // 20
    [2,1,0,0,0],  // 21
    [0,0,0,1,2],  // 22
    [2,2,2,1,0],  // 23
    [1,0,1,2,1],  // 24
    [1,2,1,0,1],  // 25
    [0,2,0,2,0],  // 26
    [2,0,2,0,2],  // 27
    [1,0,2,0,1],  // 28
    [1,2,0,2,1],  // 29
    [0,2,2,2,0],  // 30
    [2,0,0,0,2],  // 31
    [0,1,0,0,1],  // 32
    [2,1,2,2,1],  // 33
    [0,0,2,0,0],  // 34
    [2,2,0,2,2],  // 35
    [0,2,1,2,0],  // 36
    [2,0,1,0,2],  // 37
    [1,0,0,1,2],  // 38
    [1,2,2,1,0],  // 39
    [0,1,2,0,1],  // 40
];

// --- FREE SPIN AWARDS ---
const FREE_SPIN_AWARDS = { 3: 3, 4: 6, 5: 10 };

// Track free spins per user in memory
const userFreeSpins = {};

// --- GENERATE REEL RESULT ---
function spinReels() {
    const grid = []; // 5 columns (reels), each with 3 symbols
    for (let reel = 0; reel < 5; reel++) {
        const strip = REEL_STRIPS[reel];
        const stopPos = Math.floor(Math.random() * strip.length);
        const col = [];
        for (let row = 0; row < 3; row++) {
            col.push(strip[(stopPos + row) % strip.length]);
        }
        grid.push(col);
    }
    return grid; // grid[reel][row]
}

// --- COUNT BONUS SYMBOLS ON GRID ---
function countBonusSymbols(grid) {
    let count = 0;
    for (let reel = 0; reel < 5; reel++) {
        for (let row = 0; row < 3; row++) {
            if (grid[reel][row] === SYMBOLS.BONUS) count++;
        }
    }
    return count;
}

// --- EVALUATE SINGLE PAYLINE ---
function evaluatePayline(grid, payline) {
    // Get symbols on this payline
    const lineSymbols = [];
    for (let reel = 0; reel < 5; reel++) {
        lineSymbols.push(grid[reel][payline[reel]]);
    }

    // Find the first non-WILD symbol (left to right)
    let matchSymbol = null;
    for (let i = 0; i < 5; i++) {
        if (lineSymbols[i] !== SYMBOLS.WILD && lineSymbols[i] !== SYMBOLS.BONUS) {
            matchSymbol = lineSymbols[i];
            break;
        }
    }

    // If all are WILD (extremely rare), treat as highest payer
    if (!matchSymbol) {
        // All wilds — check if there are actually wilds
        const allWild = lineSymbols.every(s => s === SYMBOLS.WILD);
        if (allWild) {
            matchSymbol = SYMBOLS.DIAMOND; // Pays as diamond
        } else {
            return null; // Mix of bonus and wild with no regular
        }
    }

    // Count consecutive matches from left (WILD substitutes)
    let matchCount = 0;
    for (let i = 0; i < 5; i++) {
        if (lineSymbols[i] === matchSymbol || lineSymbols[i] === SYMBOLS.WILD) {
            matchCount++;
        } else {
            break;
        }
    }

    // Look up payout
    const payoutTable = PAYOUTS[matchSymbol];
    if (!payoutTable) return null;

    const payout = payoutTable[matchCount] || 0;
    if (payout <= 0) return null;

    return {
        symbol: matchSymbol,
        count: matchCount,
        payout: payout,
        positions: payline.slice(0, matchCount).map((row, reel) => ({ reel, row })),
    };
}

// --- EVALUATE ALL 40 PAYLINES ---
function evaluateAllPaylines(grid, betPerLine) {
    const wins = [];
    let totalWin = 0;

    for (let i = 0; i < PAYLINES.length; i++) {
        const result = evaluatePayline(grid, PAYLINES[i]);
        if (result) {
            const lineWin = result.payout * betPerLine;
            wins.push({
                lineIndex: i,
                linePattern: PAYLINES[i],
                symbol: result.symbol,
                count: result.count,
                payout: lineWin,
                positions: result.positions,
            });
            totalWin += lineWin;
        }
    }

    return { wins, totalWin };
}

// --- MAIN HANDLER REGISTRATION ---
function registerSuperSlotHandlers(socket, db, admin) {
    
    // Player requests a spin
    socket.on('super_slot_spin', async (data) => {
        const { userId, betPerLine } = data;
        
        const allowedBets = [1, 2, 5, 10, 20, 50, 100];
        if (!userId || !betPerLine || !allowedBets.includes(betPerLine)) {
            socket.emit('super_slot_error', { message: 'Invalid bet amount.' });
            return;
        }

        const totalBet = betPerLine * 40; // 40 paylines

        try {
            const userRef = db.collection('userProfiles').doc(userId);
            
            // Check if player has free spins
            const freeSpins = userFreeSpins[userId] || 0;
            const isFreeSpinRound = freeSpins > 0;
            
            if (!isFreeSpinRound) {
                // Deduct bet in a transaction
                await db.runTransaction(async (transaction) => {
                    const userDoc = await transaction.get(userRef);
                    if (!userDoc.exists) throw new Error("User does not exist");
                    
                    const userData = userDoc.data();
                    const currentCoins = userData.coins || 0;
                    
                    if (currentCoins < totalBet) {
                        throw new Error("Insufficient coins");
                    }
                    
                    transaction.update(userRef, {
                        coins: admin.firestore.FieldValue.increment(-totalBet)
                    });
                });
            } else {
                // Using free spin — decrement counter
                userFreeSpins[userId] = freeSpins - 1;
                if (userFreeSpins[userId] <= 0) delete userFreeSpins[userId];
            }

            // Generate reel result
            const grid = spinReels();
            
            // Evaluate wins across all 40 paylines
            const { wins, totalWin } = evaluateAllPaylines(grid, betPerLine);
            
            // Check for bonus (free spin) symbols — scatter anywhere
            const bonusCount = countBonusSymbols(grid);
            let freeSpinsAwarded = 0;
            if (bonusCount >= 3) {
                freeSpinsAwarded = FREE_SPIN_AWARDS[Math.min(bonusCount, 5)] || 0;
                userFreeSpins[userId] = (userFreeSpins[userId] || 0) + freeSpinsAwarded;
            }

            // Pay out winnings
            if (totalWin > 0) {
                await userRef.update({
                    coins: admin.firestore.FieldValue.increment(totalWin)
                });
                console.log(`[SuperSlot] User ${userId} won ${totalWin} coins (bet: ${totalBet})`);
            }

            // Get remaining free spins
            const remainingFreeSpins = userFreeSpins[userId] || 0;

            // Send result to client
            socket.emit('super_slot_result', {
                grid: grid, // 5 arrays of 3 symbols each
                wins: wins,
                totalWin: totalWin,
                totalBet: isFreeSpinRound ? 0 : totalBet,
                isFreeSpinRound: isFreeSpinRound,
                freeSpinsAwarded: freeSpinsAwarded,
                remainingFreeSpins: remainingFreeSpins,
                bonusCount: bonusCount,
            });

        } catch (e) {
            console.error(`[SuperSlot] Error for user ${userId}:`, e);
            socket.emit('super_slot_error', { message: e.message });
        }
    });

    // Get current free spin count
    socket.on('get_super_slot_state', (data) => {
        const { userId } = data || {};
        socket.emit('super_slot_state', {
            remainingFreeSpins: userFreeSpins[userId] || 0,
        });
    });
}

module.exports = { registerSuperSlotHandlers };
