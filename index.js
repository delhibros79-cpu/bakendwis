require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require("socket.io");
const admin = require("firebase-admin");
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const cron = require('node-cron');

const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const { startCronJobs } = require('./cronJobs');
startCronJobs(db);

const { startGreedyGameLoop, registerGreedyGameHandlers } = require('./greedyGameServer');
const { startFruitGreedyGameLoop, registerFruitGreedyGameHandlers } = require('./fruitGreedyGameServer');
const { registerSuperSlotHandlers } = require('./superSlotGameServer');
const { registerBingoHandlers } = require('./bingoGameServer');
const { registerTicTacToeHandlers } = require('./ticTacToeServer');
const { registerJakaroHandlers } = require('./jakaroGameServer');

const { runGameOrchestrator } = require('./gameOrchestrator');
const { registerVoiceRoomHandlers, startHeartbeatSweep } = require('./voiceRoomHandler');
const { setupLudoRoutes } = require('./ludoHandler');
const { setupCoinSellerRoutes } = require('./coinSellerHandler');
const datingRouter = require('./datingHandler');
let roomService = null;
try {
    roomService = new RoomServiceClient(
        process.env.LIVEKIT_URL,
        process.env.LIVEKIT_API_KEY,
        process.env.LIVEKIT_API_SECRET
    );
} catch (e) {
    console.error("Failed to initialize LiveKit RoomServiceClient:", e);
}

const { initBots, scheduleBotJoin, handleBotKickOrExit, releaseBotsFromRoom, checkAndEvacuateBots, handleBotLiftUp } = require('./botManager');

const SERVER_FRAMES = [
    { id: '1', name: "Apple", weeklyPrice: 500 },
    { id: '2', name: "Blue", weeklyPrice: 1000 },
    { id: '3', name: "Cake", weeklyPrice: 1500 },
    { id: '4', name: "Cat", weeklyPrice: 2000 },
    { id: '5', name: "Cat 2", weeklyPrice: 2500 },
    { id: '6', name: "Cool", weeklyPrice: 3000 },
    { id: '7', name: "Dusky", weeklyPrice: 3500 },
    { id: '8', name: "Fire", weeklyPrice: 4000 },
    { id: '9', name: "Fool", weeklyPrice: 4500 },
    { id: '10', name: "Frog", weeklyPrice: 5000 },
    { id: '11', name: "Galaxy", weeklyPrice: 5500 },
    { id: '12', name: "Heart", weeklyPrice: 6000 },
    { id: '13', name: "Moon", weeklyPrice: 6500 },
    { id: '14', name: "Mouse", weeklyPrice: 7000 },
    { id: '15', name: "Ring", weeklyPrice: 7500 },
    { id: '16', name: "Ring 2", weeklyPrice: 8000 },
    { id: '17', name: "Sky", weeklyPrice: 8500 },
    { id: '18', name: "X Frame", weeklyPrice: 9000 },
    { id: '19', name: "Aura", weeklyPrice: 9500 },
    { id: '20', name: "Bubble", weeklyPrice: 10000 },
    { id: '22', name: "Pankh", weeklyPrice: 11000 },
    { id: '23', name: "Pankh 2", weeklyPrice: 11500 },
    { id: '25', name: "Diamond", weeklyPrice: 12500 },
    { id: '26', name: "VIP", weeklyPrice: 13000 },
    { id: '27', name: "VIP 2", weeklyPrice: 13500 }
];


const RING_PRICES = {
    'ring_1': 4444,
    'ring_2': 7777,
    'ring_3': 88888,
    'ring_4': 111111,
    'ring_5': 250000,
    'ring_6': 300000,
    'ring_7': 500000
};

const SERVER_GIFTS = [
    { id: 'g1', name: 'Balloons', price: 100 },
    { id: 'g2', name: 'Mojito', price: 300 },
    { id: 'g3', name: 'Smooch', price: 1000 },
    { id: 'g4', name: 'Luxury Car', price: 9999 },
    { id: 'g5', name: 'Balloon', price: 50 },
    { id: 'g6', name: 'Magic Pill', price: 90 },
    { id: 'g7', name: 'Sports Car', price: 10000 },
    { id: 'g8', name: 'Red Car', price: 1200 },
    { id: 'g9', name: 'Kiss', price: 250 },
    { id: 'g10', name: 'Fireworks', price: 2000 },
    { id: 'g11', name: 'Rose', price: 80 },
    { id: 'g12', name: 'Ice Cream', price: 50 },
    { id: 'g13', name: 'Welcome', price: 49999 },
    { id: 'g_egg', name: 'Egg', price: 10, type: 'egg' },
    { id: 'g_flower', name: 'Flower', price: 5, type: 'flower' },
    { id: 'g14', name: 'Books', price: 100 },
    { id: 'g15', name: 'Bun', price: 50 },
    { id: 'g16', name: 'Bunny', price: 150 },
    { id: 'g17', name: 'Camera', price: 200 },
    { id: 'g18', name: 'Coffee Kitty', price: 120 },
    { id: 'g19', name: 'Cute', price: 300 },
    { id: 'g20', name: 'Cute Dance', price: 500 },
    { id: 'g21', name: 'Daisy', price: 100 },
    { id: 'g22', name: 'Headphones', price: 150 },
    { id: 'g23', name: 'Lemon Juice', price: 80 },
    { id: 'g24', name: 'Let\'s Travel', price: 400 },
    { id: 'g25', name: 'Lip Product', price: 100 },
    { id: 'g26', name: 'Lipstick', price: 150 },
    { id: 'g27', name: 'Money', price: 1000 },
    { id: 'g28', name: 'Pancake', price: 60 },
    { id: 'g29', name: 'Pokie', price: 100 },
    { id: 'g30', name: 'Samosa', price: 20 },
    { id: 'g31', name: 'Suitcase', price: 300 },
    { id: 'g32', name: 'Swag', price: 500 },
    { id: 'g33', name: 'Working', price: 100 },
    { id: 'g34', name: 'Yeda Hai Kya', price: 50 },
    { id: 'g35', name: 'Max Aura', price: 77000 },
    { id: 'g36', name: 'I M Boss', price: 101000 },
    { id: 'g37', name: 'Champagne', price: 167000 },
    { id: 'g38', name: 'Castle', price: 267000 },
    { id: 'g39', name: 'Royal Palace', price: 500000 },
    { id: 'g40', name: 'Lion King', price: 300000 },
    { id: 'g41', name: 'PK Gift', price: 10000 },
    { id: 'g42', name: 'Money Plane', price: 1000000 },
    { id: 'g43', name: 'Royal Perfume', price: 1200000 },
    { id: 'g44', name: 'Party Time', price: 400000 }
];

const voicePresence = new Map(); 

function getRoomLevel(exp) {
    if (exp >= 14000000000) return 30;
    if (exp >= 11500000000) return 29;
    if (exp >= 9500000000) return 28;
    if (exp >= 7800000000) return 27;
    if (exp >= 6400000000) return 26;
    if (exp >= 5200000000) return 25;
    if (exp >= 4200000000) return 24;
    if (exp >= 3400000000) return 23;
    if (exp >= 2700000000) return 22;
    if (exp >= 2100000000) return 21;
    if (exp >= 1600000000) return 20;
    if (exp >= 1200000000) return 19;
    if (exp >= 900000000) return 18;
    if (exp >= 650000000) return 17;
    if (exp >= 450000000) return 16;
    if (exp >= 300000000) return 15;
    if (exp >= 200000000) return 14;
    if (exp >= 130000000) return 13;
    if (exp >= 80000000) return 12;
    if (exp >= 45000000) return 11;
    if (exp >= 24000000) return 10;
    if (exp >= 11000000) return 9;
    if (exp >= 4800000) return 8;
    if (exp >= 2000000) return 7;
    if (exp >= 800000) return 6;
    if (exp >= 300000) return 5;
    if (exp >= 100000) return 4;
    if (exp >= 30000) return 3;
    if (exp >= 8000) return 2;
    return 1;
}

function getVipLevel(growthPts) {
    if (growthPts >= 6800000) return 11;
    if (growthPts >= 3380000) return 10;
    if (growthPts >= 1680000) return 9;
    if (growthPts >= 820000) return 8;
    if (growthPts >= 380000) return 7;
    if (growthPts >= 140000) return 6;
    if (growthPts >= 60000) return 5;
    if (growthPts >= 25000) return 4;
    if (growthPts >= 5000) return 3;
    if (growthPts >= 1000) return 2;
    return 1;
}

async function processTimeExp(roomId, minutesToProcess, db, admin) {
    if (minutesToProcess <= 0) return;
    try {
        const roomRef = db.collection('voiceSessions').doc(roomId);
        const todayStr = new Date().toISOString().split('T')[0];

        await db.runTransaction(async (t) => {
            const doc = await t.get(roomRef);
            if (!doc.exists) return;
            const data = doc.data();

            let currentDailyTimeExp = data.dailyDate === todayStr ? (data.dailyTimeExp || 0) : 0;
            let currentDailyExp = data.dailyDate === todayStr ? (data.dailyExp || 0) : 0;
            let currentTotalExp = data.exp || 0;

            let expToAdd = minutesToProcess;
            
            if (currentDailyTimeExp + expToAdd > 5000) {
                expToAdd = 5000 - currentDailyTimeExp;
            }

            if (expToAdd <= 0) {
                if (data.dailyDate !== todayStr) t.update(roomRef, { dailyDate: todayStr, dailyTimeExp: 0, dailyExp: 0 });
                return;
            }

            const newTotalExp = currentTotalExp + expToAdd;
            const newLevel = getRoomLevel(newTotalExp);

            t.update(roomRef, {
                exp: newTotalExp,
                level: newLevel,
                dailyExp: currentDailyExp + expToAdd,
                dailyTimeExp: currentDailyTimeExp + expToAdd,
                dailyDate: todayStr
            });
        });
    } catch (e) {
        console.error("Failed to process room time exp:", e);
    }
}

cron.schedule('0 * * * *', async () => {
    console.log('⏳ Flushing Hourly Voice Room Time EXP...');
    const now = Date.now();
    for (const [socketId, data] of voicePresence.entries()) {
        const minutes = Math.floor((now - data.joinTime) / 60000);
        if (minutes > 0) {
            await processTimeExp(data.roomId, minutes, db, admin);
            data.joinTime = now; 
        }
    }
});

const app = express();
app.use('/gift', express.static('public/gift'));
const ALLOWED_ORIGINS = ['https://who-is-spy-backend.duckdns.org', 'https://whoisspy-voice.duckdns.org', 'capacitor://localhost', 'http://localhost', 'https://localhost', 'http://localhost:3000', 'https://localhost:3000', 'http://localhost:3001'];
app.use(cors({
    origin: (origin, callback) => {
        // Return exact origin string when present so CORS allows credentials without blocking mobile/Capacitor webviews
        callback(null, origin || true);
    },
    credentials: true
}));
app.use(express.json());

const SUB_ADMIN_PASSWORD = '7076';

app.post('/api/subadmin/verify-dating', async (req, res) => {
    const { subadminPassword, uid, action } = req.body;
    
    if (subadminPassword !== SUB_ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid sub-admin password' });
    }
    if (!uid || !action || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'Invalid parameters' });
    }

    try {
        const newStatus = action === 'approve' ? 'approved' : 'rejected';
        await db.collection('userProfiles').doc(uid).update({
            datingVerificationStatus: newStatus,
            datingVerificationReviewedAt: Date.now()
        });
        res.json({ success: true, message: `Verification ${newStatus} successfully` });
    } catch (e) {
        console.error('Error verifying dating profile:', e);
        res.status(500).json({ error: 'Server error updating verification' });
    }
});
app.use('/api/dating', datingRouter);
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
        callback(null, origin || true);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
    credentials: true
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

setupLudoRoutes(app, db);
setupCoinSellerRoutes(app, db, admin);

const { setupFamilyRoutes } = require('./familyHandler');
setupFamilyRoutes(app, db, admin);

async function verifyUserAllowedInRoom(roomName, uid, dbInstance) {
    if (!roomName || !uid) return false;
    try {
        const collectionName = roomName.startsWith('VR') ? 'voiceSessions' : 'gameSessions';
        const roomDoc = await dbInstance.collection(collectionName).doc(roomName).get();
        if (!roomDoc.exists) return true; 
        const data = roomDoc.data();
        if (collectionName === 'voiceSessions' && data.status !== 'deleted') {
            if (data.isLocked) {
                const playerIds = data.playerUserIds || [];
                const seatedIds = data.seatedPlayerUserIds || [];
                const visitedIds = data.visitedUserIds || [];
                const adminIds = data.adminUserIds || [];
                const hostId = data.hostUserId;
                if (hostId === uid || adminIds.includes(uid) || playerIds.includes(uid) || seatedIds.includes(uid) || visitedIds.includes(uid)) {
                    return true;
                }
                return false; // Deny access to locked rooms until socket validates password
            }
            return true; // Allow participants and visitors into active public voice rooms immediately
        }
        if (collectionName === 'gameSessions' && !data.password && data.status !== 'deleted') {
            return true; // Allow players and spectators into public game rooms immediately
        }
        const playerIds = data.playerUserIds || [];
        const seatedIds = data.seatedPlayerUserIds || [];
        const visitedIds = data.visitedUserIds || [];
        const hostId = data.hostUserId;
        return (hostId === uid || playerIds.includes(uid) || seatedIds.includes(uid) || visitedIds.includes(uid));
    } catch (e) {
        console.error("Room membership check error:", e);
        return true; 
    }
}


app.post('/api/livekit-token', async (req, res) => {
    const roomName = req.body.channelName || req.body.roomName;
    const participantId = req.body.uid || req.body.participantName;

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!roomName || !participantId) return res.status(400).json({ error: 'Missing parameters' });
    if (!apiKey || !apiSecret) return res.status(500).json({ error: 'LiveKit keys missing on server' });

    // 🛑 STRICT SECURITY: Firebase Auth token is MANDATORY to prevent unauthorized voice room access
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }
    try {
        const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
        if (decoded.uid !== participantId && decoded.uid !== String(participantId)) {
            return res.status(403).json({ error: 'Forbidden: UID mismatch' });
        }
    } catch (e) {
        console.warn('[LiveKit Token] Invalid auth token:', e.message);
        return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
    }

    // 🛑 STRICT SECURITY: Verify user is a legitimate participant/visitor of the room
    const isAllowed = await verifyUserAllowedInRoom(roomName, String(participantId), db);
    if (!isAllowed) {
        console.error(`[LiveKit Token] Blocked unauthorized token request for room ${roomName} by user ${participantId}`);
        return res.status(403).json({ error: 'Unauthorized to access this room channel' });
    }

    try {
        let isSeated = false;
        try {
            const collectionName = roomName.startsWith('VR') ? 'voiceSessions' : 'gameSessions';
            const roomDoc = await db.collection(collectionName).doc(roomName).get();
            if (roomDoc.exists) {
                const data = roomDoc.data();
                if (collectionName === 'voiceSessions') {
                    const players = data.players || {};
                    isSeated = Object.values(players).some(p => p && String(p.id) === String(participantId));
                } else {
                    isSeated = (data.seatedPlayerUserIds || []).includes(String(participantId));
                }
            }
        } catch(e) { console.warn("Failed seating check:", e); }

        const at = new AccessToken(apiKey, apiSecret, { identity: String(participantId) });
        at.addGrant({ roomJoin: true, room: roomName, canUpdateOwnMetadata: true, canPublish: isSeated, canPublishData: true });

        // Fetch user profile to embed in initial metadata
        let initialMetadata = { seat: null, username: "User", photoURL: null };
        try {
            const userDoc = await db.collection('userProfiles').doc(String(participantId)).get();
            if (userDoc.exists) {
                const d = userDoc.data();
                initialMetadata.username = d.username || "User";
                initialMetadata.photoURL = d.photoURL || null;
            }
        } catch (dbErr) {
            console.warn("Failed to fetch user profile for metadata:", dbErr);
        }
        
        at.name = initialMetadata.username;
        at.metadata = JSON.stringify(initialMetadata);

        const token = await at.toJwt();
        res.json({ token, provider: 'livekit' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate LiveKit token' });
    }
});

// --- SECURE BOT AUDIO PROXY (HIDES SECRET WORDS FROM CLIENTS) ---
app.get('/api/bot-audio', async (req, res) => {
    const { sessionId, gameId, botId, roundNumber, turnIndex } = req.query;
    if (!sessionId || !gameId || !botId) {
        return res.status(400).send('Missing parameters');
    }

    // 🛑 STRICT SECURITY: Require Firebase Auth to prevent unauthenticated access
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send('Unauthorized: Authentication required');
    }
    try {
        await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
    } catch (e) {
        return res.status(401).send('Unauthorized: Invalid token');
    }

    try {
        const gameDoc = await db.collection('gameSessions').doc(String(sessionId)).collection('games').doc(String(gameId)).get();
        if (!gameDoc.exists) return res.status(404).send('Game not found');
        const gameData = gameDoc.data()?.gameData;
        if (!gameData || !gameData.villagerWord || !gameData.spyWord || !gameData.category) {
            return res.status(404).send('Game data not found');
        }

        const getCategoryShortcode = (cat) => {
            const map = { "Food": "Food", "Sports": "Sports", "City/Building": "CB", "Animals/Plants/Nature": "APL", "Life": "Life", "Character/Profession": "CP", "Other": "Other" };
            return map[cat] || "Other";
        };
        const voices = ['Aarti', 'Anjali', 'Divya', 'Kavita', 'Neha', 'Pooja', 'Riya', 'Simran', 'Sneha', 'Zara'];
        let hash = 0;
        const bId = String(botId);
        for (let i = 0; i < bId.length; i++) hash += bId.charCodeAt(i);
        const voiceName = voices[hash % voices.length];
        const catCode = getCategoryShortcode(gameData.category);
        const pairName = `${gameData.villagerWord}_${gameData.spyWord}`;
        const lineNum = ((hash * 3) + ((parseInt(roundNumber) || 1) * 7) + ((parseInt(turnIndex) || 0) * 11)) % 10 + 1;
        const encodedPair = encodeURIComponent(pairName);
        const fileName = encodeURIComponent(`${pairName}_line_${lineNum}.mp3`);
        const storageUrl = `https://firebasestorage.googleapis.com/v0/b/studio-1902582860-38699.firebasestorage.app/o/audio%2F${voiceName}%2F${catCode}%2F${encodedPair}%2F${fileName}?alt=media`;

        const audioRes = await fetch(storageUrl);
        if (!audioRes.ok) {
            return res.status(404).send('Audio file not found on storage');
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        const arrayBuffer = await audioRes.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
    } catch (error) {
        console.error('Bot audio proxy error:', error);
        res.status(500).send('Server error');
    }
});

// --- SECURE DAILY REWARD CLAIM API (SERVER-SIDE RATE LIMIT & DATABASE ADMIN WRITES) ---
app.post('/api/claim-daily-reward', async (req, res) => {
    const { rewardType } = req.body; 
    if (!rewardType || (rewardType !== 'coins' && rewardType !== 'xp' && rewardType !== 'diamonds')) {
        return res.status(400).json({ error: 'Invalid reward type requested' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    let uid;
    try {
        const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
        uid = decoded.uid;
    } catch (e) {
        console.warn('[Daily Reward API] Auth error:', e.message);
        return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const claimField = rewardType === 'coins' ? 'lastDailyCoinsClaimDate' : (rewardType === 'diamonds' ? 'lastDailyDiamondsClaimTimestamp' : 'lastDailyXpClaimDate');

    try {
        const userRef = db.collection('userProfiles').doc(uid);
        let updatedValue = 0;
        let amountToGrant = 0;
        let newStreak = 0;
        const nowMs = Date.now();

        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) throw new Error("User profile not found");
            const data = doc.data();

            if (rewardType === 'diamonds') {
                const lastClaimTime = data.lastDailyDiamondsClaimTimestamp;
                if (lastClaimTime) {
                    const timeSinceLastClaim = nowMs - lastClaimTime;
                    if (timeSinceLastClaim < 24 * 60 * 60 * 1000) {
                        throw new Error("Already claimed within 24 hours");
                    }
                }
            } else {
                if (data[claimField] === todayStr) {
                    throw new Error("Already claimed today");
                }
            }

            if (rewardType === 'coins') {
                const lastClaimDateStr = data[claimField];
                let streak = data.loginStreak || 0;
                
                if (lastClaimDateStr) {
                    const lastDate = new Date(lastClaimDateStr + "T00:00:00Z");
                    const todayDate = new Date(todayStr + "T00:00:00Z");
                    const diffTime = todayDate.getTime() - lastDate.getTime();
                    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)); 
                    
                    if (diffDays === 1) {
                        streak += 1;
                        if (streak > 7) streak = 1; // Reset after 7 days
                    } else {
                        streak = 1; // Reset if missed a day
                    }
                } else {
                    streak = 1; // First time claim
                }

                const coinRewards = [100, 500, 1000, 1500, 2000, 2500, 4000];
                amountToGrant = coinRewards[streak - 1];
                newStreak = streak;
            } else if (rewardType === 'diamonds') {
                amountToGrant = 15; // Fixed diamonds reward
            } else {
                amountToGrant = 50; // Fixed XP reward
            }

            const currentBalance = data[rewardType] || 0;
            updatedValue = currentBalance + amountToGrant;

            const updateData = {
                [rewardType]: admin.firestore.FieldValue.increment(amountToGrant)
            };
            
            if (rewardType === 'diamonds') {
                updateData[claimField] = nowMs;
            } else {
                updateData[claimField] = todayStr;
            }
            
            if (rewardType === 'coins') {
                updateData.loginStreak = newStreak;
            }

            t.update(userRef, updateData);
        });

        res.json({ success: true, rewardType, amountGranted: amountToGrant, newValue: updatedValue, claimedDate: rewardType === 'diamonds' ? nowMs : todayStr, loginStreak: newStreak });
    } catch (error) {
        if (error.message === "Already claimed today" || error.message === "Already claimed within 24 hours") {
            return res.status(429).json({ error: error.message });
        }
        console.error('[Daily Reward API] Claim error:', error.message);
        res.status(500).json({ error: error.message || 'Failed to claim daily reward' });
    }
});

// --- SECURE SHOP PURCHASE FRAME API ---
app.post('/api/shop/purchase-frame', async (req, res) => {
    const { frameId, purchaseDuration } = req.body;
    if (!frameId || (purchaseDuration !== 'weekly' && purchaseDuration !== 'monthly')) {
        return res.status(400).json({ error: 'Invalid frame purchase parameters' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    let uid;
    try {
        const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
        uid = decoded.uid;
    } catch (e) {
        console.warn('[Shop API] Auth error:', e.message);
        return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
    }

    const verifiedFrame = SERVER_FRAMES.find(f => f.id === String(frameId));
    if (!verifiedFrame || verifiedFrame.weeklyPrice <= 0) {
        return res.status(400).json({ error: 'Invalid or admin-locked frame' });
    }

    const durationDays = purchaseDuration === 'weekly' ? 7 : 30;
    const price = purchaseDuration === 'weekly' ? verifiedFrame.weeklyPrice : verifiedFrame.weeklyPrice * 3;

    try {
        const userRef = db.collection('userProfiles').doc(uid);
        let updatedCoins = 0;
        let newExpiryTime = 0;

        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) throw new Error("User profile not found");
            const data = doc.data();

            const currentCoins = data.coins || 0;
            if (currentCoins < price) {
                throw new Error("Insufficient coins");
            }

            updatedCoins = currentCoins - price;
            const currentOwnedIds = (data.ownedFrameIds || []);
            const newOwnedFrameIds = currentOwnedIds.includes(String(frameId)) ? currentOwnedIds : [...currentOwnedIds, String(frameId)];

            const currentExpiryData = (data.ownedFramesExpiry || {});
            const now = Date.now();
            newExpiryTime = now + (durationDays * 24 * 60 * 60 * 1000);
            if (currentExpiryData[String(frameId)] && currentExpiryData[String(frameId)] > now) {
                newExpiryTime = currentExpiryData[String(frameId)] + (durationDays * 24 * 60 * 60 * 1000);
            }

            t.update(userRef, {
                coins: updatedCoins,
                ownedFrameIds: newOwnedFrameIds,
                [`ownedFramesExpiry.${String(frameId)}`]: newExpiryTime
            });

            const ledgerRef = userRef.collection("coinLedger").doc();
            t.set(ledgerRef, {
                amount: -price,
                type: 'purchased_frame',
                frameId: String(frameId),
                duration: purchaseDuration,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        res.json({ success: true, frameId: String(frameId), coins: updatedCoins, newExpiryTime });
    } catch (error) {
        if (error.message === "Insufficient coins") {
            return res.status(400).json({ error: 'Insufficient coins' });
        }
        console.error('[Shop API] Purchase error:', error.message);
        res.status(500).json({ error: error.message || 'Failed to purchase frame' });
    }
});
const SERVER_RINGS = [
    { id: 'ring_1', price: 4444 },
    { id: 'ring_2', price: 7777 },
    { id: 'ring_3', price: 88888 },
    { id: 'ring_4', price: 111111 },
    { id: 'ring_5', price: 250000 },
    { id: 'ring_6', price: 300000 },
    { id: 'ring_7', price: 500000 }
];

app.post('/api/shop/purchase-ring', async (req, res) => {
    const { ringId } = req.body;
    if (!ringId) return res.status(400).json({ error: 'Invalid ring purchase parameters' });

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    let uid;
    try {
        const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
        uid = decoded.uid;
    } catch (e) {
        return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
    }

    const verifiedRing = SERVER_RINGS.find(r => r.id === String(ringId));
    if (!verifiedRing) return res.status(400).json({ error: 'Invalid ring' });

    const price = verifiedRing.price;

    try {
        const userRef = db.collection('userProfiles').doc(uid);
        let updatedCoins = 0;

        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) throw new Error("User profile not found");
            const data = doc.data();

            const currentCoins = data.coins || 0;
            if (currentCoins < price) throw new Error("Insufficient coins");

            updatedCoins = currentCoins - price;
            const currentOwnedIds = (data.ownedRings || []);
            const newOwnedRings = currentOwnedIds.includes(String(ringId)) ? currentOwnedIds : [...currentOwnedIds, String(ringId)];

            t.update(userRef, {
                coins: updatedCoins,
                ownedRings: newOwnedRings
            });

            const ledgerRef = userRef.collection("coinLedger").doc();
            t.set(ledgerRef, {
                amount: -price,
                type: 'purchased_ring',
                ringId: String(ringId),
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        res.json({ success: true, ringId: String(ringId), coins: updatedCoins });
    } catch (error) {
        if (error.message === "Insufficient coins") return res.status(400).json({ error: 'Insufficient coins' });
        res.status(500).json({ error: error.message || 'Failed to purchase ring' });
    }
});

// --- CP PROPOSAL APIs ---
app.post('/api/cp/send-proposal', async (req, res) => {
    const { ringId, targetUserId } = req.body;
    if (!ringId || !targetUserId) return res.status(400).json({ error: 'Missing parameters' });

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
        const userRef = db.collection('userProfiles').doc(uid);
        const targetRef = db.collection('userProfiles').doc(targetUserId);

        let dmId = [uid, targetUserId].sort().join('_');
        const dmRef = db.collection('directMessages').doc(dmId);

        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) throw new Error("User not found");
            
            const targetDoc = await t.get(targetRef);
            if (!targetDoc.exists) throw new Error("Target user not found");

            // Fix: read dmDoc before doing any updates
            const dmDoc = await t.get(dmRef);

            const data = doc.data();
            const targetData = targetDoc.data();
            
            const currentOwnedRings = data.ownedRings || [];
            if (!currentOwnedRings.includes(String(ringId))) throw new Error("You don't own this ring");

            if (data.cpPartner && data.cpPartner !== targetUserId) {
                throw new Error("First take divorce");
            }

            // Lock ring: remove ONLY ONE copy from inventory
            const ringIndex = currentOwnedRings.indexOf(String(ringId));
            const newOwnedRings = [...currentOwnedRings];
            if (ringIndex > -1) {
                newOwnedRings.splice(ringIndex, 1);
            }
            t.update(userRef, { ownedRings: newOwnedRings });

            // Check if they are already a Couple
            const isAlreadyCP = data.cpPartner === targetUserId;

            if (isAlreadyCP) {
                // Just gift the ring directly without a proposal
                const targetOwnedRings = targetData.ownedRings || [];
                const auraGain = Math.floor((RING_PRICES[String(ringId)] || 0) / 5);
                
                t.update(targetRef, { 
                    ownedRings: [...targetOwnedRings, String(ringId)],
                    aura: admin.firestore.FieldValue.increment(auraGain)
                });
                
                const dmUpdateData = {
                    lastMessageText: '💍 Sent a CP Ring Gift',
                    lastMessageSentAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastMessageSenderId: uid,
                    [`unreadCounts.${targetUserId}`]: admin.firestore.FieldValue.increment(1)
                };
                if (!dmDoc.exists) {
                    t.set(dmRef, {
                        ...dmUpdateData,
                        unreadCounts: { [targetUserId]: 1 },
                        participants: [uid, targetUserId],
                        participantInfo: {
                            [uid]: { username: data.username, photoURL: data.photoURL || null },
                            [targetUserId]: { username: targetData.username, photoURL: targetData.photoURL || null }
                        }
                    });
                } else {
                    t.update(dmRef, dmUpdateData);
                }

                const messageRef = dmRef.collection('messages').doc();
                t.set(messageRef, {
                    senderId: uid,
                    text: 'Sent a CP Ring Gift',
                    type: 'cp_ring_gift',
                    ringId: String(ringId),
                    sentAt: admin.firestore.FieldValue.serverTimestamp(),
                    status: 'accepted'
                });
            } else {
                // Send a CP Proposal
                const dmUpdateData = {
                    lastMessageText: '💍 Sent a CP Proposal',
                    lastMessageSentAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastMessageSenderId: uid,
                    [`unreadCounts.${targetUserId}`]: admin.firestore.FieldValue.increment(1)
                };
                if (!dmDoc.exists) {
                    t.set(dmRef, {
                        ...dmUpdateData,
                        unreadCounts: { [targetUserId]: 1 },
                        participants: [uid, targetUserId],
                        participantInfo: {
                            [uid]: { username: data.username, photoURL: data.photoURL || null },
                            [targetUserId]: { username: targetData.username, photoURL: targetData.photoURL || null }
                        }
                    });
                } else {
                    t.update(dmRef, dmUpdateData);
                }

                // Inject proposal message
                const messageRef = dmRef.collection('messages').doc();
                t.set(messageRef, {
                    senderId: uid,
                    text: 'Sent a CP Proposal',
                    type: 'cp_proposal',
                    ringId: String(ringId),
                    sentAt: admin.firestore.FieldValue.serverTimestamp(),
                    status: 'pending'
                });
            }
        });

        // Notify via socket
        for (const [socketId, userInfo] of socketUserMap.entries()) {
            if (userInfo && userInfo.userId === targetUserId) {
                const targetSocket = io.sockets.sockets.get(socketId);
                if (targetSocket) targetSocket.emit("receive_message", { roomId: dmId });
            }
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to send proposal' });
    }
});

app.post('/api/cp/accept-proposal', async (req, res) => {
    const { messageId, targetUserId } = req.body;
    if (!messageId || !targetUserId) return res.status(400).json({ error: 'Missing parameters' });

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

    let uid;
    try {
        const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
        uid = decoded.uid; // This is the person accepting (the target of the proposal)
    } catch (e) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const dmId = [uid, targetUserId].sort().join('_'); // targetUserId is the sender of proposal
        const dmRef = db.collection('directMessages').doc(dmId);
        const messageRef = dmRef.collection('messages').doc(messageId);
        
        const myRef = db.collection('userProfiles').doc(uid);
        const partnerRef = db.collection('userProfiles').doc(targetUserId);

        await db.runTransaction(async (t) => {
            const msgDoc = await t.get(messageRef);
            if (!msgDoc.exists) throw new Error("Message not found");
            const msgData = msgDoc.data();
            
            if (msgData.type !== 'cp_proposal' || msgData.status !== 'pending') {
                throw new Error("Invalid proposal state");
            }
            if (msgData.senderId !== targetUserId) throw new Error("Invalid sender");

            const myDoc = await t.get(myRef);
            const partnerDoc = await t.get(partnerRef);

            const myData = myDoc.data() || {};
            const partnerData = partnerDoc.data() || {};

            if (myData.cpPartner) throw new Error("You are already married! First take divorce.");
            if (partnerData.cpPartner) throw new Error("This user is already married to someone else!");

            t.update(messageRef, { status: 'accepted' });
            
            const myOwned = myData.ownedRings || [];
            const partnerOwned = partnerData.ownedRings || [];
            
            const newMyOwned = [...myOwned, msgData.ringId];
            const newPartnerOwned = [...partnerOwned, msgData.ringId];
            
            const auraGain = Math.floor((RING_PRICES[String(msgData.ringId)] || 0) / 5);

            t.update(myRef, { cpPartner: targetUserId, cpLevel: 1, cpPoints: 0, marriedAt: admin.firestore.FieldValue.serverTimestamp(), cpLove: 0, cpBlessing: 0, cpBackground: null, cpRingId: msgData.ringId, ownedRings: newMyOwned, aura: admin.firestore.FieldValue.increment(auraGain) });
            t.update(partnerRef, { cpPartner: uid, cpLevel: 1, cpPoints: 0, marriedAt: admin.firestore.FieldValue.serverTimestamp(), cpLove: 0, cpBlessing: 0, cpBackground: null, cpRingId: msgData.ringId, ownedRings: newPartnerOwned });
            
            // Add system message
            const sysMsgRef = dmRef.collection('messages').doc();
            t.set(sysMsgRef, {
                senderId: 'system',
                text: 'Congratulations! You are now a CP!',
                type: 'text',
                sentAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to accept proposal' });
    }
});

app.post('/api/cp/reject-proposal', async (req, res) => {
    const { messageId, targetUserId } = req.body;
    if (!messageId || !targetUserId) return res.status(400).json({ error: 'Missing parameters' });

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
        const dmId = [uid, targetUserId].sort().join('_');
        const dmRef = db.collection('directMessages').doc(dmId);
        const messageRef = dmRef.collection('messages').doc(messageId);
        const partnerRef = db.collection('userProfiles').doc(targetUserId); // The one who sent it

        await db.runTransaction(async (t) => {
            const msgDoc = await t.get(messageRef);
            if (!msgDoc.exists) throw new Error("Message not found");
            const msgData = msgDoc.data();
            
            // Fix: read partnerDoc before doing any updates
            const partnerDoc = await t.get(partnerRef);
            
            if (msgData.type !== 'cp_proposal' || msgData.status !== 'pending') {
                throw new Error("Invalid proposal state");
            }

            t.update(messageRef, { status: 'rejected' });
            
            // Return ring
            if (partnerDoc.exists) {
                const partnerData = partnerDoc.data();
                const ownedRings = partnerData.ownedRings || [];
                t.update(partnerRef, { ownedRings: [...ownedRings, msgData.ringId] });
            }

            const sysMsgRef = dmRef.collection('messages').doc();
            t.set(sysMsgRef, {
                senderId: 'system',
                text: 'Proposal was rejected. Ring has been returned.',
                type: 'text',
                sentAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to reject proposal' });
    }
});

app.post('/api/cp/breakup', async (req, res) => {
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
        const userRef = db.collection('userProfiles').doc(uid);

        await db.runTransaction(async (t) => {
            const userDoc = await t.get(userRef);
            if (!userDoc.exists) throw new Error("User not found");
            const userData = userDoc.data();

            if (!userData.cpPartner) throw new Error("You do not have a partner to break up with.");

            const partnerId = userData.cpPartner;
            const partnerRef = db.collection('userProfiles').doc(partnerId);
            const partnerDoc = await t.get(partnerRef);

            const updateFields = {
                cpPartner: admin.firestore.FieldValue.delete(),
                cpLevel: admin.firestore.FieldValue.delete(),
                cpPoints: admin.firestore.FieldValue.delete(),
                marriedAt: admin.firestore.FieldValue.delete(),
                cpLove: admin.firestore.FieldValue.delete(),
                cpBlessing: admin.firestore.FieldValue.delete(),
                cpBackground: admin.firestore.FieldValue.delete(),
                cpRingId: admin.firestore.FieldValue.delete(),
            };

            t.update(userRef, updateFields);
            
            if (partnerDoc.exists) {
                t.update(partnerRef, updateFields);
            }

            const dmId = [uid, partnerId].sort().join('_');
            const dmRef = db.collection('directMessages').doc(dmId);
            const sysMsgRef = dmRef.collection('messages').doc();
            t.set(sysMsgRef, {
                senderId: 'system',
                text: 'The CP relationship has been ended.',
                type: 'text',
                sentAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to process breakup' });
    }
});

app.post('/api/cp/switch-ring', async (req, res) => {
    const { ringId } = req.body;
    if (!ringId) return res.status(400).json({ error: 'Missing ring ID' });

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
        const userRef = db.collection('userProfiles').doc(uid);
        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) throw new Error("User not found");
            const data = doc.data();
            
            if (!data.cpPartner) throw new Error("You are not in a CP");

            const partnerRef = db.collection('userProfiles').doc(data.cpPartner);
            const partnerDoc = await t.get(partnerRef);
            if (!partnerDoc.exists) throw new Error("Partner not found");
            
            const myOwnedRings = data.ownedRings || [];
            const partnerOwnedRings = partnerDoc.data().ownedRings || [];
            
            if (!myOwnedRings.includes(String(ringId)) && !partnerOwnedRings.includes(String(ringId))) {
                throw new Error("Neither you nor your partner own this ring.");
            }

            t.update(userRef, { cpRingId: ringId });
            t.update(partnerRef, { cpRingId: ringId });
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to switch ring' });
    }
});

app.post('/api/cp/update-background', async (req, res) => {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'Missing image URL' });

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
        const userRef = db.collection('userProfiles').doc(uid);
        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) throw new Error("User not found");
            const data = doc.data();
            
            if (!data.cpPartner) throw new Error("You are not in a CP");

            const partnerRef = db.collection('userProfiles').doc(data.cpPartner);
            t.update(userRef, { cpBackground: imageUrl });
            t.update(partnerRef, { cpBackground: imageUrl });
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to update background' });
    }
});

// --- BFF APIs ---
app.post('/api/bff/send-request', async (req, res) => {
    const { targetUserId } = req.body;
    if (!targetUserId) return res.status(400).json({ error: 'Missing targetUserId' });

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
        const userRef = db.collection('userProfiles').doc(uid);
        const targetRef = db.collection('userProfiles').doc(targetUserId);

        let dmId = [uid, targetUserId].sort().join('_');
        const dmRef = db.collection('directMessages').doc(dmId);

        await db.runTransaction(async (t) => {
            const doc = await t.get(userRef);
            if (!doc.exists) throw new Error("User not found");
            const targetDoc = await t.get(targetRef);
            if (!targetDoc.exists) throw new Error("Target user not found");

            const data = doc.data();
            const targetData = targetDoc.data();

            if (data.bffs && data.bffs.includes(targetUserId)) {
                throw new Error("Already BFFs");
            }

            const dmDoc = await t.get(dmRef);
            const dmUpdateData = {
                lastMessageText: '💖 Sent a BFF Request',
                lastMessageSentAt: admin.firestore.FieldValue.serverTimestamp(),
                lastMessageSenderId: uid,
                [`unreadCounts.${targetUserId}`]: admin.firestore.FieldValue.increment(1)
            };
            if (!dmDoc.exists) {
                t.set(dmRef, {
                    ...dmUpdateData,
                    unreadCounts: { [targetUserId]: 1 },
                    participants: [uid, targetUserId],
                    participantInfo: {
                        [uid]: { username: data.username, photoURL: data.photoURL || null },
                        [targetUserId]: { username: targetData.username, photoURL: targetData.photoURL || null }
                    }
                });
            } else {
                t.update(dmRef, dmUpdateData);
            }

            const messageRef = dmRef.collection('messages').doc();
            t.set(messageRef, {
                senderId: uid,
                text: 'Sent a BFF Request',
                type: 'bff_request',
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'pending'
            });
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to send request' });
    }
});

app.post('/api/bff/accept', async (req, res) => {
    const { messageId, targetUserId } = req.body;
    if (!messageId || !targetUserId) return res.status(400).json({ error: 'Missing parameters' });

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

    let uid;
    try {
        const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
        uid = decoded.uid; // The person accepting the request
    } catch (e) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const dmId = [uid, targetUserId].sort().join('_');
        const dmRef = db.collection('directMessages').doc(dmId);
        const messageRef = dmRef.collection('messages').doc(messageId);
        
        const myRef = db.collection('userProfiles').doc(uid);
        const partnerRef = db.collection('userProfiles').doc(targetUserId);

        await db.runTransaction(async (t) => {
            const msgDoc = await t.get(messageRef);
            if (!msgDoc.exists) throw new Error("Message not found");
            const msgData = msgDoc.data();
            
            if (msgData.type !== 'bff_request' || msgData.status !== 'pending') {
                throw new Error("Invalid request state");
            }
            if (msgData.senderId !== targetUserId) throw new Error("Invalid sender");

            t.update(messageRef, { status: 'accepted' });
            
            t.update(myRef, { bffs: admin.firestore.FieldValue.arrayUnion(targetUserId) });
            t.update(partnerRef, { bffs: admin.firestore.FieldValue.arrayUnion(uid) });
            
            const sysMsgRef = dmRef.collection('messages').doc();
            t.set(sysMsgRef, {
                senderId: 'system',
                text: 'You are now BFFs!',
                type: 'text',
                sentAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to accept request' });
    }
});

app.post('/api/bff/remove', async (req, res) => {
    const { targetUserId } = req.body;
    if (!targetUserId) return res.status(400).json({ error: 'Missing targetUserId' });

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
        const myRef = db.collection('userProfiles').doc(uid);
        const partnerRef = db.collection('userProfiles').doc(targetUserId);

        await db.runTransaction(async (t) => {
            t.update(myRef, { bffs: admin.firestore.FieldValue.arrayRemove(targetUserId) });
            t.update(partnerRef, { bffs: admin.firestore.FieldValue.arrayRemove(uid) });
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to remove BFF' });
    }
});

app.post('/api/bff/make-bestie', async (req, res) => {
    const { targetUserId } = req.body;
    if (!targetUserId) return res.status(400).json({ error: 'Missing targetUserId' });

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
        const myRef = db.collection('userProfiles').doc(uid);
        const partnerRef = db.collection('userProfiles').doc(targetUserId);

        await db.runTransaction(async (t) => {
            t.update(myRef, {
                bffs: admin.firestore.FieldValue.arrayRemove(targetUserId),
                confidants: admin.firestore.FieldValue.arrayRemove(targetUserId),
                besties: admin.firestore.FieldValue.arrayUnion(targetUserId)
            });
            t.update(partnerRef, {
                bffs: admin.firestore.FieldValue.arrayRemove(uid),
                confidants: admin.firestore.FieldValue.arrayRemove(uid),
                besties: admin.firestore.FieldValue.arrayUnion(uid)
            });
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to make bestie' });
    }
});

app.post('/api/bff/make-confidant', async (req, res) => {
    const { targetUserId } = req.body;
    if (!targetUserId) return res.status(400).json({ error: 'Missing targetUserId' });

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
        const myRef = db.collection('userProfiles').doc(uid);
        const partnerRef = db.collection('userProfiles').doc(targetUserId);

        await db.runTransaction(async (t) => {
            t.update(myRef, {
                bffs: admin.firestore.FieldValue.arrayRemove(targetUserId),
                besties: admin.firestore.FieldValue.arrayRemove(targetUserId),
                confidants: admin.firestore.FieldValue.arrayUnion(targetUserId)
            });
            t.update(partnerRef, {
                bffs: admin.firestore.FieldValue.arrayRemove(uid),
                besties: admin.firestore.FieldValue.arrayRemove(uid),
                confidants: admin.firestore.FieldValue.arrayUnion(uid)
            });
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to make confidant' });
    }
});

app.post('/api/bff/make-bff', async (req, res) => {
    const { targetUserId } = req.body;
    if (!targetUserId) return res.status(400).json({ error: 'Missing targetUserId' });

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
        const myRef = db.collection('userProfiles').doc(uid);
        const partnerRef = db.collection('userProfiles').doc(targetUserId);

        await db.runTransaction(async (t) => {
            t.update(myRef, {
                besties: admin.firestore.FieldValue.arrayRemove(targetUserId),
                confidants: admin.firestore.FieldValue.arrayRemove(targetUserId),
                bffs: admin.firestore.FieldValue.arrayUnion(targetUserId)
            });
            t.update(partnerRef, {
                besties: admin.firestore.FieldValue.arrayRemove(uid),
                confidants: admin.firestore.FieldValue.arrayRemove(uid),
                bffs: admin.firestore.FieldValue.arrayUnion(uid)
            });
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to make bff' });
    }
});

app.post('/api/security/report-emulator', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    let uid;
    try {
        const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
        uid = decoded.uid;
    } catch (e) {
        console.warn('[Security API] Auth error on emulator report:', e.message);
        return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
    }

    try {
        console.warn(`🚨 [Security API] Emulator detected for user ${uid}. Executing permanent ban via Admin SDK.`);
        const userRef = db.collection('userProfiles').doc(uid);
        await userRef.update({
            isBanned: true,
            banReason: req.body.reason || "Unauthorized Hardware (Emulator/Root Detected)",
            bannedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Immediately drop any active Socket.IO connections for this cheater!
        for (const [socketId, userInfo] of socketUserMap.entries()) {
            if (userInfo && userInfo.userId === uid) {
                const targetSocket = io.sockets.sockets.get(socketId);
                if (targetSocket) {
                    console.log(`[Security API] Disconnecting socket ${socketId} for banned cheater ${uid}`);
                    targetSocket.disconnect(true);
                }
            }
        }

        res.json({ success: true, message: 'User permanently banned and ejected' });
    } catch (error) {
        console.error('[Security API] Failed to ban emulator user:', error.message);
        res.status(500).json({ error: 'Server error executing ban' });
    }
});

const lobbyTimers = new Map();
const socketUserMap = new Map();
const onlinePlayers = new Map();

const giftQueue = [];
let isProcessingQueue = false;

async function processGiftQueue(ioInstance) {
    if (isProcessingQueue || giftQueue.length === 0) return;
    isProcessingQueue = true;

    while (giftQueue.length > 0) {
        const currentGift = giftQueue.shift(); 
        try {
            await processSingleGiftTransaction(currentGift, ioInstance);
        } catch (error) {
            console.error("Failed to process queued gift transaction:", error);
        }
    }

    isProcessingQueue = false; 
}

async function processSingleGiftTransaction(data, ioInstance) {
    const { senderId, targetId, roomId, price, name, baseGiftId, type, roomType } = data;
    
    const collectionName = roomType || (roomId.startsWith('VR') ? 'voiceSessions' : 'gameSessions');
    const roomRef = db.collection(collectionName).doc(roomId);
    const contribRef = roomRef.collection('contributions').doc(senderId); 
    const senderRef = db.collection("userProfiles").doc(senderId);
    const targetRef = db.collection("userProfiles").doc(targetId);

    let emittedChatId = null;
    let emittedMessageText = '';
    let outSenderName = "Someone";
    let outTargetName = "Someone";
    let outGiftName = name || "Gift";

    await db.runTransaction(async (t) => {
        const senderDoc = await t.get(senderRef);
        const targetDoc = await t.get(targetRef);
        
        const giftInventoryRef = targetRef.collection("receivedGifts").doc(baseGiftId);
        const senderGiftLogRef = giftInventoryRef.collection("senders").doc(senderId);
        const giftInventoryDoc = await t.get(giftInventoryRef);
        const senderGiftLogDoc = await t.get(senderGiftLogRef);
        
        let roomDoc = null;
        let contribDoc = null;
        let familyDoc = null;
        let familyRef = null;
        let senderMemberDoc = null;
        let senderMemberRef = null;
        
        if (collectionName === 'voiceSessions') {
            roomDoc = await t.get(roomRef);
            contribDoc = await t.get(contribRef); 
        } else if (collectionName === 'families') {
            familyRef = db.collection('families').doc(roomId);
            familyDoc = await t.get(familyRef);
            senderMemberRef = familyRef.collection('members').doc(senderId);
            senderMemberDoc = await t.get(senderMemberRef);
        }

        if (!senderDoc.exists || !targetDoc.exists) return;
        outSenderName = senderDoc.data().username || "Someone";
        outTargetName = targetDoc.data().username || "Someone";
        const currentCoins = senderDoc.data().coins || 0;
        const senderData = senderDoc.data();
        
        const isPackageGift = data.isPackageGift === true;
        const requiredPackageQuantity = data.comboCount || 1;
        const currentPackageQuantity = (senderData.packageGifts && senderData.packageGifts[baseGiftId]) || 0;
        
        let isValidTransaction = false;
        let senderUpdates = {};
        
        if (isPackageGift) {
            isValidTransaction = currentPackageQuantity >= requiredPackageQuantity;
            if (isValidTransaction) {
                senderUpdates[`packageGifts.${baseGiftId}`] = admin.firestore.FieldValue.increment(-requiredPackageQuantity);
            }
        } else {
            isValidTransaction = currentCoins >= price;
            if (isValidTransaction) {
                senderUpdates.coins = admin.firestore.FieldValue.increment(-price);
            }
        }
        
        if (isValidTransaction) {
            const auraIncrease = Math.max(1, Math.floor(price / 5));
            const coinsReceived = Math.floor(Math.random() * price) + 1; 

            const xpIncrease = auraIncrease * 20;
            const newXp = (targetDoc.data().xp || 0) + xpIncrease;
            const newLevel = Math.floor(Math.sqrt(newXp / 100)) + 1;

            if (!isPackageGift && senderData.isVip) {
                const growthPtsToAdd = Math.floor(price / 100);
                if (growthPtsToAdd > 0) {
                    const currentPts = senderData.vipGrowthPts || 0;
                    const newPts = currentPts + growthPtsToAdd;
                    const newVipLvl = getVipLevel(newPts);

                    senderUpdates.vipGrowthPts = admin.firestore.FieldValue.increment(growthPtsToAdd);
                    senderUpdates.vipGrowthToday = admin.firestore.FieldValue.increment(growthPtsToAdd);
                    
                    if (newVipLvl !== (senderData.vipLevel || 1)) {
                        senderUpdates.vipLevel = newVipLvl;
                        
                        let periodDays = 30; 
                        if (newVipLvl >= 11) periodDays = 120;
                        else if (newVipLvl >= 9) periodDays = 90;
                        else if (newVipLvl >= 7) periodDays = 75;
                        else if (newVipLvl >= 4) periodDays = 60;
                        else if (newVipLvl === 1) periodDays = 0; 
                        
                        const nextDate = new Date();
                        nextDate.setDate(nextDate.getDate() + periodDays);
                        
                        senderUpdates.relegationPeriodEnd = admin.firestore.Timestamp.fromDate(nextDate);
                        senderUpdates.relegationPtsAccumulated = 0; 
                    } else {
                        senderUpdates.relegationPtsAccumulated = admin.firestore.FieldValue.increment(growthPtsToAdd);
                    }
                }
            }
            
            let targetUpdates = { 
                textAura: admin.firestore.FieldValue.increment(auraIncrease), 
                aura: admin.firestore.FieldValue.increment(auraIncrease), 
                auraToday: admin.firestore.FieldValue.increment(auraIncrease), 
                coins: admin.firestore.FieldValue.increment(coinsReceived), 
                xp: newXp, 
                level: newLevel 
            };

            const targetData = targetDoc.data();
            let isCoupleGift = false;
            let isBlessingGift = false;

            if (targetData.cpPartner) {
                const points = Math.floor(price / 5);
                if (targetData.cpPartner === senderId) {
                    targetUpdates.cpLove = admin.firestore.FieldValue.increment(points);
                    senderUpdates.cpLove = admin.firestore.FieldValue.increment(points);
                    isCoupleGift = true;
                } else {
                    targetUpdates.cpBlessing = admin.firestore.FieldValue.increment(points);
                    const partnerRef = db.collection("userProfiles").doc(targetData.cpPartner);
                    t.update(partnerRef, { cpBlessing: admin.firestore.FieldValue.increment(points) });
                    isBlessingGift = true;
                }
            }
            
            if (senderId === targetId) {
                const netCoins = isPackageGift ? coinsReceived : (coinsReceived - price);
                const mergedUpdates = { 
                    ...senderUpdates, 
                    ...targetUpdates, 
                    coins: admin.firestore.FieldValue.increment(netCoins) 
                };
                t.update(senderRef, mergedUpdates);
            } else {
                t.update(senderRef, senderUpdates);
                t.update(targetRef, targetUpdates);
            }

            if (isCoupleGift || isBlessingGift) {
                const coupleId = [targetId, targetData.cpPartner].sort().join('_');
                const coupleGiftLogRef = db.collection('coupleGifts').doc(coupleId).collection('logs').doc();
                const points = Math.floor(price / 5);
                t.set(coupleGiftLogRef, {
                    senderId,
                    senderName: senderData.username || 'Unknown',
                    targetId,
                    giftId: baseGiftId,
                    giftName: name,
                    price,
                    pointsGiven: points,
                    type: isCoupleGift ? 'love' : 'blessing',
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            const globalGiftLogRef = db.collection("giftTransactions").doc();
            t.set(globalGiftLogRef, {
                senderId,
                targetId,
                roomId,
                giftId: baseGiftId,
                giftName: name,
                pricePaid: price,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            if (!isPackageGift) {
                const senderCoinLedgerRef = senderRef.collection("coinLedger").doc();
                t.set(senderCoinLedgerRef, {
                    amount: -price,
                    type: 'sent_gift',
                    giftName: name,
                    targetUserId: targetId,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            const receiverCoinLedgerRef = targetRef.collection("coinLedger").doc();
            t.set(receiverCoinLedgerRef, { amount: coinsReceived, type: 'received_gift', giftName: name, senderUserId: senderId, timestamp: admin.firestore.FieldValue.serverTimestamp() });

            const receiverAuraLedgerRef = targetRef.collection("auraLedger").doc();
            t.set(receiverAuraLedgerRef, { amount: auraIncrease, type: 'received_gift', giftName: name, senderUserId: senderId, timestamp: admin.firestore.FieldValue.serverTimestamp() });

            const currentSenderCount = senderGiftLogDoc.exists ? (senderGiftLogDoc.data().count || 0) : 0;
            const newSenderCount = currentSenderCount + 1;
            t.set(senderGiftLogRef, { count: newSenderCount, lastSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

            const currentTopSenderCount = giftInventoryDoc.exists ? (giftInventoryDoc.data().topSenderCount || 0) : 0;
            
            let inventoryUpdates = {
                name: name,
                count: admin.firestore.FieldValue.increment(1),
                totalCoinsGenerated: admin.firestore.FieldValue.increment(coinsReceived),
                totalAuraGenerated: admin.firestore.FieldValue.increment(auraIncrease),
                lastReceivedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            if (newSenderCount > currentTopSenderCount) {
                inventoryUpdates.topSenderId = senderId;
                inventoryUpdates.topSenderAvatar = senderDoc.data().photoURL || null;
                inventoryUpdates.topSenderCount = newSenderCount;
            }

            t.set(giftInventoryRef, inventoryUpdates, { merge: true });

            const supporterRef = targetRef.collection("supporters").doc(senderId);
            t.set(supporterRef, {
                senderId: senderId,
                senderName: senderDoc.data().username || "Someone",
                senderPhotoURL: senderDoc.data().photoURL || null,
                totalAuraGiven: admin.firestore.FieldValue.increment(auraIncrease),
                totalCoinsGiven: admin.firestore.FieldValue.increment(coinsReceived),
                totalGiftsSent: admin.firestore.FieldValue.increment(1),
                lastGiftAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            const senderName = senderDoc.data().username || "Someone";
            const targetName = targetDoc.data().username || "Someone";
            const giftName = name || "Gift";
            const isQuickGift = type === 'egg' || type === 'flower';

            let messageText = '';
            if (isQuickGift) {
                messageText = `🎁 ${senderName}: Send ${targetName} 1 ${giftName}, You are really awesome! (${targetName} gained +${auraIncrease} Aura and +${coinsReceived} Coins)`;
            } else {
                messageText = `🔔 ${senderName} gifted ${targetName} a "${giftName}". ${targetName} gained +${auraIncrease} Aura and +${coinsReceived} Coins.`;
            }

            const subcollName = collectionName === 'families' ? 'messages' : 'chatMessages';
            const chatRef = db.collection(collectionName).doc(roomId).collection(subcollName).doc();
            t.set(chatRef, { 
                gameSessionId: roomId, 
                senderUserId: 'system', 
                messageText: messageText, 
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                createdAt: admin.firestore.FieldValue.serverTimestamp() // Family chat uses createdAt
            });
            emittedChatId = chatRef.id;
            emittedMessageText = messageText;

            if (collectionName === 'families' && senderMemberDoc && senderMemberDoc.exists) {
                const memberData = senderMemberDoc.data();
                const today = new Date().toISOString().split('T')[0];
                let dailyTasks = memberData.dailyTasks || { date: today, progress: {}, claimed: [] };
                if (dailyTasks.date !== today) dailyTasks = { date: today, progress: {}, claimed: [] };
                if (!dailyTasks.progress) dailyTasks.progress = {};
                
                dailyTasks.progress.sendGifts = (dailyTasks.progress.sendGifts || 0) + 1;
                dailyTasks.progress.loveFamily = (dailyTasks.progress.loveFamily || 0) + price;
                
                t.update(senderMemberRef, { dailyTasks });
            }

            if (collectionName === 'voiceSessions' && roomDoc && roomDoc.exists) {
                const roomData = roomDoc.data();
                
                const todayStr = new Date().toISOString().split('T')[0];
                const d = new Date();
                d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
                const weekNo = Math.ceil((((d - new Date(Date.UTC(d.getUTCFullYear(),0,1))) / 86400000) + 1)/7);
                const weekStr = `${d.getUTCFullYear()}-W${weekNo}`;

                const currentTotalExp = roomData.exp || 0;
                const currentDailyExp = roomData.dailyDate === todayStr ? (roomData.dailyExp || 0) : 0;
                
                const roomExpToAdd = Math.floor(price / 10);
                
                if (roomExpToAdd > 0) {
                    const newTotalExp = currentTotalExp + roomExpToAdd;
                    t.update(roomRef, {
                        exp: newTotalExp,
                        level: getRoomLevel(newTotalExp),
                        dailyExp: currentDailyExp + roomExpToAdd,
                        dailyDate: todayStr,
                        expToday: admin.firestore.FieldValue.increment(roomExpToAdd)
                    });
                }

                let dailyGold = 0, weeklyGold = 0, totalGold = 0;
                if (contribDoc && contribDoc.exists) {
                    const cData = contribDoc.data();
                    totalGold = cData.totalGold || 0;
                    dailyGold = cData.dailyDate === todayStr ? (cData.dailyGold || 0) : 0;
                    weeklyGold = cData.weeklyDate === weekStr ? (cData.weeklyGold || 0) : 0;
                }

                t.set(contribRef, {
                    userId: senderId,
                    username: senderName,
                    photoURL: senderDoc.data().photoURL || null,
                    totalGold: totalGold + price,
                    dailyGold: dailyGold + price,
                    weeklyGold: weeklyGold + price,
                    dailyDate: todayStr,
                    weeklyDate: weekStr,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                if (roomData.pkState && roomData.pkState.status === 'playing' && roomData.pkState.rule === 'gifts') {
                    const targetSeatStr = Object.keys(roomData.players || {}).find(k => roomData.players[k].id === targetId);
                    
                    if (targetSeatStr) {
                        const s = parseInt(targetSeatStr);
                        const numMics = roomData.numMics || 9;
                        let team = null;
                        
                        if (roomData.pkState.mode === '1v1') {
                            if (numMics === 13) { team = (s === 9) ? 'red' : ((s === 12) ? 'blue' : null); } 
                            else { team = (s === 5) ? 'red' : ((s === 8) ? 'blue' : null); }
                        } else {
                            if (numMics === 13) { team = [1, 2, 5, 6, 9, 10].includes(s) ? 'red' : ([3, 4, 7, 8, 11, 12].includes(s) ? 'blue' : null); } 
                            else { team = [1, 2, 5, 6].includes(s) ? 'red' : ([3, 4, 7, 8].includes(s) ? 'blue' : null); }
                        }

                        if (team === 'red') {
                            t.update(roomRef, { 'pkState.redScore': admin.firestore.FieldValue.increment(auraIncrease) });
                            ioInstance.to(roomId).emit("voice_room_update", { type: 'PK_SCORE', team: 'red', amount: auraIncrease });
                        } else if (team === 'blue') {
                            t.update(roomRef, { 'pkState.blueScore': admin.firestore.FieldValue.increment(auraIncrease) });
                            ioInstance.to(roomId).emit("voice_room_update", { type: 'PK_SCORE', team: 'blue', amount: auraIncrease });
                        }

                        // Track individual PK score and unlock gift if >= 100,000
                        const currentIndividualScore = (roomData.pkState.playerScores && roomData.pkState.playerScores[targetId]) || 0;
                        const newIndividualScore = currentIndividualScore + auraIncrease;
                        
                        t.update(roomRef, { [`pkState.playerScores.${targetId}`]: admin.firestore.FieldValue.increment(auraIncrease) });
                        
                        if (currentIndividualScore < 100000 && newIndividualScore >= 100000) {
                            const unlockDuration = 3 * 24 * 60 * 60 * 1000; // 3 days
                            t.set(targetRef, { 
                                pkGiftUnlockedUntil: Date.now() + unlockDuration,
                                titles: { pk_champ: Date.now() + unlockDuration }
                            }, { merge: true });

                            // Trigger global notification for PK Unlock
                            ioInstance.emit('global_gift_alert', {
                                id: `PK_UNLK_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                isPkUnlock: true,
                                receiverName: targetData.username || "Someone",
                                receiverDisplayId: targetData.displayId || targetId,
                                roomId: roomId
                            });
                        }
                    }
                }
            }

            if (collectionName === 'families' && familyDoc && familyDoc.exists) {
                const todayStr = new Date().toISOString().split('T')[0];
                const senderRole = senderData.familyRole || 'member';
                let maxLimit = 10000;
                if (senderRole === 'leader') maxLimit = 30000;
                else if (senderRole === 'deputy') maxLimit = 20000;
                else if (senderRole === 'admin') maxLimit = 15000;

                let currentDaily = 0;
                if (senderMemberDoc && senderMemberDoc.exists) {
                    const memberData = senderMemberDoc.data();
                    if (memberData.dailyGiftActivenessDate === todayStr) {
                        currentDaily = memberData.dailyGiftActiveness || 0;
                    }
                }

                // Every 10 Gold's worth of gift gives 1 Activeness. Gifts worth less than 10 Gold do not.
                const requestedActiveness = Math.floor(price / 10);
                if (requestedActiveness > 0) {
                    let activenessToAdd = requestedActiveness;
                    if (currentDaily + activenessToAdd > maxLimit) {
                        activenessToAdd = maxLimit - currentDaily;
                    }

                    if (activenessToAdd > 0) {
                        t.update(familyRef, {
                            activeness: admin.firestore.FieldValue.increment(activenessToAdd),
                            weeklyActiveness: admin.firestore.FieldValue.increment(activenessToAdd),
                        });
                        
                        if (senderMemberRef && senderMemberDoc.exists) {
                            t.update(senderMemberRef, {
                                weeklyActiveness: admin.firestore.FieldValue.increment(activenessToAdd),
                                totalActiveness: admin.firestore.FieldValue.increment(activenessToAdd),
                                dailyGiftActiveness: currentDaily + activenessToAdd,
                                dailyGiftActivenessDate: todayStr
                            });
                        }
                    }
                }
            }
        }
    });

    if (emittedChatId) {
        // Transaction succeeded — broadcast the confirmed gift to the room
        const { _socketId, ...broadcastData } = data;
        ioInstance.to(roomId).emit("receive_gift", broadcastData);

        if (roomService) {
            try {
                const giftPayload = new TextEncoder().encode(JSON.stringify({ type: 'GIFT', payload: broadcastData }));
                roomService.sendData(roomId, giftPayload, 1, []).catch(e => console.error(e));
            } catch (e) { console.error("LiveKit Gift Broadcast Error:", e); }
        }

        const msgPayload = {
            id: emittedChatId,
            senderUserId: 'system',
            messageText: emittedMessageText,
            sentAt: Date.now(),
            isSystem: true
        };
        try {
            const encoded = new TextEncoder().encode(JSON.stringify({ type: 'CHAT_MESSAGE', payload: msgPayload }));
            roomService.sendData(roomId, encoded, 1);
        } catch(e) { console.error("LiveKit System Broadcast Error:", e); }

        if (price >= 60000) {
            ioInstance.emit('global_gift_alert', {
                id: `GIFT_ALERT_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                amount: price,
                senderName: outSenderName,
                receiverName: outTargetName,
                giftName: outGiftName,
                roomId: roomId
            });
        }
    } else if (data._socketId) {
        // Transaction failed (insufficient coins) — notify the sender
        ioInstance.to(data._socketId).emit("error_message", { message: "Gift failed: insufficient coins." });
    }
}

function clearLobbyTimer(roomId) {
    if (lobbyTimers.has(roomId)) {
        clearTimeout(lobbyTimers.get(roomId));
        lobbyTimers.delete(roomId);
    }
}

async function processToggleReady(roomCode, userId, isReady, io, db, admin) {
    io.to(roomCode).emit("player_ready_changed", { userId, isReady });

    try {
        const gameSessionRef = db.collection("gameSessions").doc(roomCode);
        let gameToStartRef = null;

        await db.runTransaction(async (transaction) => {
            const sessionDoc = await transaction.get(gameSessionRef);
            if (!sessionDoc.exists) return;

            const sessionData = sessionDoc.data();
            if (sessionData.status !== "pending") return;

            const currentPlayersMap = sessionData.players || {};
            const readyPlayers = sessionData.readyPlayers || [];
            const seatedPlayerIds = sessionData.seatedPlayerUserIds || [];

            const seatIndex = Object.keys(currentPlayersMap).find((key) => currentPlayersMap[key]?.id === userId);
            if (seatIndex === undefined) return;

            const newReadyList = isReady
                ? [...new Set([...readyPlayers, userId])]
                : readyPlayers.filter((id) => id !== userId);

            const isRoomFull = seatedPlayerIds.length === sessionData.maxPlayers;
            const isEveryoneReady = newReadyList.length === sessionData.maxPlayers;

            if (isRoomFull && isEveryoneReady) {
                clearLobbyTimer(roomCode);

                const newGameNumber = (sessionData.currentGameNumber || 0) + 1;
                const newGameDocRef = gameSessionRef.collection("games").doc(String(newGameNumber));

                const sessionUpdateData = {
                    status: "playing",
                    currentGameNumber: newGameNumber,
                    readyPlayers: [], 
                    isServerRallyActive: false,
                    rallyStartedAt: admin.firestore.FieldValue.delete()
                };

                Object.keys(currentPlayersMap).forEach((idx) => {
                    if (currentPlayersMap[idx]) {
                        sessionUpdateData[`players.${idx}.ready`] = false;
                    }
                });

                const cats = ["Other", "Sports", "City/Building", "Animals/Plants/Nature", "Life", "Food", "Character/Profession", "Random"];
                const shuffled = cats.sort(() => 0.5 - Math.random());

                const newGameData = {
                    gameNumber: newGameNumber,
                    status: "starting", 
                    participants: seatedPlayerIds,
                    eliminatedPlayerIds: [],
                    categoryVotes: {},
                    gameData: null,
                    currentRoundNumber: 1,
                    votes: {},
                    pkPlayers: [],
                    rounds: {},
                    votingCategories: shuffled.slice(0, 6)
                };

                transaction.update(gameSessionRef, sessionUpdateData);
                transaction.set(newGameDocRef, newGameData);
                
                gameToStartRef = newGameDocRef;
                
            } else {
                transaction.update(gameSessionRef, {
                    [`players.${seatIndex}.ready`]: isReady,
                    readyPlayers: newReadyList,
                });
            }
        });

        if (gameToStartRef) {
            await gameToStartRef.update({
                status: 'voting',
                categoryVotingStartsAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (error) { 
        console.error("Error toggling ready state:", error);
    }
}

// --- SOCKET.IO FIREBASE AUTHENTICATION MIDDLEWARE ---
io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    if (token) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(token);
            socket.user = { uid: decodedToken.uid };
        } catch (err) {
            console.warn(`[Socket Auth] Invalid token from socket ${socket.id}:`, err.message);
            socket.user = null;
        }
    } else {
        socket.user = null;
    }
    next();
});

function verifySocketIdentity(socket, targetUserId) {
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
    if (!socket.user && !socket.userId) {
        socket.userId = targetUserId;
        return true;
    }
    return false;
}

io.on("connection", (socket) => {
  console.log("🟢 A player connected: ", socket.id);

  socket.on("authenticate", async (token) => {
      try {
          const decodedToken = await admin.auth().verifyIdToken(token);
          socket.user = { uid: decodedToken.uid };
          socket.userId = decodedToken.uid;
          onlinePlayers.set(decodedToken.uid, socket.id);
          db.collection("userProfiles").doc(decodedToken.uid).update({
              isOnline: true,
              lastActive: admin.firestore.FieldValue.serverTimestamp()
          }).catch(() => {});
      } catch (err) {}
  });

  socket.on("register_online", async (data) => {
      const userId = typeof data === 'object' ? data.userId : data;
      if (!userId) return;
      if (socket.user && socket.user.uid && socket.user.uid !== userId) return;
      socket.userId = userId;
      onlinePlayers.set(userId, socket.id);
      db.collection("userProfiles").doc(userId).update({
          isOnline: true,
          lastActive: admin.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});
  });
  socket.on("leave_room", (roomCode) => {
      socket.leave(roomCode);
  });

  socket.on("join_room", async (data) => {
    const roomCode = typeof data === 'object' ? data.roomCode : data;
    let userId = typeof data === 'object' ? data.userId : null;
    
    // 🛑 STRICT SECURITY: If socket is authenticated via Firebase ID token, strictly enforce their real UID
    if (socket.user && socket.user.uid) {
        userId = socket.user.uid;
    }
    
    socket.join(roomCode);

    if (userId) {
        socket.userId = userId;
        onlinePlayers.set(userId, socket.id);
        socketUserMap.set(socket.id, { userId, roomId: roomCode });
        db.collection("userProfiles").doc(userId).update({
            isOnline: true,
            lastActive: admin.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
        
        try {
            const sessionRef = db.collection("gameSessions").doc(roomCode);
            await db.runTransaction(async (t) => {
                const doc = await t.get(sessionRef);
                if (!doc.exists) return;
                const players = doc.data().players || {};
                const seatIndex = Object.keys(players).find(k => players[k]?.id === userId);
                if (seatIndex && players[seatIndex].offline) {
                    t.update(sessionRef, { [`players.${seatIndex}.offline`]: admin.firestore.FieldValue.delete() });
                }
            });
        } catch (e) {}
    }
  });

  socket.on("voice_music_state", (data) => {
      io.to(data.roomId).emit("voice_music_state_update", data);
  });

  socket.on("disconnect", async () => {
    console.log("🔴 A player disconnected: ", socket.id);
    
    const offlineUserId = socket.userId || socket.user?.uid || socketUserMap.get(socket.id)?.userId;
    if (offlineUserId && onlinePlayers.get(offlineUserId) === socket.id) {
        onlinePlayers.delete(offlineUserId);
        db.collection("userProfiles").doc(offlineUserId).update({
            isOnline: false,
            lastActive: admin.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
    }

    const userInfo = socketUserMap.get(socket.id);
    if (userInfo) {
        const { userId, roomId } = userInfo;
        socketUserMap.delete(socket.id);
        
        if (roomId.startsWith('VR')) {
            return;
        }

        try {
            const sessionRef = db.collection("gameSessions").doc(roomId);
            await db.runTransaction(async (t) => {
                const doc = await t.get(sessionRef);
                if (!doc.exists) return;
                const d = doc.data();
                
                if (d.status === 'playing') {
                    const players = d.players || {};
                    const seatIndex = Object.keys(players).find(k => players[k]?.id === userId);
                    if (seatIndex && !players[seatIndex].quit) {
                        t.update(sessionRef, { [`players.${seatIndex}.offline`]: true });
                    }
                } else if (d.status === 'pending') {
                    const userWasSeated = (d.seatedPlayerUserIds || []).includes(userId);
                    const players = d.players || {};
                    const seatIndex = Object.keys(players).find(k => players[k]?.id === userId);
                    const updates = {
                        playerUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                        seatedPlayerUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                        readyPlayers: admin.firestore.FieldValue.arrayRemove(userId)
                    };
                    if (userWasSeated) {
                        updates.emptySeats = admin.firestore.FieldValue.increment(1);
                        if (seatIndex !== undefined && seatIndex !== null) {
                            updates[`players.${seatIndex}`] = admin.firestore.FieldValue.delete();
                        }
                    }
                    t.update(sessionRef, updates);
                }
            });

            const sessionDoc = await db.collection("gameSessions").doc(roomId).get();
            const d = sessionDoc.data();
            if (d && d.status === 'playing') {
                const gameRef = db.collection("gameSessions").doc(roomId).collection("games").doc(String(d.currentGameNumber));
                const gameDoc = await gameRef.get();
                if (gameDoc.exists) {
                    const gData = gameDoc.data();
                    const currentSpeakerId = gData.turnOrder?.[gData.currentPlayerIndex || 0];
                    if (currentSpeakerId === userId && (gData.status === 'describing' || gData.status === 'pk_describing')) {
                        await gameRef.update({
                            skipTurnOf: userId,
                            skipTimestamp: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }
                }
            } else if (d && d.status === 'pending') {
                checkAndEvacuateBots(roomId, io, db, admin);
            }
        } catch(e) {}
    }
  });

  socket.on("start_lobby_timer", (roomId) => {
      if (lobbyTimers.has(roomId)) return; 
      const timerId = setTimeout(async () => {
          lobbyTimers.delete(roomId); 
          try {
              const gameSessionRef = db.collection("gameSessions").doc(roomId);
              await db.runTransaction(async (transaction) => {
                  const sessionDoc = await transaction.get(gameSessionRef);
                  if (!sessionDoc.exists) return;
                  const sessionData = sessionDoc.data();
                  
                  if (sessionData.status !== "pending") return;
                  const seatedPlayerIds = sessionData.seatedPlayerUserIds || [];
                  if (seatedPlayerIds.length !== sessionData.maxPlayers) return;

                  const playersMap = sessionData.players || {};
                  const updates = {};
                  const kickedPlayerIds = [];

                  Object.keys(playersMap).forEach(seatIndex => {
                      const player = playersMap[seatIndex];
                      if (player && player.ready === false) {
                          updates[`players.${seatIndex}`] = admin.firestore.FieldValue.delete();
                          kickedPlayerIds.push(player.id);
                          io.to(roomId).emit("room_update_received", { type: 'LIFT_UP', seatIndex: parseInt(seatIndex), userId: player.id });
                      }
                  });

                  if (kickedPlayerIds.length > 0) {
                      updates.seatedPlayerUserIds = admin.firestore.FieldValue.arrayRemove(...kickedPlayerIds);
                      updates.readyPlayers = admin.firestore.FieldValue.arrayRemove(...kickedPlayerIds);
                      updates.emptySeats = admin.firestore.FieldValue.increment(kickedPlayerIds.length);
                      
                      transaction.update(gameSessionRef, updates);
                      
                      const chatRef = gameSessionRef.collection('chatMessages').doc();
                      transaction.set(chatRef, {
                          gameSessionId: roomId,
                          senderUserId: 'system',
                          messageText: `🔔 Time's up! Unready players were moved to spectate.`,
                          sentAt: admin.firestore.FieldValue.serverTimestamp()
                      });
                  }
              });
              
              // Trigger bot evacuation if all real players were moved to spectate
              checkAndEvacuateBots(roomId, io, db, admin);
          } catch (error) { }
      }, 15000); 
      lobbyTimers.set(roomId, timerId);
  });

  socket.on("cancel_lobby_timer", async (roomId) => {
      try {
          const doc = await db.collection("gameSessions").doc(roomId).get();
          if (doc.exists) {
              const d = doc.data();
              if (d.status === 'pending' && (d.seatedPlayerUserIds || []).length === d.maxPlayers) return; 
          }
          clearLobbyTimer(roomId);
      } catch (err) { clearLobbyTimer(roomId); }
  });

  socket.on("activate_server_rally", async (data, callback) => {
      const { roomId, userId } = data;
      if (!verifySocketIdentity(socket, userId)) {
          console.error(`Blocked unauthorized activate_server_rally attempt by ${socket.user?.uid || 'unauth'}`);
          if (callback) callback({ success: false, error: 'Unauthorized' });
          return;
      }
      try {
          const result = await db.runTransaction(async (t) => {
              const sessionRef = db.collection('gameSessions').doc(roomId);
              const userRef = db.collection('userProfiles').doc(userId);

              const [sessionDoc, userDoc] = await Promise.all([t.get(sessionRef), t.get(userRef)]);

              if (!sessionDoc.exists || !userDoc.exists) return { success: false, error: 'Not found' };
              
              const sessionData = sessionDoc.data();
              const userData = userDoc.data();

              if (!(sessionData.playerUserIds || []).includes(userId)) return { success: false, error: 'You must be in the room to activate rally.' };
              if (sessionData.isServerRallyActive) return { success: false, error: 'Rally already active.' };
              if ((userData.coins || 0) < 50) return { success: false, error: 'Insufficient coins. 50 required.' };

              t.update(userRef, { coins: admin.firestore.FieldValue.increment(-50) });
              t.update(sessionRef, { isServerRallyActive: true, rallyStartedAt: admin.firestore.FieldValue.serverTimestamp() });

              const chatRef = sessionRef.collection('chatMessages').doc();
              t.set(chatRef, { gameSessionId: roomId, senderUserId: 'system', messageText: `🔔 ${userData.username} activated Server Rally! Searching for players...`, sentAt: admin.firestore.FieldValue.serverTimestamp() });

              return { success: true };
          });

          if (result.success) {
              io.to(roomId).emit("room_update_received", { type: 'RALLY_ACTIVATED' });
              setTimeout(async () => {
                  try {
                      const sessionRef = db.collection('gameSessions').doc(roomId);
                      await db.runTransaction(async (t) => {
                          const doc = await t.get(sessionRef);
                          if (doc.exists && doc.data().isServerRallyActive && doc.data().status === 'pending') {
                              t.update(sessionRef, { isServerRallyActive: false });
                              const chatRef = sessionRef.collection('chatMessages').doc();
                              t.set(chatRef, { gameSessionId: roomId, senderUserId: 'system', messageText: `🔔 Server Rally has expired.`, sentAt: admin.firestore.FieldValue.serverTimestamp() });
                          }
                      });
                  } catch (e) { }
              }, 5 * 60 * 1000);
          }

          if (callback) callback(result);
      } catch (error) { if (callback) callback({ success: false, error: 'Transaction failed' }); }
  });

  socket.on("request_auto_match", async (data, callback) => {
      const { gameMode, userId, username, photoURL } = data;
      if (!verifySocketIdentity(socket, userId)) {
          console.error(`Blocked unauthorized request_auto_match attempt by ${socket.user?.uid || 'unauth'}`);
          if (callback) callback({ success: false, error: 'Unauthorized' });
          return;
      }
      try {
          const sessionsRef = db.collection('gameSessions');
          let bestRoomDoc = null;

          const rallySnapshot = await sessionsRef
              .where('status', '==', 'pending')
              .where('gameMode', '==', gameMode)
              .where('isServerRallyActive', '==', true)
              .where('emptySeats', '>', 0)
              .orderBy('emptySeats', 'asc')
              .limit(10)
              .get();

          if (!rallySnapshot.empty) bestRoomDoc = rallySnapshot.docs.find(doc => !doc.data().password);

          if (!bestRoomDoc) {
              const normalSnapshot = await sessionsRef
                  .where('status', '==', 'pending')
                  .where('gameMode', '==', gameMode)
                  .where('emptySeats', '>', 0)
                  .orderBy('emptySeats', 'asc')
                  .limit(10)
                  .get();

              if (!normalSnapshot.empty) bestRoomDoc = normalSnapshot.docs.find(doc => !doc.data().password);
          }

          if (bestRoomDoc) {
              const roomId = bestRoomDoc.id;
              const playerInfo = { id: userId, username, photoURL, ready: false };

              const result = await db.runTransaction(async (t) => {
                  const doc = await t.get(sessionsRef.doc(roomId));
                  if (!doc.exists) return { success: false };
                  const d = doc.data();
                  const currentPlayers = d.players || {};
                  const seatedIds = d.seatedPlayerUserIds || [];

                  if (seatedIds.includes(userId)) {
                      const existingSeat = Object.keys(currentPlayers).find(key => currentPlayers[key]?.id === userId);
                      return { success: true, seatIndex: existingSeat };
                  }
                  
                  let targetSeat = null;
                  for (let i = 0; i < d.maxPlayers; i++) {
                      if (!currentPlayers[i]) { targetSeat = i; break; }
                  }

                  if (targetSeat === null) return { success: false }; 

                  t.update(sessionsRef.doc(roomId), {
                      [`players.${targetSeat}`]: playerInfo,
                      seatedPlayerUserIds: admin.firestore.FieldValue.arrayUnion(userId),
                      playerUserIds: admin.firestore.FieldValue.arrayUnion(userId),
                      emptySeats: admin.firestore.FieldValue.increment(-1)
                  });
                  return { success: true, seatIndex: targetSeat };
              });

              if (result.success) {
                  if (roomService) {
                      try {
                          let existingMeta = "";
                          try {
                              const p = await roomService.getParticipant(roomId, userId);
                              if (p) existingMeta = p.metadata;
                          } catch (e) {}
                          await roomService.updateParticipant(roomId, userId, existingMeta, { canPublish: true, canSubscribe: true, canPublishData: true });
                      } catch (e) { console.error("LiveKit un-mute failed:", e); }
                  }
                  io.to(roomId).emit("room_update_received", { type: 'TAKE_SEAT', seatIndex: result.seatIndex, player: playerInfo, userId });
                  scheduleBotJoin(roomId, io, db, admin, processToggleReady); 
                  if (callback) callback({ success: true, roomId: roomId });
                  return;
              }
          }

          const newRoomId = 'IF' + Math.floor(1000000 + Math.random() * 9000000);
          const newRoomRef = db.collection('gameSessions').doc(newRoomId);

          await newRoomRef.set({
              id: newRoomId, status: 'pending', gameMode: gameMode, password: null, maxPlayers: 6, emptySeats: 5, playerUserIds: [userId], seatedPlayerUserIds: [userId], readyPlayers: [], isServerRallyActive: false,
              players: { '0': { id: userId, username, photoURL, ready: false } },
              hostUserId: userId, createdAt: admin.firestore.FieldValue.serverTimestamp()
          });

          scheduleBotJoin(newRoomId, io, db, admin, processToggleReady);

          if (callback) callback({ success: true, roomId: newRoomId });
      } catch (error) {
          console.error("request_auto_match error:", error);
          if (callback) callback({ success: false, error: error.message || 'Matchmaking failed' });
      }
  });

  socket.on("action_take_seat", async (data, callback) => {
      let { roomId, seatIndex, player, userId } = data;
      if (!verifySocketIdentity(socket, userId)) {
          console.error(`Blocked unauthorized action_take_seat attempt by ${socket.user?.uid || 'unauth'}`);
          if (callback) callback({ success: false, error: 'Unauthorized' });
          return;
      }
      try {
          const sessionRef = db.collection("gameSessions").doc(roomId);
          const result = await db.runTransaction(async (t) => {
              const doc = await t.get(sessionRef);
              if (!doc.exists) return { success: false, error: 'Room not found' };
              const d = doc.data();

              if (d.status !== 'pending') return { success: false, error: 'Game is running' };

              const currentPlayers = d.players || {};
              const seatedIds = d.seatedPlayerUserIds || [];

              if (seatedIds.includes(userId)) {
                  const existingSeat = Object.keys(currentPlayers).find(key => currentPlayers[key]?.id === userId);
                  return { success: true, seatIndex: existingSeat };
              }
              
              let targetSeat = seatIndex;
              if (targetSeat === null || targetSeat === undefined) {
                  for (let i = 0; i < d.maxPlayers; i++) {
                      if (!currentPlayers[i]) { targetSeat = i; break; }
                  }
              }

              if (targetSeat === null || targetSeat === undefined) return { success: false, error: 'Room full' };
              if (currentPlayers[targetSeat]) return { success: false, error: 'Seat taken' };
              
              t.update(sessionRef, {
                  [`players.${targetSeat}`]: player,
                  seatedPlayerUserIds: admin.firestore.FieldValue.arrayUnion(userId),
                  playerUserIds: admin.firestore.FieldValue.arrayUnion(userId), 
                  emptySeats: admin.firestore.FieldValue.increment(-1)
              });

              io.to(roomId).emit("room_update_received", { type: 'TAKE_SEAT', seatIndex: targetSeat, player, userId });

              scheduleBotJoin(roomId, io, db, admin, processToggleReady);

              return { success: true, seatIndex: targetSeat };
          });
          if (result && result.success && roomService) {
              try {
                  let existingMeta = "";
                  try {
                      const p = await roomService.getParticipant(roomId, userId);
                      if (p) existingMeta = p.metadata;
                  } catch (e) {}
                  await roomService.updateParticipant(roomId, userId, existingMeta, { canPublish: true, canSubscribe: true, canPublishData: true });
              } catch (e) { console.error("LiveKit un-mute failed:", e); }
          }
          if (callback) callback(result);
      } catch (err) { if (callback) callback({ success: false }); }
  });

  socket.on("action_kick", async (data) => {
      const { roomId, seatIndex, userId } = data;
      try {
          const sessionRef = db.collection("gameSessions").doc(roomId);
          await db.runTransaction(async (t) => {
              const doc = await t.get(sessionRef);
              if (!doc.exists) return;
              const d = doc.data();
              if (d.status !== 'pending') return;
              if (d.isServerRallyActive) return;

              // 🛑 STRICT SECURITY: Only the Room Host can kick players out of seats or the room!
              if (!verifySocketIdentity(socket, d.hostUserId)) {
                  console.warn(`[Security] Unauthorized action_kick attempt by ${socket.user?.uid || 'unauth'} in room ${roomId}`);
                  return;
              }

              const updates = {
                  playerUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                  seatedPlayerUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                  readyPlayers: admin.firestore.FieldValue.arrayRemove(userId)
              };
              if (seatIndex !== null) {
                  updates[`players.${seatIndex}`] = admin.firestore.FieldValue.delete();
                  updates.emptySeats = admin.firestore.FieldValue.increment(1);
              }
              t.update(sessionRef, updates);
              io.to(roomId).emit("room_update_received", { type: 'KICK', seatIndex, userId });
          });

          if (roomService) {
              try {
                  let existingMeta = "";
                  try {
                      const p = await roomService.getParticipant(roomId, userId);
                      if (p) existingMeta = p.metadata;
                  } catch (e) {}
                  await roomService.updateParticipant(roomId, userId, existingMeta, { canPublish: false, canSubscribe: true, canPublishData: true });
              } catch (e) {}
          }
          handleBotKickOrExit(userId, roomId, io, db, admin, processToggleReady);
          checkAndEvacuateBots(roomId, io, db, admin);

      } catch (err) { }
  });

  socket.on("action_lift_up", async (data) => {
      const { roomId, seatIndex, userId } = data;
      try {
          const sessionRef = db.collection("gameSessions").doc(roomId);
          await db.runTransaction(async (t) => {
              const doc = await t.get(sessionRef);
              if (!doc.exists) return;
              const d = doc.data();
              if (d.status !== 'pending') return;
              if (d.isServerRallyActive) return;

              // 🛑 STRICT SECURITY: Only the Room Host or the seated player themselves can lift up from a seat!
              if (!verifySocketIdentity(socket, d.hostUserId) && !verifySocketIdentity(socket, userId)) {
                  console.warn(`[Security] Unauthorized action_lift_up attempt by ${socket.user?.uid || 'unauth'} against ${userId} in room ${roomId}`);
                  return;
              }

              const updates = {
                  seatedPlayerUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                  readyPlayers: admin.firestore.FieldValue.arrayRemove(userId),
                  playerUserIds: admin.firestore.FieldValue.arrayUnion(userId) 
              };
              if (seatIndex !== null) {
                  updates[`players.${seatIndex}`] = admin.firestore.FieldValue.delete();
                  updates.emptySeats = admin.firestore.FieldValue.increment(1);
              }
              t.update(sessionRef, updates);
              io.to(roomId).emit("room_update_received", { type: 'LIFT_UP', seatIndex, userId });
          });
          if (roomService) {
              try {
                  let existingMeta = "";
                  try {
                      const p = await roomService.getParticipant(roomId, userId);
                      if (p) existingMeta = p.metadata;
                  } catch (e) {}
                  await roomService.updateParticipant(roomId, userId, existingMeta, { canPublish: false, canSubscribe: true, canPublishData: true });
              } catch (e) {}
          }
          checkAndEvacuateBots(roomId, io, db, admin);
          await handleBotLiftUp(userId, roomId, io, db, admin, processToggleReady);
      } catch (err) { }
  });

  socket.on("action_spectate", async (data, callback) => {
      const { roomId, seatIndex, userId } = data;
      if (!verifySocketIdentity(socket, userId)) {
          console.error(`Blocked unauthorized action_spectate attempt by ${socket.user?.uid || 'unauth'}`);
          if (callback) callback({ success: false });
          return;
      }
      io.to(roomId).emit("room_update_received", { type: 'SPECTATE', seatIndex, userId });
      try {
          const sessionRef = db.collection("gameSessions").doc(roomId);
          await db.runTransaction(async (t) => {
              const doc = await t.get(sessionRef);
              if (!doc.exists) return;
              const d = doc.data();
              if (d.status !== 'pending' && seatIndex !== null) return; 

              const updates = {
                  seatedPlayerUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                  readyPlayers: admin.firestore.FieldValue.arrayRemove(userId),
                  playerUserIds: admin.firestore.FieldValue.arrayUnion(userId) 
              };
              if (seatIndex !== null) {
                  updates[`players.${seatIndex}`] = admin.firestore.FieldValue.delete();
                  updates.emptySeats = admin.firestore.FieldValue.increment(1);
              }
              t.update(sessionRef, updates);
          });
          if (roomService) {
              try {
                  let existingMeta = "";
                  try {
                      const p = await roomService.getParticipant(roomId, userId);
                      if (p) existingMeta = p.metadata;
                  } catch (e) {}
                  await roomService.updateParticipant(roomId, userId, existingMeta, { canPublish: false, canSubscribe: true, canPublishData: true });
              } catch (e) {}
          }
          checkAndEvacuateBots(roomId, io, db, admin);
          if (callback) callback({ success: true });
      } catch (err) { if (callback) callback({ success: false }); }
  });

  socket.on("action_skip_turn", async (data, callback) => {
      const { roomId, gameId, userId, nextIndex } = data;
      if (!verifySocketIdentity(socket, userId)) {
          console.error(`Blocked unauthorized action_skip_turn attempt by ${socket.user?.uid || 'unauth'}`);
          return;
      }
      io.to(roomId).emit("game_update_received", { type: 'SKIP_TURN', userId, nextIndex });
      try {
          const gameRef = db.collection("gameSessions").doc(roomId).collection("games").doc(String(gameId));
          await gameRef.update({
              skipTurnOf: userId,
              skipTimestamp: admin.firestore.FieldValue.serverTimestamp()
          });
      } catch (err) {}
  });

  socket.on("action_exit_room", async (data) => {
      const { roomId, userId, username, seatIndex, isPlaying, isEliminated, isInCooldown } = data;
      
      // 🛑 STRICT SECURITY: Prevent cheaters from draining other players' coins via exit spam
      if (socket.user && socket.user.uid && userId !== socket.user.uid) {
          console.error(`Blocked spoofed exit attempt! Socket ${socket.user.uid} tried to exit as ${userId}`);
          return;
      } else if (!socket.user && socketUserMap.get(socket.id)?.userId && socketUserMap.get(socket.id)?.userId !== userId) {
          console.error(`Blocked spoofed exit attempt from unauthenticated socket ${socket.id}`);
          return;
      }

      io.to(roomId).emit("room_update_received", { type: 'EXIT', seatIndex, userId });

      try {
          const sessionRef = db.collection("gameSessions").doc(roomId);
          await db.runTransaction(async (t) => {
              const doc = await t.get(sessionRef);
              if (!doc.exists) return;
              const d = doc.data();
              const userWasSeated = (d.seatedPlayerUserIds || []).includes(userId);
              const updates = {
                  playerUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                  seatedPlayerUserIds: admin.firestore.FieldValue.arrayRemove(userId),
                  readyPlayers: admin.firestore.FieldValue.arrayRemove(userId)
              };
              if (userWasSeated) {
                  updates.emptySeats = admin.firestore.FieldValue.increment(1);
                  if (d.status === 'playing' && seatIndex !== null) {
                      updates[`players.${seatIndex}.quit`] = true;
                  } else if (seatIndex !== null) {
                      updates[`players.${seatIndex}`] = admin.firestore.FieldValue.delete();
                  }
              }
              t.update(sessionRef, updates);
          });

          if (isPlaying && !isInCooldown && seatIndex !== null && !isEliminated) {
              const userProfileRef = db.collection("userProfiles").doc(userId);
              await db.runTransaction(async (t) => {
                  const pDoc = await t.get(userProfileRef);
                  if (pDoc.exists) {
                      const currentCoins = pDoc.data().coins || 0;
                      t.update(userProfileRef, { coins: Math.max(0, currentCoins - 50) });
                  }
              });
          }

          await db.collection("gameSessions").doc(roomId).collection("chatMessages").add({
              gameSessionId: roomId,
              senderUserId: 'system',
              messageText: `🔔 ${username} has left the room.`,
              sentAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          checkAndEvacuateBots(roomId, io, db, admin);

      } catch (err) { }
  });

  socket.on("toggle_ready", async (data) => {
    const { roomCode, userId, isReady } = data;
    if (!verifySocketIdentity(socket, userId)) {
        console.error(`Blocked unauthorized toggle_ready attempt by ${socket.user?.uid || 'unauth'}`);
        return;
    }
    await processToggleReady(roomCode, userId, isReady, io, db, admin);
  });

  socket.on("room_update", (data) => { if ((socket.user || socketUserMap.has(socket.id)) && data?.roomId && socket.rooms.has(data.roomId)) socket.to(data.roomId).emit("room_update_received", data); });
  socket.on("send_message", (data) => { if ((socket.user || socketUserMap.has(socket.id)) && data?.roomId && socket.rooms.has(data.roomId)) socket.to(data.roomId).emit("receive_message", data); });
  socket.on("send_emoji", (data) => { if ((socket.user || socketUserMap.has(socket.id)) && data?.roomId && socket.rooms.has(data.roomId)) io.to(data.roomId).emit("receive_emoji", data); });
  socket.on("game_action", (data) => { if ((socket.user || socketUserMap.has(socket.id)) && data?.roomId && socket.rooms.has(data.roomId)) socket.to(data.roomId).emit("game_action_received", data); });

  socket.on("send_gift", async (data) => {
      try {
          // 🛑 STRICT SECURITY: Prevent cheaters from spoofing senderId to steal coins from rich players
          if (socket.user && socket.user.uid && data.senderId !== socket.user.uid) {
              console.error(`Blocked gift spoof attempt! Socket ${socket.user.uid} tried to send as ${data.senderId}`);
              return;
          } else if (!socket.user && socketUserMap.get(socket.id)?.userId && socketUserMap.get(socket.id)?.userId !== data.senderId) {
              console.error(`Blocked gift spoof attempt from unauthenticated socket ${socket.id}`);
              return;
          }

          const giftId = data.baseGiftId || data.id;

          const verifiedGift = SERVER_GIFTS.find(g => g.id === giftId);
          if (!verifiedGift) {
              console.error(`Blocked invalid gift transaction. Unknown Gift ID: ${giftId}`);
              return; 
          }

          const verifiedData = { 
              ...data, 
              price: verifiedGift.price, 
              name: verifiedGift.name, 
              baseGiftId: verifiedGift.id,
              type: verifiedGift.type || data.type || 'standard',
              comboId: data.comboId,
              comboCount: data.comboCount || 1,
              isPackageGift: data.isPackageGift === true,
              _socketId: socket.id
          };

          if (data.senderId && data.targetId && verifiedGift.price && data.roomId) {
              giftQueue.push(verifiedData);
              processGiftQueue(io); 
          }
      } catch (err) { 
          console.error("Send Gift Socket Error:", err); 
      }
  });

  registerVoiceRoomHandlers(io, socket, db, admin, voicePresence, processTimeExp, socketUserMap, roomService);
  registerGreedyGameHandlers(socket, db, admin);
  registerFruitGreedyGameHandlers(socket, db, admin);
  registerSuperSlotHandlers(socket, db, admin);
  registerBingoHandlers(io, socket, db, admin);
  registerTicTacToeHandlers(io, socket, db, admin);
  registerJakaroHandlers(io, socket, db, admin);

});

initBots(db, io, admin, processToggleReady);

startGreedyGameLoop(io, db, admin);
startFruitGreedyGameLoop(io, db, admin);

// Start the heartbeat sweep to detect ghost players (app killed, network drop)
startHeartbeatSweep(io, db, admin, voicePresence, roomService);

// --- GLOBAL ADMIN BROADCAST DM ---
app.post('/api/admin/broadcast-dm', async (req, res) => {
    const { adminPassword, message } = req.body;
    
    if (adminPassword !== '7076') {
        return res.status(403).json({ error: 'Unauthorized: Invalid admin password' });
    }

    if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Message cannot be empty' });
    }

    try {
        const botId = 'official_bot';
        
        const botProfileRef = db.collection('userProfiles').doc(botId);
        await botProfileRef.set({
            uid: botId,
            username: 'official',
            photoURL: '/logo.png',
            isBot: true
        }, { merge: true });

        const usersSnapshot = await db.collection('userProfiles').get();
        const users = [];
        usersSnapshot.forEach(doc => {
            if (doc.id !== botId) {
                users.push(doc.id);
            }
        });

        const batchArray = [];
        let batch = db.batch();
        let operationCounter = 0;
        
        const timestamp = admin.firestore.FieldValue.serverTimestamp();

        for (const userId of users) {
            const dmId = [userId, botId].sort().join('_');
            
            const dmRef = db.collection('directMessages').doc(dmId);
            batch.set(dmRef, {
                participants: [userId, botId],
                lastMessageText: message,
                lastMessageSentAt: timestamp,
                lastMessageSenderId: botId,
                [`unreadCounts.${userId}`]: admin.firestore.FieldValue.increment(1)
            }, { merge: true });
            operationCounter++;

            const messageRef = dmRef.collection('messages').doc();
            batch.set(messageRef, {
                senderId: botId,
                text: message,
                sentAt: timestamp,
                type: 'text'
            });
            operationCounter++;

            if (operationCounter > 400) {
                batchArray.push(batch.commit());
                batch = db.batch();
                operationCounter = 0;
            }
        }
        
        if (operationCounter > 0) {
            batchArray.push(batch.commit());
        }

        await Promise.all(batchArray);
        
        res.json({ success: true, message: `Successfully broadcasted DM to ${users.length} users.` });
    } catch (error) {
        console.error('Broadcast DM Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- GLOBAL ADMIN BAN USER ---
app.post('/api/admin/ban-user', async (req, res) => {
    const { adminPassword, banType, banValue, action = 'ban' } = req.body;
    
    if (adminPassword !== '7076') {
        return res.status(403).json({ error: 'Unauthorized: Invalid admin password' });
    }

    if (!banType || !banValue || banValue.trim() === '') {
        return res.status(400).json({ error: 'Missing banType or banValue' });
    }

    const isUnbanning = action === 'unban';

    try {
        let uidsToBan = [];
        const value = banValue.trim();

        if (banType === 'email') {
            try {
                const userRecord = await admin.auth().getUserByEmail(value);
                uidsToBan.push(userRecord.uid);
            } catch (err) {
                return res.status(404).json({ error: 'User not found with that Email' });
            }
        } else if (banType === 'phone') {
            try {
                const userRecord = await admin.auth().getUserByPhoneNumber(value);
                uidsToBan.push(userRecord.uid);
            } catch (err) {
                return res.status(404).json({ error: 'User not found with that Phone Number. Make sure to include country code.' });
            }
        } else if (banType === 'displayId') {
            const lookupDoc = await db.collection('displayIdToUid').doc(value).get();
            if (lookupDoc.exists) {
                uidsToBan.push(lookupDoc.data().uid);
            } else {
                const snapshot = await db.collection('userProfiles').where('displayId', '==', value).get();
                if (snapshot.empty) {
                    return res.status(404).json({ error: 'User not found with that Display ID' });
                }
                snapshot.forEach(doc => uidsToBan.push(doc.id));
            }
        } else if (banType === 'deviceId') {
            const snapshot = await db.collection('userProfiles').where('deviceId', '==', value).get();
            if (!snapshot.empty) {
                snapshot.forEach(doc => uidsToBan.push(doc.id));
            }
        } else {
            return res.status(400).json({ error: 'Invalid banType' });
        }

        if (uidsToBan.length === 0 && banType !== 'deviceId') {
            return res.status(404).json({ error: 'No matching user found.' });
        }

        let processCount = 0;
        for (const uid of uidsToBan) {
            let deviceIdToBan = null;
            const profileSnap = await db.collection('userProfiles').doc(uid).get();
            if (profileSnap.exists) {
                deviceIdToBan = profileSnap.data().deviceId;
            }

            await db.collection('userProfiles').doc(uid).set({
                isBanned: !isUnbanning
            }, { merge: true });

            try {
                await admin.auth().updateUser(uid, { disabled: !isUnbanning });
            } catch(e) {
                console.error(`Failed to update auth for ${uid}:`, e);
            }

            if (deviceIdToBan && banType === 'deviceId') {
                if (isUnbanning) {
                    await db.collection('bannedDevices').doc(deviceIdToBan).delete();
                } else {
                    await db.collection('bannedDevices').doc(deviceIdToBan).set({
                        bannedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            }

            processCount++;
        }

        if (banType === 'deviceId' && value) {
            if (isUnbanning) {
                await db.collection('bannedDevices').doc(value).delete();
            } else {
                await db.collection('bannedDevices').doc(value).set({
                    bannedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
            if (uidsToBan.length === 0) processCount = 1;
        }

        const actionText = isUnbanning ? 'unbanned' : 'banned';
        res.json({ success: true, message: `Successfully ${actionText} ${processCount} user(s).` });
    } catch (error) {
        console.error('Ban/Unban User Error:', error);
        res.status(500).json({ error: 'Internal server error while processing request.' });
    }
});

// --- MINI ADMIN DELETE MUSIC ---
app.post('/api/subadmin/delete-music', async (req, res) => {
    const { subadminPassword, songId } = req.body;
    
    if (subadminPassword !== '7076') {
        return res.status(403).json({ error: 'Unauthorized: Invalid sub-admin password' });
    }

    if (!songId) {
        return res.status(400).json({ error: 'Missing songId' });
    }

    try {
        await db.collection('global_music').doc(songId).delete();
        res.json({ success: true, message: 'Song deleted successfully.' });
    } catch (error) {
        console.error('Delete Music Error:', error);
        res.status(500).json({ error: 'Internal server error while processing request.' });
    }
});

// --- MINI ADMIN TEMP BAN ---
app.post('/api/subadmin/temp-ban', async (req, res) => {
    const { subadminPassword, displayId, durationDays } = req.body;
    
    if (subadminPassword !== '7076') {
        return res.status(403).json({ error: 'Unauthorized: Invalid sub-admin password' });
    }

    if (!displayId || !displayId.trim()) {
        return res.status(400).json({ error: 'Missing displayId' });
    }

    const days = parseInt(durationDays, 10);
    if (isNaN(days) || days < 1 || days > 3) {
        return res.status(400).json({ error: 'Duration must be between 1 and 3 days' });
    }

    try {
        let uidsToBan = [];
        const value = displayId.trim();

        const lookupDoc = await db.collection('displayIdToUid').doc(value).get();
        if (lookupDoc.exists) {
            uidsToBan.push(lookupDoc.data().uid);
        } else {
            const snapshot = await db.collection('userProfiles').where('displayId', '==', value).get();
            if (snapshot.empty) {
                return res.status(404).json({ error: 'User not found with that Display ID' });
            }
            snapshot.forEach(doc => uidsToBan.push(doc.id));
        }

        if (uidsToBan.length === 0) {
            return res.status(404).json({ error: 'No matching user found.' });
        }

        let processCount = 0;
        const bannedUntilTime = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

        for (const uid of uidsToBan) {
            await db.collection('userProfiles').doc(uid).set({
                bannedUntil: admin.firestore.Timestamp.fromDate(bannedUntilTime),
                isBanned: true
            }, { merge: true });
            
            try {
                await admin.auth().updateUser(uid, { disabled: true });
            } catch(e) {
                console.error(`Failed to disable auth for ${uid}:`, e);
            }
            
            processCount++;
        }

        res.json({ success: true, message: `Successfully temp-banned ${processCount} user(s) for ${days} day(s).` });
    } catch (error) {
        console.error('Temp Ban Error:', error);
        res.status(500).json({ error: 'Internal server error while processing request.' });
    }
});

server.listen(3001, () => {
    console.log("⚡ Master Server (API + Socket) running on port 3001!");
});

const gameStatesCache = new Map();

db.collectionGroup('games').onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
        const gameRef = change.doc.ref;
        const pathParts = gameRef.path.split('/');
        const sessionId = pathParts[1];
        const gameId = pathParts[3];
        const after = change.doc.data();
        const cacheKey = `${sessionId}_${gameId}`;

        if (change.type === 'added') {
            gameStatesCache.set(cacheKey, { status: after.status, skipTurnOf: after.skipTurnOf, currentPlayerIndex: after.currentPlayerIndex });
            return; 
        }

        if (change.type === 'modified') {
            const before = gameStatesCache.get(cacheKey) || {};
            gameStatesCache.set(cacheKey, { status: after.status, skipTurnOf: after.skipTurnOf, currentPlayerIndex: after.currentPlayerIndex });

            if (after.status === 'cooling_down' && before.status !== 'cooling_down') {
                
                // 1. Instantly release bots (marks them as 'quit: true' so avatars stay)
                releaseBotsFromRoom(sessionId, io, db, admin);
                
                // 2. Orchestrator waits 15s, then automatically clears the 'quit' slots
                runGameOrchestrator(before, after, gameRef, sessionId, gameId, db).then(() => {
                    // 3. After slots are fully cleared, schedule new bots to join
                    scheduleBotJoin(sessionId, io, db, admin, processToggleReady);
                }).catch(err => {
                    console.error(`Orchestrator error in session ${sessionId}:`, err);
                });
                
            } else {
                runGameOrchestrator(before, after, gameRef, sessionId, gameId, db).catch(err => {
                    console.error(`Orchestrator error in session ${sessionId}:`, err);
                });
            }
        }

        if (change.type === 'removed') {
            gameStatesCache.delete(cacheKey);
        }
    });
});

const processedMessages = new Set();
const lastPushSentMap = new Map();
let isInitialLoad = true; 

db.collectionGroup('messages').onSnapshot((snapshot) => {
    if (isInitialLoad) {
        isInitialLoad = false;
        snapshot.docs.forEach(doc => processedMessages.add(doc.id));
        return; 
    }

    snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
            const messageData = change.doc.data();
            const messageId = change.doc.id;

            if (processedMessages.has(messageId)) return;
            processedMessages.add(messageId);
            
            setTimeout(() => processedMessages.delete(messageId), 60000);

            const pathParts = change.doc.ref.path.split('/');
            
            if (pathParts[0] === 'directMessages') {
                const dmId = pathParts[1];
                const participants = dmId.split('_'); 
                
                const receiverId = participants.find(id => id !== messageData.senderId);

                if (receiverId) {
                    try {
                        let isOnline = false;
                        for (const [socketId, userInfo] of socketUserMap.entries()) {
                            if (userInfo.userId === receiverId) {
                                isOnline = true;
                                break;
                            }
                        }

                        if (!isOnline) {
                            // 🛑 STRICT SECURITY: FCM Rate Limiter (3-second cooldown per user) to prevent push notification DoS
                            const now = Date.now();
                            const lastSent = lastPushSentMap.get(receiverId) || 0;
                            if (now - lastSent < 3000) {
                                console.log(`[Push Limiter] Throttling push notification to user ${receiverId} (last push sent ${now - lastSent}ms ago)`);
                                return;
                            }
                            lastPushSentMap.set(receiverId, now);
                            setTimeout(() => lastPushSentMap.delete(receiverId), 10000);

                            const receiverProfile = await db.collection('userProfiles').doc(receiverId).get();
                            const receiverData = receiverProfile.data();

                            if (receiverData && receiverData.fcmToken) {
                                const senderProfile = await db.collection('userProfiles').doc(messageData.senderId).get();
                                const senderName = senderProfile.data()?.username || 'Someone';

                                let bodyText = messageData.text;
                                if (messageData.type === 'voice') bodyText = '🎤 Sent a voice message';
                                if (messageData.type === 'image') bodyText = '📷 Sent an image';
                                if (messageData.type === 'video') bodyText = '🎥 Sent a video';
                                if (messageData.isViewOnce) bodyText = '🫣 Sent a view-once message';
                                if (messageData.type === 'gift') bodyText = `🎁 Sent you a ${messageData.giftName}`;

                                const payload = {
                                    token: receiverData.fcmToken,
                                    notification: {
                                        title: `New message from ${senderName}`,
                                        body: bodyText,
                                    },
                                    data: {
                                        route: `/chat?userId=${messageData.senderId}`
                                    },
                                    android: {
                                        priority: 'high',
                                        notification: {
                                            channelId: 'default_channel',
                                            sound: 'default'
                                        }
                                    }
                                };

                                await admin.messaging().send(payload);
                            }
                        }
                    } catch (error) {
                        console.error('Error processing push notification:', error);
                    }
                }
            }
        }
    });
});

// --- AUTO UNBAN CRON ---
// Checks every 60 seconds for users whose bannedUntil timestamp has expired
setInterval(async () => {
    try {
        const now = admin.firestore.Timestamp.now();
        const snapshot = await db.collection('userProfiles')
            .where('isBanned', '==', true)
            .where('bannedUntil', '<=', now)
            .get();

        if (snapshot.empty) return;

        for (const doc of snapshot.docs) {
            const uid = doc.id;
            await db.collection('userProfiles').doc(uid).update({
                isBanned: false,
                bannedUntil: admin.firestore.FieldValue.delete()
            });

            try {
                await admin.auth().updateUser(uid, { disabled: false });
                console.log(`Auto-unbanned user ${uid} (Temporary Ban Expired)`);
            } catch(e) {
                console.error(`Failed to un-disable auth for ${uid}:`, e);
            }
        }
    } catch (error) {
        console.error('Error in Auto-Unban cron job:', error);
    }
}, 60 * 1000);