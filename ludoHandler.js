const admin = require("firebase-admin");

// --- HELPER: GET NEXT TURN COLOR ---
const getNextTurnColor = (currentTurn, playersMap, tokensMap) => {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const currentTurnIndex = colors.indexOf(currentTurn);
    let nextPlayerIndex = (currentTurnIndex + 1) % 4;
    let loopCount = 0;
    
    while (loopCount < 4) {
        const nextColor = colors[nextPlayerIndex];
        const nextPlayer = playersMap[nextPlayerIndex];
        
        if (nextPlayer && nextPlayer.id && !nextPlayer.isBot) {
            const hasWon = (tokensMap[nextColor] || []).every(t => t.position === 'finished' || t.position === 'abandoned');
            if (!hasWon) {
                return nextColor;
            }
        } else if (nextPlayer && nextPlayer.isBot) {
            const hasWon = (tokensMap[nextColor] || []).every(t => t.position === 'finished' || t.position === 'abandoned');
            if (!hasWon) {
                return nextColor;
            }
        }
        nextPlayerIndex = (nextPlayerIndex + 1) % 4;
        loopCount++;
    }
    return currentTurn;
};

// --- SETUP LUDO ROUTES ---
function setupLudoRoutes(app, db) {
    /**
     * @route POST /api/ludo/roll-dice
     * @description Server-side dice rolling and turn validation. Prevents client-side Math.random manipulation and 100% win-rate cheats.
     */
    app.post('/api/ludo/roll-dice', async (req, res) => {
        const { roomId } = req.body;
        if (!roomId) {
            return res.status(400).json({ error: 'Missing roomId parameter' });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: Missing token' });
        }

        let uid;
        try {
            const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
            uid = decoded.uid;
        } catch (e) {
            console.warn('[Ludo API] Invalid auth token:', e.message);
            return res.status(401).json({ error: 'Unauthorized: Invalid token' });
        }

        try {
            const ludoRef = db.collection('ludoSessions').doc(String(roomId));
            const docSnap = await ludoRef.get();
            if (!docSnap.exists) {
                return res.status(404).json({ error: 'Ludo session not found' });
            }

            const session = docSnap.data();
            if (session.status === 'completed' || session.status === 'abandoned') {
                return res.status(400).json({ error: 'Game session is already finished' });
            }

            if (session.waitingForTokenSelection === true || session.diceValue !== null) {
                return res.status(400).json({ error: 'Dice already rolled for this turn' });
            }

            const currentTurnColor = session.turn || 'red';
            const colors = ['red', 'blue', 'green', 'yellow'];
            const turnIndex = colors.indexOf(currentTurnColor);
            const turnPlayer = (session.players || {})[turnIndex];

            // 🛑 STRICT SECURITY: Verify that requesting user is actually the player whose turn it is right now!
            if (!turnPlayer || turnPlayer.id !== uid) {
                console.error(`[Ludo API] Player ${uid} attempted to roll during ${currentTurnColor}'s turn (${turnPlayer?.id || 'none'})`);
                return res.status(403).json({ error: 'It is not your turn to roll the dice' });
            }

            // 🛑 STRICT SECURITY: Generate dice roll 100% on the backend server!
            const newDiceValue = Math.floor(Math.random() * 6) + 1;
            const playerTokens = (session.tokens || {})[currentTurnColor] || [];
            let movable = [];

            if (newDiceValue === 6) {
                movable = playerTokens.filter(t => {
                    if (t.position === 'finished') return false;
                    if (t.position === 'home') return true;
                    const currentIndex = t.position === 'start' ? 0 : (t.pathIndex || 0);
                    return currentIndex + newDiceValue <= 56;
                }).map(t => t.id);
            } else {
                movable = playerTokens.filter(t => {
                    const currentIndex = t.position === 'start' ? 0 : (t.pathIndex || 0);
                    return (t.position === 'start' || t.position === 'in-play') && currentIndex + newDiceValue <= 56;
                }).map(t => t.id);
            }

            if (movable.length === 0) {
                // No valid moves with this dice roll -> update diceValue briefly for animation, then advance turn
                const nextTurnColor = getNextTurnColor(currentTurnColor, session.players || {}, session.tokens || {});
                await ludoRef.update({
                    diceValue: newDiceValue,
                    lastDiceRolledBy: uid,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                setTimeout(async () => {
                    try {
                        await ludoRef.update({
                            turn: nextTurnColor,
                            diceValue: null,
                            waitingForTokenSelection: false,
                            movableTokenIds: []
                        });
                    } catch (err) {
                        console.error('[Ludo API] Turn advance error:', err);
                    }
                }, 1000);
            } else if (movable.length === 1) {
                // Exactly 1 movable token -> set diceValue so frontend can auto-move or select
                await ludoRef.update({
                    diceValue: newDiceValue,
                    waitingForTokenSelection: true,
                    movableTokenIds: movable,
                    lastDiceRolledBy: uid,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Multiple movable tokens -> wait for token selection
                await ludoRef.update({
                    diceValue: newDiceValue,
                    waitingForTokenSelection: true,
                    movableTokenIds: movable,
                    lastDiceRolledBy: uid,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            res.json({ success: true, diceValue: newDiceValue, movableTokenIds: movable });
        } catch (error) {
            console.error('[Ludo API] Roll dice error:', error);
            res.status(500).json({ error: 'Server error rolling dice' });
        }
    });

    const SAFE_ZONES = [0, 8, 13, 21, 26, 34, 39, 47];

    /**
     * @route POST /api/ludo/move-token
     * @description Server-side token movement validation and collision detection.
     */
    app.post('/api/ludo/move-token', async (req, res) => {
        const { roomId, tokenId } = req.body;
        if (!roomId || tokenId === undefined) return res.status(400).json({ error: 'Missing parameters' });

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

        let uid;
        try {
            const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
            uid = decoded.uid;
        } catch (e) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const ludoRef = db.collection('ludoSessions').doc(String(roomId));
            
            await db.runTransaction(async (t) => {
                const docSnap = await t.get(ludoRef);
                if (!docSnap.exists) throw new Error("Room not found");
                const session = docSnap.data();

                if (session.status !== 'playing') throw new Error("Game is not active");
                if (!session.waitingForTokenSelection || session.diceValue === null) throw new Error("Cannot move token now");
                
                const currentTurnColor = session.turn || 'red';
                const colors = ['red', 'blue', 'green', 'yellow'];
                const turnIndex = colors.indexOf(currentTurnColor);
                const turnPlayer = (session.players || {})[turnIndex];

                if (!turnPlayer || turnPlayer.id !== uid) throw new Error("Not your turn");
                
                if (!session.movableTokenIds || !session.movableTokenIds.includes(tokenId)) {
                    throw new Error("Invalid token selection");
                }

                const steps = session.diceValue;
                const newTokens = JSON.parse(JSON.stringify(session.tokens || {}));
                const playerTokens = newTokens[currentTurnColor] || [];
                const tokenIndex = playerTokens.findIndex(tk => tk.id === tokenId);
                if (tokenIndex === -1) throw new Error("Token not found");

                const token = playerTokens[tokenIndex];
                let tokenCut = false;

                if (token.position === 'home') {
                    if (steps !== 6) throw new Error("Need 6 to leave home");
                    playerTokens[tokenIndex] = { ...token, position: 'start', pathIndex: 0 };
                } else {
                    const newPathIndex = (token.pathIndex || 0) + steps;
                    if (newPathIndex > 56) throw new Error("Cannot move past finish");
                    
                    if (newPathIndex === 56) {
                        playerTokens[tokenIndex] = { ...token, position: 'finished', pathIndex: 56 };
                    } else {
                        playerTokens[tokenIndex] = { ...token, position: 'in-play', pathIndex: newPathIndex };
                        
                        // Check for collisions
                        const colorOffsets = { red: 0, blue: 13, green: 26, yellow: 39 };
                        const myAbsoluteIndex = (colorOffsets[currentTurnColor] + newPathIndex) % 52;

                        if (newPathIndex < 51 && !SAFE_ZONES.includes(myAbsoluteIndex)) {
                            for (const oppColor of colors) {
                                if (oppColor === currentTurnColor) continue;
                                const oppTokens = newTokens[oppColor] || [];
                                const oppOffset = colorOffsets[oppColor];

                                const victimIndex = oppTokens.findIndex(tk => {
                                    if (tk.position !== 'in-play' || tk.pathIndex >= 51) return false;
                                    const oppAbsoluteIndex = (oppOffset + tk.pathIndex) % 52;
                                    return oppAbsoluteIndex === myAbsoluteIndex;
                                });

                                if (victimIndex !== -1) {
                                    oppTokens[victimIndex] = { ...oppTokens[victimIndex], position: 'home', pathIndex: -1 };
                                    newTokens[oppColor] = oppTokens;
                                    tokenCut = true;
                                    break;
                                }
                            }
                        }
                    }
                }

                newTokens[currentTurnColor] = playerTokens;
                
                const hasWonNow = playerTokens.every(tk => tk.position === 'finished');
                let newWinners = session.winners || [];
                let gameCompleted = false;

                if (hasWonNow && !newWinners.find(w => w.color === currentTurnColor)) {
                    newWinners.push({ name: turnPlayer.username, color: currentTurnColor });
                    
                    const activePlayersCount = colors.filter(c => (session.players || {})[colors.indexOf(c)]).length;
                    if (newWinners.length >= activePlayersCount - 1) {
                        gameCompleted = true;
                    }
                }

                const updatePayload = {
                    tokens: newTokens,
                    waitingForTokenSelection: false,
                    movableTokenIds: [],
                    winners: newWinners,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                };

                if (gameCompleted) {
                    updatePayload.status = 'completed';
                    updatePayload.diceValue = null;
                    const lastColor = colors.find(c => {
                        const p = (session.players || {})[colors.indexOf(c)];
                        return p && !newWinners.find(w => w.color === c);
                    });
                    if (lastColor) {
                        const lastP = (session.players || {})[colors.indexOf(lastColor)];
                        newWinners.push({ name: lastP.username, color: lastColor });
                    }
                    updatePayload.winners = newWinners;
                } else if ((steps === 6 || tokenCut) && !hasWonNow) {
                    updatePayload.diceValue = null;
                } else {
                    updatePayload.turn = getNextTurnColor(currentTurnColor, session.players || {}, newTokens);
                    updatePayload.diceValue = null;
                }

                t.update(ludoRef, updatePayload);
            });

            res.json({ success: true });
        } catch (error) {
            console.error('[Ludo API] Move error:', error);
            res.status(error.message === "Room not found" ? 404 : 400).json({ error: error.message || 'Server error' });
        }
    });

    /**
     * @route POST /api/ludo/leave
     * @description Gracefully exit a room and pass turn if necessary.
     */
    app.post('/api/ludo/leave', async (req, res) => {
        const { roomId, spectate } = req.body;
        if (!roomId) return res.status(400).json({ error: 'Missing roomId parameter' });

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

        let uid;
        try {
            const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
            uid = decoded.uid;
        } catch (e) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const ludoRef = db.collection('ludoSessions').doc(String(roomId));
            await db.runTransaction(async (t) => {
                const docSnap = await t.get(ludoRef);
                if (!docSnap.exists) return;
                const session = docSnap.data();

                const updates = {};
                if (!spectate) {
                    updates.playerUserIds = admin.firestore.FieldValue.arrayRemove(uid);
                }

                const players = session.players || {};
                const seatIndex = Object.keys(players).find(k => players[k]?.id === uid);
                
                if (seatIndex) {
                    updates[`players.${seatIndex}`] = admin.firestore.FieldValue.delete();
                    updates.seatedPlayerUserIds = admin.firestore.FieldValue.arrayRemove(uid);
                    
                    const colors = ['red', 'blue', 'green', 'yellow'];
                    const color = colors[parseInt(seatIndex)];
                    
                    if (session.status === 'playing') {
                        const newTokens = JSON.parse(JSON.stringify(session.tokens || {}));
                        if (newTokens[color]) {
                            newTokens[color] = newTokens[color].map(tk => ({ ...tk, position: 'abandoned', pathIndex: -1 }));
                            updates.tokens = newTokens;
                        }

                        if (session.turn === color) {
                            updates.turn = getNextTurnColor(color, { ...players, [seatIndex]: null }, newTokens);
                            updates.diceValue = null;
                            updates.waitingForTokenSelection = false;
                            updates.movableTokenIds = [];
                        }
                    }
                }

                t.update(ludoRef, updates);
            });

            res.json({ success: true });
        } catch (error) {
            console.error('[Ludo API] Leave error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    /**
     * @route POST /api/ludo/join
     * @description Join room and verify password securely.
     */
    app.post('/api/ludo/join', async (req, res) => {
        const { roomId, password } = req.body;
        if (!roomId) return res.status(400).json({ error: 'Missing roomId' });

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

        let uid;
        try {
            const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
            uid = decoded.uid;
        } catch (e) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const roomRef = db.collection('ludoSessions').doc(String(roomId));
            const docSnap = await roomRef.get();
            if (!docSnap.exists) return res.status(404).json({ error: 'Room not found' });
            const data = docSnap.data();

            if (data.gameType !== 'Ludo') return res.status(400).json({ error: 'Not a Ludo room' });
            if (data.status === 'deleted') return res.status(400).json({ error: 'Room deleted' });

            if (data.password && data.password !== password) {
                return res.status(403).json({ error: 'Incorrect password' });
            }

            const currentPlayers = data.playerUserIds || [];
            if (!currentPlayers.includes(uid)) {
                await roomRef.update({ playerUserIds: admin.firestore.FieldValue.arrayUnion(uid) });
            }

            res.json({ success: true, roomId });
        } catch (error) {
            console.error('[Ludo API] Join error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });
}

module.exports = { setupLudoRoutes };
