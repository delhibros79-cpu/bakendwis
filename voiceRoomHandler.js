// A completely in-memory map to hold our 5-minute countdowns (Zero Firebase Reads!)
const voiceDisconnectTimers = new Map();

// --- HEARTBEAT SYSTEM: Detects ghost players when app is killed or network drops ---
// Key: userId, Value: { roomId, lastBeat: timestamp }
const voiceHeartbeats = new Map();

// --- RED PACKET MEMORY ENGINE ---
const activeRedPackets = new Map();

// --- HYBRID RAM ARCHITECTURE: In-Memory Room State ---
const activeRoomRAM = new Map();
module.exports.activeRoomRAM = activeRoomRAM;

async function getRoomState(roomId, db) {
    if (activeRoomRAM.has(roomId)) {
        return activeRoomRAM.get(roomId);
    }
    const doc = await db.collection("voiceSessions").doc(roomId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    data.needsSync = false;
    activeRoomRAM.set(roomId, data);
    return data;
}

// --- GHOST PURGER — Validates a room's player list against live connections ---
// A user is ONLY considered alive if they have BOTH:
//   1. An active socket connection in voicePresence, AND
//   2. A recent heartbeat (within the last 2 minutes)
// Having just a socket is NOT enough — zombie sockets (app killed, network drop)
// stay in voicePresence until Socket.IO's pingTimeout detects the dead connection,
// which can take 45+ seconds on mobile. Heartbeats prove the CLIENT is actually alive.
function purgeGhostsFromRAM(roomId, voicePresence) {
    const room = activeRoomRAM.get(roomId);
    if (!room || !room.playerUserIds || room.playerUserIds.length === 0) return 0;

    const HEARTBEAT_DEAD_MS = 2 * 60 * 1000; // 2 minutes — must have heartbeat within this window
    const now = Date.now();
    let purgedCount = 0;

    // Build set of users who have a LIVE socket connection to this room
    const liveSocketUserIds = new Set();
    if (voicePresence) {
        for (const [, p] of voicePresence.entries()) {
            if (p.roomId === roomId && p.userId) {
                liveSocketUserIds.add(p.userId);
            }
        }
    }

    // Check each player in the room
    const ghostUserIds = [];
    for (const userId of room.playerUserIds) {
        const hasSocket = liveSocketUserIds.has(userId);
        const hb = voiceHeartbeats.get(userId);
        const hasRecentHeartbeat = hb && hb.roomId === roomId && (now - hb.lastBeat) < HEARTBEAT_DEAD_MS;

        // A user with a disconnect timer is in the grace period — don't purge yet
        if (voiceDisconnectTimers.has(userId)) continue;

        // SAFETY: If user has a live socket but NO heartbeat entry at all,
        // they are a brand-new joiner (heartbeat hasn't been set yet). Skip them.
        if (hasSocket && !hb) continue;

        // Has a recent heartbeat? They're alive.
        if (hasRecentHeartbeat) continue;

        // Has a live socket with a recent heartbeat? Alive.
        if (hasSocket && hb && (now - hb.lastBeat) < HEARTBEAT_DEAD_MS) continue;

        // No recent heartbeat AND (no socket OR zombie socket) — this is a ghost
        ghostUserIds.push(userId);
    }

    // Purge all ghosts from RAM
    for (const ghostId of ghostUserIds) {
        room.playerUserIds = room.playerUserIds.filter(id => id !== ghostId);
        if (room.playerCount > 0) room.playerCount -= 1;
        if (room.selfMutedUserIds) {
            room.selfMutedUserIds = room.selfMutedUserIds.filter(id => id !== ghostId);
        }
        if (room.players) {
            const seatKey = Object.keys(room.players).find(k => room.players[k]?.id === ghostId);
            if (seatKey !== undefined) delete room.players[seatKey];
        }
        // Clean up heartbeat entry if it exists
        voiceHeartbeats.delete(ghostId);
        purgedCount++;
    }

    if (purgedCount > 0) {
        room.needsSync = true;
        console.log(`🧹 [Ghost Purge] Removed ${purgedCount} ghost(s) from room ${roomId}: [${ghostUserIds.join(', ')}]`);
    }

    return purgedCount;
}

// --- SHARED CLEANUP: Properly removes a ghost user from BOTH RAM and Firestore ---
// This is the SINGLE source of truth for cleanup logic, used by both the
// disconnect timer and the heartbeat sweep. Previously, cleanup only wrote to
// Firestore, but the RAM Syncer (every 15s) would overwrite it with stale RAM
// data — permanently resurrecting ghost players.
async function cleanupUserFromRoom(userId, roomId, io, db, admin, voicePresence, roomService) {
    // Pre-flight: Is the user actually back online? (reconnected before cleanup fired)
    // Check BOTH voicePresence (socket connection) AND voiceHeartbeats (client proof-of-life)
    let isActuallyOnline = false;
    if (voicePresence) {
        for (const [, p] of voicePresence.entries()) {
            if (p.userId === userId && p.roomId === roomId) {
                isActuallyOnline = true;
                break;
            }
        }
    }
    // Also check heartbeats — user may have reconnected and sent a heartbeat
    // but voicePresence might not match yet (race condition during reconnection)
    if (!isActuallyOnline) {
        const hb = voiceHeartbeats.get(userId);
        if (hb && hb.roomId === roomId && (Date.now() - hb.lastBeat) < 60000) {
            isActuallyOnline = true;
        }
    }
    if (isActuallyOnline) {
        console.log(`🧹 [Cleanup] Skipping ${userId} — reconnected to room ${roomId}`);
        return;
    }

    let seatToClear = null;

    // --- STEP 1: Clean the in-memory RAM state FIRST ---
    // This MUST happen before the RAM Syncer's next tick (every 15s), otherwise
    // the syncer will overwrite our Firestore cleanup with stale RAM data.
    const ramRoom = activeRoomRAM.get(roomId);
    if (ramRoom) {
        if (ramRoom.playerUserIds) {
            const wasInRoom = ramRoom.playerUserIds.includes(userId);
            ramRoom.playerUserIds = ramRoom.playerUserIds.filter(id => id !== userId);
            if (wasInRoom && ramRoom.playerCount > 0) {
                ramRoom.playerCount -= 1;
            }
        }
        if (ramRoom.selfMutedUserIds) {
            ramRoom.selfMutedUserIds = ramRoom.selfMutedUserIds.filter(id => id !== userId);
        }
        if (ramRoom.players) {
            const seatIndex = Object.keys(ramRoom.players).find(key => ramRoom.players[key]?.id === userId);
            if (seatIndex !== undefined) {
                seatToClear = parseInt(seatIndex);
                delete ramRoom.players[seatIndex];
            }
        }
        ramRoom.needsSync = true; // Syncer will now write the CLEAN state
    }

    // --- STEP 2: Also clean Firestore directly for immediate persistence ---
    try {
        const sessionRef = db.collection("voiceSessions").doc(roomId);
        await db.runTransaction(async (t) => {
            const doc = await t.get(sessionRef);
            if (!doc.exists) return;

            const docData = doc.data();
            const dbPlayerUserIds = docData.playerUserIds || [];
            const currentPlayers = docData.players || {};

            // Skip if user is not even in Firestore
            if (!dbPlayerUserIds.includes(userId)) return;

            const updates = {
                playerUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                selfMutedUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                playerCount: admin.firestore.FieldValue.increment(-1)
            };

            const firestoreSeat = Object.keys(currentPlayers).find(key => currentPlayers[key]?.id === userId);
            if (firestoreSeat !== undefined) {
                updates[`players.${firestoreSeat}`] = admin.firestore.FieldValue.delete();
                if (seatToClear === null) seatToClear = parseInt(firestoreSeat);
            }

            t.update(sessionRef, updates);
        });
    } catch (err) {
        console.error(`🧹 [Cleanup] Firestore cleanup failed for ${userId} in ${roomId}:`, err);
    }

    // --- STEP 3: Notify all remaining room members ---
    io.to(roomId).emit("voice_room_update", { type: 'EXIT', userId, seatIndex: seatToClear });

    // --- STEP 4: Remove from LiveKit voice connection ---
    if (roomService) {
        try {
            await roomService.removeParticipant(roomId, userId);
        } catch (e) { console.warn("🧹 [Cleanup] LiveKit removeParticipant:", e); }
    }

    console.log(`🧹 [Cleanup] Removed ghost user ${userId} from room ${roomId} (seat: ${seatToClear})`);
}


async function calculateRedPacketResults(packetId, io, db, admin, roomService) {
    const packet = activeRedPackets.get(packetId);
    if (!packet) return;
    packet.isCalculated = true;

    const { amount, taps, roomId, senderName } = packet;

    // --- FIXED: 25% (1/4th) DISTRIBUTION POOL ---
    // Only 1/4th of the Red Packet's total value is given to the players. The rest burns.
    const distributablePool = Math.floor(amount / 4);

    let totalTaps = 0;
    let highestTapper = null;
    let maxTaps = -1;

    // 1. Tally up all taps
    for (const [uid, count] of Object.entries(taps)) {
        totalTaps += count;
        if (count > maxTaps) {
            maxTaps = count;
            highestTapper = uid;
        }
    }

    const rewards = {};

    // 2. The Strict Rule: If 0 taps, burn the coins.
    if (totalTaps === 0) {
        console.log(`🔥 Red Packet ${packetId} burned. 0 taps!`);
        const chatRef = db.collection('voiceSessions').doc(roomId).collection('chatMessages').doc();
        await chatRef.set({
            gameSessionId: roomId,
            senderUserId: 'system',
            messageText: `🧧 ${senderName}'s Red Packet of ${amount} Gold vanished because nobody tapped!`,
            sentAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } else {
        // 3. Pro-Rata Distribution from the 25% Pool
        let distributed = 0;
        for (const [uid, count] of Object.entries(taps)) {
            if (count === 0) continue;
            const reward = Math.floor((count / totalTaps) * distributablePool);
            if (reward > 0) {
                rewards[uid] = reward;
                distributed += reward;
            }
        }

        // 4. Give the mathematical remainder of the 25% pool to the fastest tapper
        const remainder = distributablePool - distributed;
        if (remainder > 0 && highestTapper) {
            rewards[highestTapper] = (rewards[highestTapper] || 0) + remainder;
        }

        console.log(`💰 Packet ${packetId} Distribution (Pool: ${distributablePool}/${amount}):`, rewards);

        // 5. Execute Batched Firebase Writes to safely give the coins
        const batch = db.batch();
        for (const [uid, reward] of Object.entries(rewards)) {
            const userRef = db.collection('userProfiles').doc(uid);
            batch.update(userRef, { coins: admin.firestore.FieldValue.increment(reward) });

            const ledgerRef = userRef.collection('coinLedger').doc();
            batch.set(ledgerRef, {
                amount: reward,
                type: 'looted_red_packet',
                packetId: packetId,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        await batch.commit();

        // 6. Send System Chat Success Message
        const chatRef = db.collection('voiceSessions').doc(roomId).collection('chatMessages').doc();
        await chatRef.set({
            gameSessionId: roomId,
            senderUserId: 'system',
            messageText: `🧧 ${senderName}'s Red Packet of ${amount} Gold was successfully looted!`,
            sentAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    // --- CALCULATE TOP 3 LOOTERS AND FETCH USERNAMES ---
    const topLooters = [];
    try {
        const sortedLooters = Object.entries(rewards)
            .map(([uid, reward]) => ({ uid, amount: reward }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 3);

        for (const looter of sortedLooters) {
            const userDoc = await db.collection('userProfiles').doc(looter.uid).get();
            if (userDoc.exists) {
                topLooters.push({ ...looter, username: userDoc.data().username || "Unknown" });
            } else {
                topLooters.push({ ...looter, username: "Unknown" });
            }
        }
    } catch (e) {
        console.error("Error fetching top looters for Red Packet:", e);
    }

    const payloadObj = { packetId, rewards, topLooters };
    io.to(roomId).emit('red_packet_results', payloadObj);

    if (roomService) {
        try {
            const payload = new TextEncoder().encode(JSON.stringify({ type: 'RED_PACKET_RESULTS', payload: payloadObj }));
            await roomService.sendData(roomId, payload, 1, []);
        } catch (e) { console.error("LiveKit Red Packet Results Error:", e); }
    }

    activeRedPackets.delete(packetId);
}

function registerVoiceRoomHandlers(io, socket, db, admin, voicePresence, processTimeExp, socketUserMap, roomService) {

    function verifyVoiceSocketIdentity(targetUserId) {
        if (!targetUserId) return false;
        if (socket.user && socket.user.uid) {
            return socket.user.uid === targetUserId;
        }
        if (socket.userId && socket.userId === targetUserId) {
            return true;
        }
        const sessionUser = socketUserMap.get(socket.id);
        if (sessionUser && sessionUser.userId) {
            return sessionUser.userId === targetUserId;
        }
        return false;
    }

    // ==========================================
    // HYBRID RAM ARCHITECTURE: Background Syncer
    // ==========================================
    setInterval(async () => {
        const batch = db.batch();
        let count = 0;
        const now = admin.firestore.FieldValue.serverTimestamp();
        for (const [roomId, room] of activeRoomRAM.entries()) {
            // --- FIX 2: Reconcile ghosts BEFORE syncing to Firestore ---
            // This prevents the RAM Syncer from resurrecting ghost players
            // that were cleaned from Firestore (manually or by other processes).
            purgeGhostsFromRAM(roomId, voicePresence);

            if (room.needsSync) {
                const sessionRef = db.collection("voiceSessions").doc(roomId);

                // 🔥 CRITICAL FIX: Only update specific fields to prevent overwriting client-side Firestore changes
                const updates = {};
                if (room.players !== undefined) updates.players = room.players;
                if (room.playerCount !== undefined) updates.playerCount = room.playerCount;
                if (room.playerUserIds !== undefined) updates.playerUserIds = room.playerUserIds;
                if (room.selfMutedUserIds !== undefined) updates.selfMutedUserIds = room.selfMutedUserIds;
                if (room.kickedUsers !== undefined) updates.kickedUsers = room.kickedUsers;
                updates.lastActiveTimestamp = now;

                batch.update(sessionRef, updates);
                room.needsSync = false;
                count++;
                if (count >= 400) break; // Keep under Firestore 500 batch limit
            }
        }
        if (count > 0) {
            try { await batch.commit(); console.log(`[RAM Syncer] Synced ${count} rooms to Firestore.`); }
            catch (e) { console.error("RAM Sync failed:", e); }
        }
    }, 15000); // 15 seconds for snappy persistence

    // ==========================================
    // RED PACKET SOCKET LISTENERS
    // ==========================================

    socket.on('request_red_packet_sync', (data) => {
        const roomId = data?.roomId;
        if (!roomId) return;
        for (const [packetId, packet] of activeRedPackets.entries()) {
            if (packet.roomId === roomId && !packet.isCalculated) {
                socket.emit('sync_active_red_packet', {
                    packetId,
                    amount: packet.amount,
                    waitingTime: packet.waitingTime,
                    duration: packet.duration,
                    startTime: packet.startTime,
                    senderName: packet.senderName
                });
            }
        }
    });

    socket.on('trigger_red_packet', async (data) => {
        const { roomId, amount, waitingTime, duration, isAppWide, userId: payloadUserId } = data;

        // 🛑 STRICT SECURITY: Enforce authenticated socket identity for Red Packet coin deductions
        if (socket.user && socket.user.uid && payloadUserId && payloadUserId !== socket.user.uid) {
            console.error(`Blocked spoofed Red Packet trigger! Socket ${socket.user.uid} tried to trigger for ${payloadUserId}`);
            return;
        } else if (!socket.user && socketUserMap.get(socket.id)?.userId && payloadUserId && socketUserMap.get(socket.id)?.userId !== payloadUserId) {
            console.error(`Blocked spoofed Red Packet trigger from unauthenticated socket ${socket.id}`);
            return;
        }

        const userInfo = socketUserMap.get(socket.id);
        const userId = (socket.user && socket.user.uid) || (userInfo ? userInfo.userId : payloadUserId);

        if (!userId) {
            console.log("❌ Red Packet Blocked: Could not identify user.");
            return;
        }

        console.log(`🚀 Red Packet Request Received: ${amount} Gold from User: ${userId}`);

        try {
            let senderName = "Someone";

            await db.runTransaction(async (t) => {
                const userRef = db.collection('userProfiles').doc(userId);
                const doc = await t.get(userRef);

                if (!doc.exists) throw new Error("User not found");
                const currentCoins = doc.data().coins || 0;
                senderName = doc.data().username || "Someone";

                if (currentCoins < amount) throw new Error("Insufficient coins in DB");

                t.update(userRef, { coins: currentCoins - amount });

                const ledgerRef = userRef.collection("coinLedger").doc();
                t.set(ledgerRef, {
                    amount: -amount,
                    type: 'sent_red_packet',
                    roomId: roomId,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
            });

            console.log(`✅ Coins deducted. Starting Red Packet for ${senderName}`);

            const packetId = `RP_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            activeRedPackets.set(packetId, {
                roomId,
                amount,
                waitingTime,
                duration,
                startTime: Date.now(),
                senderName,
                taps: {},
                isCalculated: false
            });

            // Local room emit
            const payloadObj = { packetId, amount, waitingTime, duration, senderId: userId };
            io.to(roomId).emit('start_red_packet', payloadObj);

            if (roomService) {
                try {
                    const payload = new TextEncoder().encode(JSON.stringify({ type: 'RED_PACKET_START', payload: payloadObj }));
                    await roomService.sendData(roomId, payload, 1, []);
                } catch (e) { console.error("LiveKit Red Packet Start Error:", e); }
            }

            // NEW: Global Emit for App-Wide red packets
            if (isAppWide && amount >= 10000) {
                io.emit('global_red_packet_alert', {
                    packetId,
                    amount,
                    senderName,
                    roomId
                });
            }

            const totalDelayMs = (waitingTime + 5 + duration + 2.5) * 1000;
            setTimeout(() => {
                console.log(`⏱️ Timer ended for Packet ${packetId}. Calculating results...`);
                calculateRedPacketResults(packetId, io, db, admin, roomService);
            }, totalDelayMs);

        } catch (error) {
            console.error("❌ Red Packet Trigger Failed:", error.message);
        }
    });

    socket.on('submit_red_packet_taps', (data) => {
        const { packetId, taps, userId: payloadUserId } = data;

        // 🛑 STRICT SECURITY: Enforce authenticated socket identity for tap submissions
        if (socket.user && socket.user.uid && payloadUserId && payloadUserId !== socket.user.uid) {
            console.error(`Blocked spoofed Red Packet tap submission! Socket ${socket.user.uid} tried to submit for ${payloadUserId}`);
            return;
        } else if (!socket.user && socketUserMap.get(socket.id)?.userId && payloadUserId && socketUserMap.get(socket.id)?.userId !== payloadUserId) {
            console.error(`Blocked spoofed Red Packet tap submission from unauthenticated socket ${socket.id}`);
            return;
        }

        const userInfo = socketUserMap.get(socket.id);
        const userId = (socket.user && socket.user.uid) || (userInfo ? userInfo.userId : payloadUserId);

        if (!userId) return;

        // 🛑 STRICT SECURITY: Cap maximum humanly possible taps (max 180 taps across a 15s duration)
        const cleanTaps = Math.min(Math.max(0, parseInt(taps) || 0), 180);

        const packet = activeRedPackets.get(packetId);
        if (packet && !packet.isCalculated) {
            packet.taps[userId] = cleanTaps;
            console.log(`👆 User ${userId} submitted ${cleanTaps} taps.`);
        }
    });

    // ==========================================
    // EXISTING VOICE ROOM LISTENERS
    // ==========================================

    socket.on("voice_action_take_seat", async (data) => {
        let { roomId, seatIndex, player, userId } = data;
        // 🛑 STRICT SECURITY: Ensure user only takes seat for themselves
        if (!verifyVoiceSocketIdentity(userId)) {
            console.error(`Blocked unauthorized voice_action_take_seat attempt by ${socket.user?.uid || 'unauth'} as ${userId}`);
            return;
        }
        try {
            const room = await getRoomState(roomId, db);
            if (!room) return;

            let actionTaken = null; let oldSeat = null;
            const currentPlayers = room.players || {};
            const dbPlayerUserIds = room.playerUserIds || [];

            const existingSeat = Object.keys(currentPlayers).find(key => currentPlayers[key]?.id === userId);

            if (existingSeat !== undefined) {
                if (seatIndex !== null && existingSeat !== String(seatIndex) && !currentPlayers[seatIndex]) {
                    delete room.players[existingSeat];
                    room.players[seatIndex] = player;
                    actionTaken = 'SWITCH_SEAT'; oldSeat = existingSeat;
                    room.needsSync = true;
                }
            } else {
                if (seatIndex !== null && !currentPlayers[seatIndex]) {
                    if (!room.players) room.players = {};
                    room.players[seatIndex] = player;
                    if (!dbPlayerUserIds.includes(userId)) {
                        room.playerUserIds.push(userId);
                        room.playerCount = (room.playerCount || 0) + 1;
                    }
                    actionTaken = 'TAKE_SEAT';
                    room.needsSync = true;
                }
            }

            if (actionTaken) {
                if (actionTaken === 'SWITCH_SEAT') {
                    io.to(roomId).emit("voice_room_update", { type: 'SWITCH_SEAT', oldSeat, newSeat: seatIndex, player, userId });
                } else {
                    io.to(roomId).emit("voice_room_update", { type: 'TAKE_SEAT', seatIndex, player, userId });
                }
            }
        } catch (err) { console.error("Voice Take Seat failed:", err); }
    });

    socket.on("voice_action_leave_seat", async (data) => {
        const { roomId, seatIndex, userId } = data;
        try {
            const room = await getRoomState(roomId, db);
            if (!room) return;

            const isSelf = verifyVoiceSocketIdentity(userId);
            const isHost = verifyVoiceSocketIdentity(room.hostUserId);

            let requesterId = (socket.user && socket.user.uid) || socket.userId;
            if (!requesterId) {
                const sessionUser = socketUserMap.get(socket.id);
                if (sessionUser) requesterId = sessionUser.userId;
            }

            const isAdmin = room.adminUserIds && room.adminUserIds.includes(requesterId);
            const targetIsHost = userId === room.hostUserId;
            const targetIsAdmin = room.adminUserIds && room.adminUserIds.includes(userId);

            let canLift = false;
            if (isSelf || isHost) canLift = true;
            else if (isAdmin && !targetIsHost && !targetIsAdmin) canLift = true;

            if (!canLift) {
                console.error(`Blocked unauthorized voice_action_leave_seat attempt by ${requesterId || 'unauth'} against ${userId}`);
                return;
            }

            if (seatIndex !== null && seatIndex !== undefined && room.players && room.players[seatIndex]) {
                delete room.players[seatIndex];
                if (room.selfMutedUserIds) {
                    room.selfMutedUserIds = room.selfMutedUserIds.filter(id => id !== userId);
                }
                room.needsSync = true;

                io.to(roomId).emit("voice_room_update", { type: 'LEAVE_SEAT', seatIndex, userId });
            }
        } catch (err) { console.error("Voice Leave Seat failed:", err); }
    });

    socket.on("voice_action_exit_room", async (data) => {
        const { roomId, seatIndex, userId } = data;

        socket.leave(roomId);

        if (voicePresence && voicePresence.has(socket.id)) {
            const presence = voicePresence.get(socket.id);
            const minutes = Math.floor((Date.now() - presence.joinTime) / 60000);
            if (minutes > 0) await processTimeExp(presence.roomId, minutes, db, admin);
            voicePresence.delete(socket.id);
        }

        // Clean exit: remove heartbeat so sweep doesn't double-clean
        voiceHeartbeats.delete(userId);

        try {
            const room = await getRoomState(roomId, db);
            if (!room) return;

            if (room.playerUserIds) {
                const wasInRoom = room.playerUserIds.includes(userId);
                room.playerUserIds = room.playerUserIds.filter(id => id !== userId);
                if (wasInRoom && room.playerCount > 0) room.playerCount -= 1;
            }
            if (room.selfMutedUserIds) {
                room.selfMutedUserIds = room.selfMutedUserIds.filter(id => id !== userId);
            }

            if (room.players) {
                const foundSeat = Object.keys(room.players).find(key => room.players[key]?.id === userId);
                if (foundSeat !== undefined) {
                    delete room.players[foundSeat];
                } else if (seatIndex !== null && seatIndex !== undefined) {
                    delete room.players[seatIndex];
                }
            }

            room.needsSync = true;
            io.to(roomId).emit("voice_room_update", { type: 'EXIT', seatIndex, userId });

            if (roomService) {
                try { await roomService.removeParticipant(roomId, userId); } catch (e) { }
            }
        } catch (err) { console.error("Voice Exit Room failed:", err); }
    });

    socket.on("voice_action_kick_user", async (data) => {
        const { roomId, userId: targetUserId } = data;
        try {
            const room = await getRoomState(roomId, db);
            if (!room) return;

            const isHost = verifyVoiceSocketIdentity(room.hostUserId);

            let requesterId = (socket.user && socket.user.uid) || socket.userId;
            if (!requesterId) {
                const sessionUser = socketUserMap.get(socket.id);
                if (sessionUser) requesterId = sessionUser.userId;
            }

            const isAdmin = room.adminUserIds && room.adminUserIds.includes(requesterId);
            const targetIsHost = targetUserId === room.hostUserId;
            const targetIsAdmin = room.adminUserIds && room.adminUserIds.includes(targetUserId);

            let canKick = false;
            if (isHost) canKick = true;
            else if (isAdmin && !targetIsHost && !targetIsAdmin) canKick = true;

            if (!canKick) {
                console.error(`Blocked unauthorized kick attempt by ${requesterId || 'unauth'} against ${targetUserId}`);
                return;
            }

            let targetSeat = null;
            if (room.playerUserIds) {
                const wasInRoom = room.playerUserIds.includes(targetUserId);
                room.playerUserIds = room.playerUserIds.filter(id => id !== targetUserId);
                if (wasInRoom && room.playerCount > 0) room.playerCount -= 1;
            }
            if (room.selfMutedUserIds) {
                room.selfMutedUserIds = room.selfMutedUserIds.filter(id => id !== targetUserId);
            }

            if (!room.kickedUsers) room.kickedUsers = {};
            room.kickedUsers[targetUserId] = Date.now();

            if (room.players) {
                const seatStr = Object.keys(room.players).find(k => room.players[k]?.id === targetUserId);
                if (seatStr !== undefined) {
                    targetSeat = parseInt(seatStr);
                    delete room.players[seatStr];
                }
            }

            room.needsSync = true;
            io.to(roomId).emit("voice_room_update", { type: 'KICK', seatIndex: targetSeat, userId: targetUserId });

            if (roomService) {
                try { await roomService.removeParticipant(roomId, targetUserId); }
                catch (e) { console.error("Failed to remove LiveKit participant during kick", e); }
            }
        } catch (err) { console.error("Voice Kick User failed:", err); }
    });

    socket.on("voice_action_join_room", async (data) => {
        const { roomId, userId, password, isInvite, isReconnect } = data;

        try {
            const room = await getRoomState(roomId, db);
            if (!room) return;

            if (room.kickedUsers && room.kickedUsers[userId]) {
                const kickedTime = room.kickedUsers[userId];
                const fiveMinutesInMs = 5 * 60 * 1000;
                if (Date.now() - kickedTime < fiveMinutesInMs) {
                    const remainingMinutes = Math.ceil((fiveMinutesInMs - (Date.now() - kickedTime)) / 60000);
                    socket.emit('voice_room_update', { type: 'ERROR', message: `You were kicked. Try again in ${remainingMinutes} minute(s).` });
                    return;
                }
            }

            if (room.isLocked) {
                const isHost = room.hostUserId === userId;
                const isAdmin = (room.adminUserIds || []).includes(userId);
                const isAlreadyInRoom = (room.playerUserIds || []).includes(userId);
                if (!isHost && !isAdmin && !isAlreadyInRoom && !isInvite && room.password !== password) {
                    socket.emit('voice_room_update', { type: 'ERROR', message: 'Invalid password' });
                    return; // Reject connection
                }
            }

            // --- FIX 1: Purge ghost players from RAM BEFORE sending FULL_SYNC ---
            // This ensures new joiners never see stale ghost players.
            purgeGhostsFromRAM(roomId, voicePresence);

            // 🔥 INSTANT UI UNBLOCK: Emit FULL_SYNC immediately!
            socket.emit("voice_room_update", {
                type: 'FULL_SYNC',
                roomId: roomId,
                room: { id: roomId, ...room }
            });

        } catch (e) {
            console.error("Error checking room lock:", e);
            return;
        }

        socket.join(roomId);
        if (userId) {
            socket.userId = userId;
            socketUserMap.set(socket.id, { userId, roomId });
            db.collection("userProfiles").doc(userId).update({
                isOnline: true,
                lastActive: admin.firestore.FieldValue.serverTimestamp()
            }).catch(() => { });
        }

        if (voicePresence) {
            voicePresence.set(socket.id, { roomId, userId, joinTime: Date.now() });
        }

        // Register heartbeat on join so sweep knows this user is alive
        voiceHeartbeats.set(userId, { roomId, lastBeat: Date.now() });

        if (voiceDisconnectTimers.has(userId)) {
            clearTimeout(voiceDisconnectTimers.get(userId));
            voiceDisconnectTimers.delete(userId);
        }

        try {
            // ⚡ PERF FIX: Fetch room state and user profile in PARALLEL (saves ~300-500ms).
            // Previously these were two separate sequential reads of the SAME userProfile doc.
            const [room, userDoc] = await Promise.all([
                getRoomState(roomId, db),
                db.collection("userProfiles").doc(userId).get()
            ]);
            if (!room) return;
            const uData = userDoc.exists ? userDoc.data() : {};

            if (!room.playerUserIds) room.playerUserIds = [];
            const wasInRoom = room.playerUserIds.includes(userId);

            if (!wasInRoom) {
                room.playerUserIds.push(userId);
                room.playerCount = (room.playerCount || 0) + 1;
            }
            if (room.selfMutedUserIds) {
                room.selfMutedUserIds = room.selfMutedUserIds.filter(id => id !== userId);
            }
            room.needsSync = true;

            // ⚡ PERF FIX: Broadcast JOIN_ROOM IMMEDIATELY with single read's data.
            // Previously a second userProfile read happened here, adding ~200-500ms.
            io.to(roomId).emit("voice_room_update", {
                type: 'JOIN_ROOM',
                userId,
                isVip: uData.isVip || false,
                vipLevel: uData.vipLevel || 0,
                username: uData.username || "User"
            });

            // ⚡ PERF FIX: VIP entrance chat message — fire and forget, don't block join flow
            if (userDoc.exists && !isReconnect && uData.isVip && uData.vipLevel >= 1) {
                const sessionRef = db.collection("voiceSessions").doc(roomId);
                const chatRef = sessionRef.collection("chatMessages").doc();
                chatRef.set({
                    gameSessionId: roomId,
                    senderUserId: 'system',
                    messageText: `[VIP ${uData.vipLevel}] ${uData.username} made a grand entrance!`,
                    sentAt: admin.firestore.FieldValue.serverTimestamp(),
                    vipLevel: uData.vipLevel,
                    isVipEntry: true,
                    isSystem: true
                }).catch(() => { });
            }

            // --- RED PACKET SYNC FOR LATE JOINERS ---
            for (const [packetId, packet] of activeRedPackets.entries()) {
                if (packet.roomId === roomId && !packet.isCalculated) {
                    socket.emit('sync_active_red_packet', {
                        packetId,
                        amount: packet.amount,
                        waitingTime: packet.waitingTime,
                        duration: packet.duration,
                        startTime: packet.startTime,
                        senderName: packet.senderName
                    });
                }
            }
        } catch (err) { console.error("Voice Join Room failed:", err); }
    });

    async function verifyVoiceHost(roomId) {
        const doc = await db.collection("voiceSessions").doc(roomId).get();
        if (!doc.exists) return false;
        const data = doc.data();
        const isHost = verifyVoiceSocketIdentity(data.hostUserId);
        const isAdmin = data.adminUserIds && data.adminUserIds.includes(socket.user?.uid);
        return isHost || isAdmin;
    }

    socket.on("voice_action_initiate_pk", async (data) => {
        const { roomId, settings } = data;
        try {
            if (!await verifyVoiceHost(roomId)) {
                console.error(`Blocked unauthorized voice_action_initiate_pk attempt by ${socket.user?.uid || 'unauth'}`);
                return;
            }
            const sessionRef = db.collection("voiceSessions").doc(roomId);
            const pkState = {
                isActive: true, status: 'waiting', mode: settings.mode, rule: settings.rule,
                durationMins: settings.duration, redScore: 0, blueScore: 0, voters: []
            };
            await sessionRef.update({ pkState });
            io.to(roomId).emit("voice_room_update", { type: 'PK_INITIATE', pkState });
        } catch (err) { console.error("PK Initiate failed:", err); }
    });

    socket.on("voice_action_join_pk", async (data) => {
        const { roomId, team, userId, player } = data;
        if (!verifyVoiceSocketIdentity(userId)) {
            console.error(`Blocked unauthorized voice_action_join_pk attempt by ${socket.user?.uid || 'unauth'}`);
            return;
        }
        try {
            const sessionRef = db.collection("voiceSessions").doc(roomId);
            await db.runTransaction(async (t) => {
                const doc = await t.get(sessionRef);
                if (!doc.exists) return;
                const pkState = doc.data().pkState || {};
                const voters = pkState.voters || [];

                const filtered = voters.filter(v => v.userId !== userId);
                filtered.push({ userId, team, player });

                const redCount = filtered.filter(v => v.team === 'red').length;
                const blueCount = filtered.filter(v => v.team === 'blue').length;

                t.update(sessionRef, {
                    'pkState.voters': filtered,
                    'pkState.redScore': redCount,
                    'pkState.blueScore': blueCount
                });
            });

            // Get the updated redCount/blueCount to send to clients
            const dbData = await db.collection("voiceSessions").doc(roomId).get();
            const updatedRedScore = dbData.data()?.pkState?.redScore || 0;
            const updatedBlueScore = dbData.data()?.pkState?.blueScore || 0;

            io.to(roomId).emit("voice_room_update", { type: 'PK_VOTER_JOIN', team, userId, player, redScore: updatedRedScore, blueScore: updatedBlueScore });
        } catch (err) { console.error("PK Join failed:", err); }
    });

    socket.on("voice_action_start_pk", async (data) => {
        const { roomId, durationMins } = data;
        try {
            if (!await verifyVoiceHost(roomId)) {
                console.error(`Blocked unauthorized voice_action_start_pk attempt by ${socket.user?.uid || 'unauth'}`);
                return;
            }
            const sessionRef = db.collection("voiceSessions").doc(roomId);
            const endTimeMillis = Date.now() + (durationMins * 60000);
            await sessionRef.update({
                'pkState.status': 'playing', 'pkState.endTime': endTimeMillis,
                'pkState.redScore': 0, 'pkState.blueScore': 0, 'pkState.voters': []
            });
            io.to(roomId).emit("voice_room_update", { type: 'PK_START', endTime: endTimeMillis, redScore: 0, blueScore: 0, voters: [] });

            // Auto-end PK when time runs out
            setTimeout(async () => {
                try {
                    const doc = await sessionRef.get();
                    if (!doc.exists) return;
                    const dbData = doc.data();
                    if (dbData.pkState && dbData.pkState.status === 'playing' && dbData.pkState.endTime === endTimeMillis) {
                        await sessionRef.update({ 'pkState.status': 'ended' });
                        io.to(roomId).emit("voice_room_update", { type: 'PK_END' });
                    }
                } catch (err) { console.error("Auto PK End failed:", err); }
            }, durationMins * 60000);

        } catch (err) { console.error("PK Start failed:", err); }
    });

    socket.on("voice_action_end_pk", async (data) => {
        const { roomId } = data;
        try {
            if (!await verifyVoiceHost(roomId)) {
                console.error(`Blocked unauthorized voice_action_end_pk attempt by ${socket.user?.uid || 'unauth'}`);
                return;
            }
            const sessionRef = db.collection("voiceSessions").doc(roomId);
            await sessionRef.update({ 'pkState.status': 'ended' });
            io.to(roomId).emit("voice_room_update", { type: 'PK_END' });
        } catch (err) { console.error("PK End failed:", err); }
    });

    socket.on("voice_action_close_pk", async (data) => {
        const { roomId } = data;
        try {
            if (!await verifyVoiceHost(roomId)) {
                console.error(`Blocked unauthorized voice_action_close_pk attempt by ${socket.user?.uid || 'unauth'}`);
                return;
            }
            const sessionRef = db.collection("voiceSessions").doc(roomId);
            await sessionRef.update({ 'pkState.isActive': false });
            io.to(roomId).emit("voice_room_update", { type: 'PK_CLOSE' });
        } catch (err) { console.error("PK Close failed:", err); }
    });

    socket.on("voice_action_reset_pk", async (data) => {
        const { roomId } = data;
        try {
            if (!await verifyVoiceHost(roomId)) {
                console.error(`Blocked unauthorized voice_action_reset_pk attempt by ${socket.user?.uid || 'unauth'}`);
                return;
            }
            const sessionRef = db.collection("voiceSessions").doc(roomId);
            await sessionRef.update({
                'pkState.status': 'waiting',
                'pkState.redScore': 0,
                'pkState.blueScore': 0,
                'pkState.voters': []
            });
            io.to(roomId).emit("voice_room_update", { type: 'PK_RESET' });
        } catch (err) { console.error("PK Reset failed:", err); }
    });

    // REMOVED: Unvalidated voice_room_update passthrough relay.
    // All voice room updates now go through proper server-validated handlers
    // (take_seat, leave_seat, exit_room, kick_user, etc.)
    // Music sync pings use the existing room_update -> room_update_received channel.

    // --- HEARTBEAT LISTENER: Client sends this every 30s to prove it's alive ---
    socket.on('voice_heartbeat', (data) => {
        const { roomId, userId } = data || {};
        if (!roomId || !userId) return;
        // Only accept heartbeat from the authenticated socket owner
        if (socket.user && socket.user.uid && socket.user.uid !== userId) return;
        voiceHeartbeats.set(userId, { roomId, lastBeat: Date.now() });
    });

    socket.on("disconnect", async () => {
        if (voicePresence && voicePresence.has(socket.id)) {
            const presence = voicePresence.get(socket.id);
            const { roomId, userId, joinTime } = presence;

            const minutes = Math.floor((Date.now() - joinTime) / 60000);
            if (minutes > 0 && processTimeExp) {
                processTimeExp(roomId, minutes, db, admin).catch(e => console.error("Disconnect EXP failed", e));
            }

            voicePresence.delete(socket.id);

            // Remove heartbeat entry — the disconnect timer will handle cleanup
            voiceHeartbeats.delete(userId);

            if (voiceDisconnectTimers.has(userId)) {
                clearTimeout(voiceDisconnectTimers.get(userId));
            }

            const timerId = setTimeout(async () => {
                voiceDisconnectTimers.delete(userId);
                console.log(`⏱️ [Disconnect Timer] 1-minute timer fired for user ${userId} in room ${roomId}`);
                await cleanupUserFromRoom(userId, roomId, io, db, admin, voicePresence, roomService);
            }, 1 * 60 * 1000); // 1 minute grace period

            voiceDisconnectTimers.set(userId, timerId);
        }
    });
}

// --- HEARTBEAT SWEEP: Runs every 1 minute to find and remove ghost players ---
// Called ONCE from index.js at server startup. Shares the same cleanup logic as
// the disconnect handler but catches cases where disconnect never fires
// (app killed, network drop, server restart).
//
// CRITICAL BUG FIX: Previously, if a user had a zombie socket (app killed but
// Socket.IO hadn't detected the disconnect yet), the sweep would REFRESH their
// heartbeat — keeping the ghost alive forever. Now it force-disconnects zombie
// sockets, which triggers the normal disconnect→cleanup flow.
let sweepStarted = false;
function startHeartbeatSweep(io, db, admin, voicePresence, roomService) {
    if (sweepStarted) return; // Prevent duplicate intervals
    sweepStarted = true;

    const SWEEP_INTERVAL_MS = 1 * 60 * 1000;  // Run every 1 minute
    const DEAD_THRESHOLD_MS = 1 * 60 * 1000;  // User is dead if no heartbeat for 1 minute

    // --- SERVER STARTUP CLEANUP ---
    // On server restart, voicePresence and voiceHeartbeats are empty but Firestore
    // still has stale playerUserIds from the previous session. Nobody can possibly
    // be connected right after a restart, so clean ALL active rooms.
    (async () => {
        try {
            console.log('🧹 [Startup] Cleaning stale voice sessions from previous server run...');
            const snapshot = await db.collection('voiceSessions')
                .where('playerCount', '>', 0)
                .get();
            
            if (snapshot.empty) {
                console.log('🧹 [Startup] No stale sessions found.');
                return;
            }

            const batch = db.batch();
            let cleanedCount = 0;
            snapshot.forEach(doc => {
                batch.update(doc.ref, {
                    playerUserIds: [],
                    players: {},
                    playerCount: 0,
                    selfMutedUserIds: []
                });
                cleanedCount++;
            });

            if (cleanedCount > 0) {
                await batch.commit();
                console.log(`🧹 [Startup] Cleaned ${cleanedCount} stale voice session(s) from Firestore.`);
            }
        } catch (e) {
            console.error('🧹 [Startup] Failed to clean stale sessions:', e);
        }
    })();

    setInterval(async () => {
        const now = Date.now();
        const deadUsers = [];
        const zombieSockets = []; // Sockets that are "connected" but client is dead

        // --- PHASE 1: Check voiceHeartbeats for dead/zombie users ---
        for (const [userId, data] of voiceHeartbeats.entries()) {
            if (now - data.lastBeat > DEAD_THRESHOLD_MS) {
                // Find if this user has any socket in voicePresence
                let zombieSocketId = null;
                if (voicePresence) {
                    for (const [socketId, p] of voicePresence.entries()) {
                        if (p.userId === userId && p.roomId === data.roomId) {
                            zombieSocketId = socketId;
                            break;
                        }
                    }
                }

                if (!zombieSocketId) {
                    // No socket at all — definitely dead
                    deadUsers.push({ userId, roomId: data.roomId });
                } else {
                    // HAS a socket but NO heartbeat for 1+ minute = ZOMBIE SOCKET
                    // OLD BUG: We used to refresh their heartbeat here, keeping ghosts alive forever!
                    // FIX: Force-disconnect the zombie socket. This triggers the normal
                    // disconnect handler → 1-minute grace period → cleanupUserFromRoom.
                    zombieSockets.push({ socketId: zombieSocketId, userId, roomId: data.roomId });
                }
            }
        }

        // --- PHASE 2: Force-disconnect zombie sockets ---
        for (const { socketId, userId, roomId } of zombieSockets) {
            console.log(`💀 [Zombie] Force-disconnecting zombie socket ${socketId} for user ${userId} in room ${roomId}`);
            try {
                const zombieSocket = io.sockets.sockets.get(socketId);
                if (zombieSocket) {
                    zombieSocket.disconnect(true); // This triggers the 'disconnect' event → cleanup timer
                }
            } catch (e) {
                console.error(`💀 [Zombie] Failed to disconnect socket ${socketId}:`, e);
            }
        }

        // --- PHASE 3: Clean users with no socket at all ---
        for (const { userId, roomId } of deadUsers) {
            voiceHeartbeats.delete(userId);

            // Skip if the disconnect timer is already handling this user
            if (voiceDisconnectTimers.has(userId)) continue;

            console.log(`💓 Heartbeat sweep: Cleaning up ghost user ${userId} from room ${roomId}`);
            await cleanupUserFromRoom(userId, roomId, io, db, admin, voicePresence, roomService);
        }

        // --- PHASE 4: Also run purgeGhostsFromRAM for ALL cached rooms ---
        // This catches ghost players who were loaded from Firestore into RAM
        // but never registered a heartbeat (e.g., from a previous server session).
        for (const [roomId] of activeRoomRAM.entries()) {
            purgeGhostsFromRAM(roomId, voicePresence);
        }

        const totalCleaned = deadUsers.length + zombieSockets.length;
        if (totalCleaned > 0) {
            console.log(`💓 Heartbeat sweep complete: ${deadUsers.length} dead, ${zombieSockets.length} zombie socket(s) force-disconnected`);
        }
    }, SWEEP_INTERVAL_MS);

    console.log('💓 Heartbeat sweep started (every 1 minute)');
}

// --- FIX 3: Invalidate RAM cache for a specific room ---
// Call this when you manually edit Firestore (admin panel, manual cleanup, etc.)
// Forces the next getRoomState() to read fresh from Firestore.
function invalidateRoomRAM(roomId) {
    if (activeRoomRAM.has(roomId)) {
        activeRoomRAM.delete(roomId);
        console.log(`🗑️ [RAM Invalidate] Cleared RAM cache for room ${roomId}`);
        return true;
    }
    return false;
}

// Invalidate ALL rooms (useful after bulk admin cleanup)
function invalidateAllRoomRAM() {
    const count = activeRoomRAM.size;
    activeRoomRAM.clear();
    console.log(`🗑️ [RAM Invalidate] Cleared ALL ${count} rooms from RAM cache`);
    return count;
}

module.exports = { registerVoiceRoomHandlers, startHeartbeatSweep, activeRoomRAM, invalidateRoomRAM, invalidateAllRoomRAM };