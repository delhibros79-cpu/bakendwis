const botProfiles = new Map();     
const availableBots = new Set();   
const activeBots = new Map();      
const roomIntervals = new Map();   
const roomTimeouts = new Map();    
const evacuatingRooms = new Set(); // Tracks rooms where bots are currently leaving

const chatMessages = [
    "mai abhi bol nahi sakti mom hai pass me",
    "jaldi start karo",
    "koi mic on karo",
    "start karo na yar",
    "hello",
    "koi hai?"
];

const emotes = [
    "/heart.gif", "/laugh.gif", "/wave.gif", "/party.gif", "/kiss.gif", "/smile.gif"
];

function monitorPendingRoomsForBots(io, db, admin, processToggleReady) {
    if (!io || !admin || !processToggleReady) return;
    db.collection('gameSessions').where('status', '==', 'pending').onSnapshot((snapshot) => {
        snapshot.forEach((doc) => {
            const d = doc.data();
            const roomId = doc.id;
            
            const currentPlayersMap = d.players || {};
            const readyPlayers = d.readyPlayers || [];
            const seatedIds = d.seatedPlayerUserIds || [];

            // 1. If room is LOCKED with a password, stop joins and evacuate existing seated bots one by one!
            if (d.password) {
                stopRoomTimers(roomId);
                if (!evacuatingRooms.has(roomId)) {
                    const botsInLockedRoom = [];
                    Object.keys(currentPlayersMap).forEach(seatKey => {
                        const p = currentPlayersMap[seatKey];
                        if (p && p.id && botProfiles.has(p.id)) {
                            botsInLockedRoom.push({ id: p.id, seatIndex: parseInt(seatKey) });
                        }
                    });

                    if (botsInLockedRoom.length > 0) {
                        evacuatingRooms.add(roomId);
                        (async () => {
                            for (const bot of botsInLockedRoom) {
                                try {
                                    const sessionRef = db.collection('gameSessions').doc(roomId);
                                    await db.runTransaction(async (t) => {
                                        const freshDoc = await t.get(sessionRef);
                                        if (!freshDoc.exists) return;
                                        const freshData = freshDoc.data();
                                        const playersMap = freshData.players || {};
                                        const currentSeatKey = Object.keys(playersMap).find(k => playersMap[k]?.id === bot.id);
                                        
                                        if (currentSeatKey !== undefined) {
                                            t.update(sessionRef, {
                                                [`players.${currentSeatKey}`]: admin.firestore.FieldValue.delete(),
                                                playerUserIds: admin.firestore.FieldValue.arrayRemove(bot.id),
                                                seatedPlayerUserIds: admin.firestore.FieldValue.arrayRemove(bot.id),
                                                readyPlayers: admin.firestore.FieldValue.arrayRemove(bot.id),
                                                emptySeats: admin.firestore.FieldValue.increment(1)
                                            });
                                            io.to(roomId).emit("room_update_received", { type: 'EXIT', seatIndex: parseInt(currentSeatKey), userId: bot.id });
                                        }
                                    });
                                    activeBots.delete(bot.id);
                                    availableBots.add(bot.id);
                                } catch (e) {
                                    console.error("Error exiting locked room bot:", e);
                                }
                                await new Promise(r => setTimeout(r, 1500));
                            }
                            evacuatingRooms.delete(roomId);
                        })();
                    }
                }
                return; // Do not process auto-ready or joins for locked rooms
            }

            // 2. Check if there is any real player in the room before acting
            const hasRealPlayers = seatedIds.some(id => !botProfiles.has(id));
            if (!hasRealPlayers) return;

            // 3. Check if any seated bot is currently UNREADY
            Object.values(currentPlayersMap).forEach(player => {
                if (player && player.id && botProfiles.has(player.id)) {
                    if (!readyPlayers.includes(player.id) || !player.ready) {
                        setTimeout(async () => {
                            if (processToggleReady && !evacuatingRooms.has(roomId)) {
                                await processToggleReady(roomId, player.id, true, io, db, admin);
                            }
                        }, Math.floor(Math.random() * 1500) + 1500);
                    }
                }
            });

            // 4. If layout increased and there are empty seats + real players, restart join loop
            if (d.emptySeats > 0 && !roomIntervals.has(roomId)) {
                scheduleBotJoin(roomId, io, db, admin, processToggleReady);
            }
        });
    });
}

async function initBots(db, io, admin, processToggleReady) {
    try {
        const snapshot = await db.collection('userProfiles').where('isBot', '==', true).limit(10).get();
        snapshot.forEach(doc => {
            botProfiles.set(doc.id, { id: doc.id, ...doc.data() });
            availableBots.add(doc.id);
        });
        console.log(`🤖 Successfully loaded ${availableBots.size} bots into memory.`);
        
        if (io && admin && processToggleReady) {
            monitorPendingRoomsForBots(io, db, admin, processToggleReady);
        }
    } catch (e) {
        console.error("❌ Error loading bots:", e);
    }
}

function scheduleBotJoin(roomId, io, db, admin, processToggleReady) {
    if (evacuatingRooms.has(roomId)) return; // Do not schedule joins if bots are currently evacuating
    if (roomTimeouts.has(roomId)) clearTimeout(roomTimeouts.get(roomId));
    if (roomIntervals.has(roomId)) clearInterval(roomIntervals.get(roomId));

    const delayMs = Math.floor(Math.random() * 5000) + 35000;

    const timeoutId = setTimeout(() => {
        const intervalId = setInterval(() => processBotJoin(roomId, io, db, admin, processToggleReady), 1500);
        roomIntervals.set(roomId, intervalId);
    }, delayMs);

    roomTimeouts.set(roomId, timeoutId);
}

async function processBotJoin(roomId, io, db, admin, processToggleReady) {
    if (availableBots.size === 0 || evacuatingRooms.has(roomId)) return;

    try {
        const sessionRef = db.collection('gameSessions').doc(roomId);
        const doc = await sessionRef.get();
        
        if (!doc.exists) return stopRoomTimers(roomId);
        const d = doc.data();
        
        if (d.status !== 'pending' || d.emptySeats <= 0 || d.password) {
            return stopRoomTimers(roomId);
        }

        const hasRealPlayers = (d.seatedPlayerUserIds || []).some(id => !botProfiles.has(id));
        if (!hasRealPlayers) {
            return stopRoomTimers(roomId);
        }

        const botId = Array.from(availableBots)[Math.floor(Math.random() * availableBots.size)];
        const botData = botProfiles.get(botId);

        let targetSeat = null;
        const currentPlayers = d.players || {};
        for (let i = 0; i < d.maxPlayers; i++) {
            if (!currentPlayers[i]) { targetSeat = i; break; }
        }

        if (targetSeat === null) return stopRoomTimers(roomId);

        const playerInfo = {
            id: botId,
            username: botData.username || `Player_${Math.floor(Math.random() * 9999)}`,
            photoURL: botData.photoURL || `https://i.pravatar.cc/150?u=${botId}`,
            ready: false
        };

        availableBots.delete(botId);
        activeBots.set(botId, roomId);

        await sessionRef.update({
            [`players.${targetSeat}`]: playerInfo,
            seatedPlayerUserIds: admin.firestore.FieldValue.arrayUnion(botId),
            playerUserIds: admin.firestore.FieldValue.arrayUnion(botId),
            emptySeats: admin.firestore.FieldValue.increment(-1)
        });

        io.to(roomId).emit("room_update_received", { type: 'TAKE_SEAT', seatIndex: targetSeat, player: playerInfo, userId: botId });

        simulateBotActions(roomId, botId, targetSeat, io, db, admin, processToggleReady);

    } catch (e) {
        console.error("Bot Join Error:", e);
    }
}

function simulateBotActions(roomId, botId, seatIndex, io, db, admin, processToggleReady) {
    setTimeout(async () => {
        if (processToggleReady && !evacuatingRooms.has(roomId)) {
            await processToggleReady(roomId, botId, true, io, db, admin);
        }
    }, Math.floor(Math.random() * 1000) + 1000);

    setTimeout(async () => {
        if (activeBots.get(botId) !== roomId || evacuatingRooms.has(roomId)) return; 

        const doChat = Math.random() > 0.3; 

        if (doChat) {
            const text = chatMessages[Math.floor(Math.random() * chatMessages.length)];
            const msgData = {
                id: Date.now().toString() + botId,
                roomId,
                senderUserId: botId,
                messageText: text,
                sentAt: Date.now()
            };
            
            io.to(roomId).emit("receive_message", msgData);
            
            await db.collection("gameSessions").doc(roomId).collection("chatMessages").add({
                gameSessionId: roomId,
                senderUserId: botId,
                messageText: text,
                sentAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } else {
            const emote = emotes[Math.floor(Math.random() * emotes.length)];
            io.to(roomId).emit("receive_emoji", { roomId, playerId: botId, emoji: emote });
        }
    }, Math.floor(Math.random() * 4000) + 4000);
}

function handleBotKickOrExit(botId, roomId, io, db, admin, processToggleReady) {
    if (activeBots.has(botId)) {
        activeBots.delete(botId);
        availableBots.add(botId);
        scheduleBotJoin(roomId, io, db, admin, processToggleReady);
    }
}

async function releaseBotsFromRoom(roomId, io, db, admin) {
    if (evacuatingRooms.has(roomId)) return;

    try {
        const sessionRef = db.collection('gameSessions').doc(roomId);
        const doc = await sessionRef.get();
        if (!doc.exists) return;
        
        const d = doc.data();
        const currentPlayers = d.players || {};
        let botsToRelease = [];
        let botIds = []; 

        Object.keys(currentPlayers).forEach(seat => {
            const pid = currentPlayers[seat]?.id;
            if (pid && botProfiles.has(pid)) {
                botsToRelease.push({ id: pid, seat: parseInt(seat) });
                botIds.push(pid);
            }
        });

        if (botsToRelease.length === 0) return;

        const updates = { 
            emptySeats: admin.firestore.FieldValue.increment(botsToRelease.length),
            playerUserIds: admin.firestore.FieldValue.arrayRemove(...botIds),
            seatedPlayerUserIds: admin.firestore.FieldValue.arrayRemove(...botIds),
            readyPlayers: admin.firestore.FieldValue.arrayRemove(...botIds)
        };

        const isPlayingOrCooling = d.status === 'playing' || d.status === 'cooling_down';

        botsToRelease.forEach(bot => {
            // 🔥 Fix: Mark as quit if playing/cooling so the avatar stays on the screen
            if (isPlayingOrCooling) {
                updates[`players.${bot.seat}.quit`] = true;
            } else {
                updates[`players.${bot.seat}`] = admin.firestore.FieldValue.delete();
            }
            
            activeBots.delete(bot.id);
            availableBots.add(bot.id);
            
            io.to(roomId).emit("room_update_received", { type: 'EXIT', seatIndex: bot.seat, userId: bot.id });
        });

        await sessionRef.update(updates);
    } catch (e) {
        console.error("Error releasing bots:", e);
    }
}

async function checkAndEvacuateBots(roomId, io, db, admin) {
    if (evacuatingRooms.has(roomId)) return;

    try {
        const sessionRef = db.collection('gameSessions').doc(roomId);
        const doc = await sessionRef.get();
        if (!doc.exists) return;

        const d = doc.data();
        const seatedIds = d.seatedPlayerUserIds || [];
        
        const hasRealPlayers = seatedIds.some(id => !botProfiles.has(id));
        if (hasRealPlayers) return; 

        const botIdsInRoom = seatedIds.filter(id => botProfiles.has(id));
        if (botIdsInRoom.length === 0) return; 

        evacuatingRooms.add(roomId);
        stopRoomTimers(roomId);

        if (d.status === 'playing') {
            const gameRef = sessionRef.collection('games').doc(String(d.currentGameNumber));
            try {
                await gameRef.update({ status: 'cooling_down' });
                await sessionRef.collection('chatMessages').add({
                    gameSessionId: roomId,
                    senderUserId: 'system',
                    messageText: '🔔 All real players left. Game ended with no result.',
                    sentAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch(e) {}
        }

        for (const botId of botIdsInRoom) {
            const checkDoc = await sessionRef.get();
            if (checkDoc.exists && checkDoc.data().seatedPlayerUserIds.some(id => !botProfiles.has(id))) {
                break; 
            }

            await db.runTransaction(async (t) => {
                const freshDoc = await t.get(sessionRef);
                if (!freshDoc.exists) return;
                const freshData = freshDoc.data();
                
                const playersMap = freshData.players || {};
                const seatIndex = Object.keys(playersMap).find(k => playersMap[k]?.id === botId);
                
                if (seatIndex !== undefined) {
                    t.update(sessionRef, {
                        [`players.${seatIndex}`]: admin.firestore.FieldValue.delete(),
                        playerUserIds: admin.firestore.FieldValue.arrayRemove(botId),
                        seatedPlayerUserIds: admin.firestore.FieldValue.arrayRemove(botId),
                        readyPlayers: admin.firestore.FieldValue.arrayRemove(botId),
                        emptySeats: admin.firestore.FieldValue.increment(1)
                    });
                    io.to(roomId).emit("room_update_received", { type: 'EXIT', seatIndex: parseInt(seatIndex), userId: botId });
                }
            });

            activeBots.delete(botId);
            availableBots.add(botId);

            await new Promise(r => setTimeout(r, 1500));
        }

        evacuatingRooms.delete(roomId);

    } catch (e) {
        console.error("Evacuation Error:", e);
        evacuatingRooms.delete(roomId);
    }
}

function stopRoomTimers(roomId) {
    if (roomTimeouts.has(roomId)) clearTimeout(roomTimeouts.get(roomId));
    if (roomIntervals.has(roomId)) clearInterval(roomIntervals.get(roomId));
    roomTimeouts.delete(roomId);
    roomIntervals.delete(roomId);
}

async function handleBotLiftUp(botId, roomId, io, db, admin, processToggleReady) {
    if (botProfiles.has(botId) || activeBots.has(botId)) {
        activeBots.delete(botId);
        availableBots.add(botId);
        try {
            await db.collection("gameSessions").doc(roomId).update({
                playerUserIds: admin.firestore.FieldValue.arrayRemove(botId)
            });
        } catch(e) {}
        scheduleBotJoin(roomId, io, db, admin, processToggleReady);
        return true;
    }
    return false;
}

module.exports = { initBots, scheduleBotJoin, handleBotKickOrExit, releaseBotsFromRoom, checkAndEvacuateBots, handleBotLiftUp };