const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { AccessToken } = require('livekit-server-sdk');

const db = admin.firestore();

// In-memory tracker for active calls to handle 1-minute deductions
const activeCalls = new Map();
// structure: roomId -> { boyId, girlId, startedAt, lastBilledAt }

// Helper to generate LiveKit Token
async function createToken(roomId, participantName, uid) {
    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
        identity: uid,
        name: participantName,
    });
    at.addGrant({ roomJoin: true, room: roomId, canUpdateOwnMetadata: true, canPublish: true, canPublishData: true });
    return await at.toJwt();
}

router.post('/go-online', async (req, res) => {
    try {
        const { uid, callType, topic, name, language, photoURL } = req.body;
        
        if (!uid || !callType) return res.status(400).json({ error: 'Missing parameters' });
        
        const roomId = `dating_${callType}_${uid}_${Date.now()}`;
        
        await db.collection('datingRooms').doc(roomId).set({
            roomId,
            girlId: uid,
            name: name || 'Girl',
            language: language || 'English',
            photoURL: photoURL || '',
            callType,
            topic: topic || 'Chat',
            status: 'waiting',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        const token = await createToken(roomId, name || uid, uid);
        
        res.status(200).json({ success: true, roomId, token });
    } catch (error) {
        console.error('Error in /go-online:', error);
        res.status(500).json({ error: 'Failed to go online' });
    }
});

router.post('/join-room', async (req, res) => {
    try {
        const { roomId, uid, name } = req.body; // uid is boy's ID
        
        const roomRef = db.collection('datingRooms').doc(roomId);
        
        let girlId = null;
        
        await db.runTransaction(async (t) => {
            const roomDoc = await t.get(roomRef);
            
            if (!roomDoc.exists || roomDoc.data().status !== 'waiting') {
                throw new Error('Room is no longer available');
            }
            
            girlId = roomDoc.data().girlId;
            if (girlId === uid) {
                throw new Error('Cannot join your own room');
            }
            
            // Check boy's diamonds and deduct 50
            const boyRef = db.collection('userProfiles').doc(uid);
            const boyDoc = await t.get(boyRef);
            
            if (!boyDoc.exists || (boyDoc.data().diamonds || 0) < 50) {
                throw new Error('Insufficient diamonds. You need at least 50 diamonds to join.');
            }
            
            // Deduct 50 diamonds
            t.update(boyRef, {
                diamonds: admin.firestore.FieldValue.increment(-50)
            });
            
            // Mark room as busy
            t.update(roomRef, {
                status: 'busy',
                boyId: uid,
                startedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        
        // Add to active calls for billing
        activeCalls.set(roomId, {
            boyId: uid,
            girlId: girlId,
            startedAt: Date.now(),
            lastBilledAt: Date.now()
        });
        
        const token = await createToken(roomId, name || uid, uid);
        
        res.status(200).json({ success: true, token });
    } catch (error) {
        console.error('Error in /join-room:', error);
        res.status(400).json({ error: error.message || 'Failed to join room' });
    }
});

router.post('/leave-room', async (req, res) => {
    try {
        const { roomId, uid } = req.body;
        
        const roomRef = db.collection('datingRooms').doc(roomId);
        const roomDoc = await roomRef.get();
        
        if (roomDoc.exists) {
            const data = roomDoc.data();
            if (uid === data.girlId) {
                // Girl leaves -> destroy room
                await roomRef.delete();
                activeCalls.delete(roomId);
            } else if (uid === data.boyId) {
                // Boy leaves -> back to waiting
                await roomRef.update({
                    status: 'waiting',
                    boyId: null,
                    startedAt: null
                });
                activeCalls.delete(roomId);
            }
        }
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error in /leave-room:', error);
        res.status(500).json({ error: 'Failed to leave room' });
    }
});

// Periodic billing every 10 seconds to check if a minute has passed
setInterval(async () => {
    const now = Date.now();
    for (const [roomId, call] of activeCalls.entries()) {
        if (now - call.lastBilledAt >= 60000) { // 1 minute passed
            call.lastBilledAt = now;
            
            try {
                const boyRef = db.collection('userProfiles').doc(call.boyId);
                const girlRef = db.collection('userProfiles').doc(call.girlId);
                
                const boyDoc = await boyRef.get();
                if (!boyDoc.exists || (boyDoc.data().diamonds || 0) < 50) {
                    // Boy ran out of diamonds. End call.
                    activeCalls.delete(roomId);
                    await db.collection('datingRooms').doc(roomId).update({
                        status: 'waiting',
                        boyId: null,
                        startedAt: null
                    });
                    
                    // NOTE: Optionally emit a socket event to kick boy from LiveKit.
                    // Or rely on the frontend room page listening to Firestore status changes.
                    continue;
                }
                
                // Deduct 50 diamonds from boy
                await boyRef.update({
                    diamonds: admin.firestore.FieldValue.increment(-50)
                });
                
                // Give 1 rose to girl
                await girlRef.update({
                    roses: admin.firestore.FieldValue.increment(1)
                });
                
            } catch (err) {
                console.error(`Error billing room ${roomId}:`, err);
            }
        }
    }
}, 10000);

module.exports = router;
