// A completely in-memory map to hold our 5-minute countdowns (Zero Firebase Reads!)
const voiceDisconnectTimers = new Map();

// --- HEARTBEAT SYSTEM: Detects ghost players when app is killed or network drops ---
// Key: userId, Value: { roomId, lastBeat: timestamp }
const voiceHeartbeats = new Map();

// --- RED PACKET MEMORY ENGINE ---
const activeRedPackets = new Map();

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

    const payloadObj = { packetId, rewards };
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
            const sessionRef = db.collection("voiceSessions").doc(roomId);
            let actionTaken = null; let oldSeat = null;

            await db.runTransaction(async (t) => {
                const doc = await t.get(sessionRef);
                if (!doc.exists) return;
                const d = doc.data();
                const currentPlayers = d.players || {};
                const dbPlayerUserIds = d.playerUserIds || [];

                const existingSeat = Object.keys(currentPlayers).find(key => currentPlayers[key]?.id === userId);
                if (existingSeat !== undefined) {
                    if (seatIndex !== null && existingSeat !== String(seatIndex) && !currentPlayers[seatIndex]) {
                         t.update(sessionRef, {
                             [`players.${existingSeat}`]: admin.firestore.FieldValue.delete(),
                             [`players.${seatIndex}`]: player,
                             lastActiveTimestamp: admin.firestore.FieldValue.serverTimestamp()
                         });
                         actionTaken = 'SWITCH_SEAT'; oldSeat = existingSeat;
                    }
                    return; 
                }

                if (seatIndex !== null && !currentPlayers[seatIndex]) {
                    const updates = {
                        [`players.${seatIndex}`]: player,
                        playerUserIds: admin.firestore.FieldValue.arrayUnion(userId),
                        lastActiveTimestamp: admin.firestore.FieldValue.serverTimestamp()
                    };
                    if (!dbPlayerUserIds.includes(userId)) {
                        updates.playerCount = admin.firestore.FieldValue.increment(1);
                    }
                    t.update(sessionRef, updates);
                    actionTaken = 'TAKE_SEAT';
                }
            });

            if (actionTaken) {
                // Re-read confirmed state after transaction for authoritative sync
                const confirmedDoc = await sessionRef.get();
                const confirmedPlayers = confirmedDoc.exists ? (confirmedDoc.data().players || {}) : {};

                if (actionTaken === 'SWITCH_SEAT') {
                    io.to(roomId).emit("voice_room_update", { type: 'SWITCH_SEAT', oldSeat, newSeat: seatIndex, player, userId });
                } else {
                    io.to(roomId).emit("voice_room_update", { type: 'TAKE_SEAT', seatIndex, player, userId });
                }

                if (roomService) {
                    try {
                        await roomService.updateParticipant(roomId, userId, undefined, { canPublish: true, canSubscribe: true, canPublishData: true });
                    } catch(e) {}
                }
            }

        } catch (err) { console.error("Voice Take Seat failed:", err); }
    });

    socket.on("voice_action_leave_seat", async (data) => {
        const { roomId, seatIndex, userId } = data;
        try {
            const sessionRef = db.collection("voiceSessions").doc(roomId);
            let success = false;
            await db.runTransaction(async (t) => {
                const doc = await t.get(sessionRef);
                if (!doc.exists) return;
                const d = doc.data();
                
                const isSelf = verifyVoiceSocketIdentity(userId);
                const isHost = verifyVoiceSocketIdentity(d.hostUserId);
                
                let requesterId = (socket.user && socket.user.uid) || socket.userId;
                if (!requesterId) {
                    const sessionUser = socketUserMap.get(socket.id);
                    if (sessionUser) requesterId = sessionUser.userId;
                }
                
                const isAdmin = d.adminUserIds && d.adminUserIds.includes(requesterId);
                const targetIsHost = userId === d.hostUserId;
                const targetIsAdmin = d.adminUserIds && d.adminUserIds.includes(userId);
                
                let canLift = false;
                if (isSelf || isHost) {
                    canLift = true; // Self or Host
                } else if (isAdmin && !targetIsHost && !targetIsAdmin) {
                    canLift = true; // Admin lifting normal user
                }

                if (!canLift) {
                    console.error(`Blocked unauthorized voice_action_leave_seat attempt by ${requesterId || 'unauth'} against ${userId}`);
                    return;
                }

                if (seatIndex !== null && seatIndex !== undefined) {
                    t.update(sessionRef, { 
                        [`players.${seatIndex}`]: admin.firestore.FieldValue.delete(),
                        selfMutedUserIds: admin.firestore.FieldValue.arrayRemove(userId)
                    });
                    success = true;
                }
            });
            if (success) {
                const confirmedDoc = await sessionRef.get();
                io.to(roomId).emit("voice_room_update", { type: 'LEAVE_SEAT', seatIndex, userId });
                if (roomService) {
                    try {
                        await roomService.updateParticipant(roomId, userId, undefined, { canPublish: false, canSubscribe: true, canPublishData: true });
                    } catch(e) {}
                }
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
            const sessionRef = db.collection("voiceSessions").doc(roomId);
            let success = false;
            await db.runTransaction(async (t) => {
                const doc = await t.get(sessionRef);
                if (!doc.exists) return;
                
                const dbData = doc.data();
                const currentPlayers = dbData.players || {};
                const dbPlayerUserIds = dbData.playerUserIds || [];
                const updates = { 
                    playerUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                    selfMutedUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                    lastActiveTimestamp: admin.firestore.FieldValue.serverTimestamp()
                };
                if (dbPlayerUserIds.includes(userId)) {
                    updates.playerCount = admin.firestore.FieldValue.increment(-1);
                }
                
                const foundSeat = Object.keys(currentPlayers).find(key => currentPlayers[key]?.id === userId);
                if (foundSeat !== undefined) {
                    updates[`players.${foundSeat}`] = admin.firestore.FieldValue.delete();
                } else if (seatIndex !== null && seatIndex !== undefined) {
                    updates[`players.${seatIndex}`] = admin.firestore.FieldValue.delete();
                }
                
                t.update(sessionRef, updates);
                success = true;
            });
            
            if (success) {
                const confirmedDoc = await sessionRef.get();
                io.to(roomId).emit("voice_room_update", { type: 'EXIT', seatIndex, userId });
                if (roomService) {
                    try {
                        await roomService.removeParticipant(roomId, userId);
                    } catch(e) {}
                }
            }
        } catch (err) { console.error("Voice Exit Room failed:", err); }
    });

    socket.on("voice_action_kick_user", async (data) => {
        const { roomId, userId: targetUserId } = data;
        try {
            const sessionRef = db.collection("voiceSessions").doc(roomId);
            let success = false;
            let targetSeat = null;
            await db.runTransaction(async (t) => {
                const doc = await t.get(sessionRef);
                if (!doc.exists) return;
                const d = doc.data();

                const isHost = verifyVoiceSocketIdentity(d.hostUserId);
                
                let requesterId = (socket.user && socket.user.uid) || socket.userId;
                if (!requesterId) {
                    const sessionUser = socketUserMap.get(socket.id);
                    if (sessionUser) requesterId = sessionUser.userId;
                }
                
                const isAdmin = d.adminUserIds && d.adminUserIds.includes(requesterId);
                const targetIsHost = targetUserId === d.hostUserId;
                const targetIsAdmin = d.adminUserIds && d.adminUserIds.includes(targetUserId);

                let canKick = false;
                if (isHost) {
                    canKick = true;
                } else if (isAdmin && !targetIsHost && !targetIsAdmin) {
                    canKick = true;
                }

                if (!canKick) {
                    console.error(`Blocked unauthorized kick attempt by ${requesterId || 'unauth'} against ${targetUserId}`);
                    return;
                }

                const currentPlayers = d.players || {};
                const dbPlayerUserIds = d.playerUserIds || [];
                const seatIndexStr = Object.keys(currentPlayers).find(key => currentPlayers[key]?.id === targetUserId);
                
                const updates = { 
                    playerUserIds: admin.firestore.FieldValue.arrayRemove(targetUserId),
                    selfMutedUserIds: admin.firestore.FieldValue.arrayRemove(targetUserId),
                    lastActiveTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                    [`kickedUsers.${targetUserId}`]: Date.now()
                };
                if (dbPlayerUserIds.includes(targetUserId)) {
                    updates.playerCount = admin.firestore.FieldValue.increment(-1);
                }
                
                if (seatIndexStr !== undefined) {
                    targetSeat = parseInt(seatIndexStr);
                    updates[`players.${seatIndexStr}`] = admin.firestore.FieldValue.delete();
                }

                t.update(sessionRef, updates);
                success = true;
            });

            if (success) {
                const confirmedDoc = await sessionRef.get();
                io.to(roomId).emit("voice_room_update", { type: 'KICK', seatIndex: targetSeat, userId: targetUserId });
                if (roomService) {
                    try {
                        await roomService.removeParticipant(roomId, targetUserId);
                    } catch(e) {
                        console.error("Failed to remove LiveKit participant during kick", e);
                    }
                }
            }
        } catch (err) { console.error("Voice Kick User failed:", err); }
    });

    socket.on("voice_action_join_room", async (data) => {
        const { roomId, userId, password, isInvite, isReconnect } = data;

        try {
            const sessionRef = db.collection("voiceSessions").doc(roomId);
            const sessionDoc = await sessionRef.get();
            if (!sessionDoc.exists) return;
            const sessionData = sessionDoc.data();
            
            if (sessionData.kickedUsers && sessionData.kickedUsers[userId]) {
                const kickedTime = sessionData.kickedUsers[userId];
                const fiveMinutesInMs = 5 * 60 * 1000;
                if (Date.now() - kickedTime < fiveMinutesInMs) {
                    const remainingMinutes = Math.ceil((fiveMinutesInMs - (Date.now() - kickedTime)) / 60000);
                    socket.emit('voice_room_update', { type: 'ERROR', message: `You were kicked. Try again in ${remainingMinutes} minute(s).` });
                    return;
                }
            }
            
            if (sessionData.isLocked) {
                const isHost = sessionData.hostUserId === userId;
                const isAdmin = (sessionData.adminUserIds || []).includes(userId);
                const isAlreadyInRoom = (sessionData.playerUserIds || []).includes(userId);
                if (!isHost && !isAdmin && !isAlreadyInRoom && !isInvite && sessionData.password !== password) {
                    socket.emit('voice_room_update', { type: 'ERROR', message: 'Invalid password' });
                    return; // Reject connection
                }
            }
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
            }).catch(() => {});
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
            const sessionRef = db.collection("voiceSessions").doc(roomId);
            const userRef = db.collection("userProfiles").doc(userId);
            
            const userDoc = await userRef.get();
            
            await db.runTransaction(async (t) => {
                const currentPresence = voicePresence?.get(socket.id);
                if (!currentPresence || currentPresence.roomId !== roomId) {
                    return; 
                }

                const sessionDoc = await t.get(sessionRef);
                if (!sessionDoc.exists) return;

                const sessionData = sessionDoc.data();
                const dbPlayerUserIds = sessionData.playerUserIds || [];

                const finalUpdates = {
                    playerUserIds: admin.firestore.FieldValue.arrayUnion(userId),
                    lastActiveTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                    selfMutedUserIds: admin.firestore.FieldValue.arrayRemove(userId)
                };
                if (!dbPlayerUserIds.includes(userId)) {
                    finalUpdates.playerCount = admin.firestore.FieldValue.increment(1);
                }

                t.update(sessionRef, finalUpdates);
                
                if (userDoc.exists && !isReconnect) {
                    const userData = userDoc.data();
                    
                    if (userData.isVip && userData.vipLevel >= 1) {
                        const chatRef = sessionRef.collection("chatMessages").doc();
                        t.set(chatRef, {
                            gameSessionId: roomId,
                            senderUserId: 'system',
                            messageText: `[VIP ${userData.vipLevel}] ${userData.username} made a grand entrance!`,
                            sentAt: admin.firestore.FieldValue.serverTimestamp(),
                            vipLevel: userData.vipLevel,
                            isVipEntry: true,
                            isSystem: true
                        });
                    }
                }
            });
            
            // Broadcast JOIN_ROOM with VIP data to trigger instant entrance effect
            const userSnap = await db.collection("userProfiles").doc(userId).get();
            const uData = userSnap.exists ? userSnap.data() : {};
            io.to(roomId).emit("voice_room_update", { 
                type: 'JOIN_ROOM', 
                userId,
                isVip: uData.isVip || false,
                vipLevel: uData.vipLevel || 0,
                username: uData.username || "User"
            });

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

                try {
                    let seatToClear = null; 

                    const sessionRef = db.collection("voiceSessions").doc(roomId);
                    await db.runTransaction(async (t) => {
                        const doc = await t.get(sessionRef);
                        if (!doc.exists) return;
                        
                        let isActuallyOnline = false;
                        for (let [sId, p] of voicePresence.entries()) {
                            if (p.userId === userId && p.roomId === roomId) {
                                isActuallyOnline = true; break;
                            }
                        }
                        if (isActuallyOnline) return; 
                        
                        const docData = doc.data();
                        const currentPlayers = docData.players || {};
                        const dbPlayerUserIds = docData.playerUserIds || [];
                        const updates = { 
                            playerUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                            selfMutedUserIds: admin.firestore.FieldValue.arrayRemove(userId)
                        };
                        // FIX: Decrement playerCount when removing from playerUserIds.
                        // Previously this was missing, causing playerCount to drift higher
                        // over time since disconnects removed from the array but never
                        // decremented the counter.
                        if (dbPlayerUserIds.includes(userId)) {
                            updates.playerCount = admin.firestore.FieldValue.increment(-1);
                        }
                        
                        const seatIndex = Object.keys(currentPlayers).find(key => currentPlayers[key]?.id === userId);
                        if (seatIndex !== undefined) {
                            updates[`players.${seatIndex}`] = admin.firestore.FieldValue.delete();
                            seatToClear = parseInt(seatIndex); 
                        }
                        
                        t.update(sessionRef, updates);
                    });
                    
                    io.to(roomId).emit("voice_room_update", { type: 'EXIT', userId, seatIndex: seatToClear });

                    // Kill their LiveKit voice connection on disconnect cleanup
                    if (roomService) {
                        try {
                            await roomService.removeParticipant(roomId, userId);
                        } catch(e) { console.warn("LiveKit removeParticipant on disconnect cleanup:", e); }
                    }
                    
                } catch (err) { console.error("Voice 5-minute disconnect cleanup failed:", err); }
                
            }, 5 * 60 * 1000);

            voiceDisconnectTimers.set(userId, timerId);
        }
    });
}

// --- HEARTBEAT SWEEP: Runs every 2 minutes to find and remove ghost players ---
// Called ONCE from index.js at server startup. Shares the same cleanup logic as
// the disconnect handler but catches cases where disconnect never fires
// (app killed, network drop, server restart).
let sweepStarted = false;
function startHeartbeatSweep(io, db, admin, voicePresence, roomService) {
    if (sweepStarted) return; // Prevent duplicate intervals
    sweepStarted = true;

    const SWEEP_INTERVAL_MS = 2 * 60 * 1000;  // Run every 2 minutes
    const DEAD_THRESHOLD_MS = 2 * 60 * 1000;  // User is dead if no heartbeat for 2 minutes

    setInterval(async () => {
        const now = Date.now();
        const deadUsers = [];

        for (const [userId, data] of voiceHeartbeats.entries()) {
            if (now - data.lastBeat > DEAD_THRESHOLD_MS) {
                // Double-check: is this user still connected via any socket?
                let isActuallyOnline = false;
                if (voicePresence) {
                    for (const [, p] of voicePresence.entries()) {
                        if (p.userId === userId && p.roomId === data.roomId) {
                            isActuallyOnline = true;
                            break;
                        }
                    }
                }
                if (!isActuallyOnline) {
                    deadUsers.push({ userId, roomId: data.roomId });
                } else {
                    // They have an active socket but missed heartbeats — refresh their beat
                    data.lastBeat = now;
                }
            }
        }

        for (const { userId, roomId } of deadUsers) {
            voiceHeartbeats.delete(userId);

            // Skip if the disconnect timer is already handling this user
            if (voiceDisconnectTimers.has(userId)) continue;

            console.log(`💓 Heartbeat sweep: Cleaning up ghost user ${userId} from room ${roomId}`);

            try {
                let seatToClear = null;
                const sessionRef = db.collection("voiceSessions").doc(roomId);

                await db.runTransaction(async (t) => {
                    const doc = await t.get(sessionRef);
                    if (!doc.exists) return;

                    // Final safety check inside transaction
                    let stillOnline = false;
                    if (voicePresence) {
                        for (const [, p] of voicePresence.entries()) {
                            if (p.userId === userId && p.roomId === roomId) {
                                stillOnline = true;
                                break;
                            }
                        }
                    }
                    if (stillOnline) return;

                    const docData = doc.data();
                    const currentPlayers = docData.players || {};
                    const dbPlayerUserIds = docData.playerUserIds || [];

                    // Don't clean up if user is not even in this room's data
                    if (!dbPlayerUserIds.includes(userId)) return;

                    const updates = {
                        playerUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                        selfMutedUserIds: admin.firestore.FieldValue.arrayRemove(userId)
                    };
                    if (dbPlayerUserIds.includes(userId)) {
                        updates.playerCount = admin.firestore.FieldValue.increment(-1);
                    }

                    const seatIndex = Object.keys(currentPlayers).find(key => currentPlayers[key]?.id === userId);
                    if (seatIndex !== undefined) {
                        updates[`players.${seatIndex}`] = admin.firestore.FieldValue.delete();
                        seatToClear = parseInt(seatIndex);
                    }

                    t.update(sessionRef, updates);
                });

                io.to(roomId).emit("voice_room_update", { type: 'EXIT', userId, seatIndex: seatToClear });

                if (roomService) {
                    try {
                        await roomService.removeParticipant(roomId, userId);
                    } catch (e) { console.warn("LiveKit removeParticipant on heartbeat sweep:", e); }
                }

            } catch (err) {
                console.error(`💓 Heartbeat sweep cleanup failed for ${userId}:`, err);
            }
        }

        if (deadUsers.length > 0) {
            console.log(`💓 Heartbeat sweep complete: cleaned ${deadUsers.length} ghost user(s)`);
        }
    }, SWEEP_INTERVAL_MS);

    console.log('💓 Heartbeat sweep started (every 2 minutes)');
}

module.exports = { registerVoiceRoomHandlers, startHeartbeatSweep };