// familyHandler.js — Family System Server Handler
const admin = require('firebase-admin');

// --- FAMILY LEVEL TABLE ---
const FAMILY_LEVELS = [
    { level: 1, activeness: 0, funds: 0, maxMembers: 30, rewards: 'Medium Gacha' },
    { level: 2, activeness: 9000, funds: 6000, maxMembers: 40, rewards: 'Normal Chest' },
    { level: 3, activeness: 32000, funds: 25000, maxMembers: 50, rewards: 'Advanced Chest, Family Decor, Abyss Diamond' },
    { level: 4, activeness: 100000, funds: 78000, maxMembers: 60, rewards: 'Normal Chest, Advanced Chest, Advanced Gacha' },
    { level: 5, activeness: 300000, funds: 200000, maxMembers: 70, rewards: 'Advanced Chest, x2 Family Decor, Milky Way Badge' },
    { level: 6, activeness: 800000, funds: 600000, maxMembers: 80, rewards: 'Advanced Chest, Rare Chest' },
    { level: 7, activeness: 2400000, funds: 1800000, maxMembers: 100, rewards: 'Normal Chest, Advanced Chest, Rare Chest, Family Decor, Brilliant Feather' },
    { level: 8, activeness: 6240000, funds: 4800000, maxMembers: 120, rewards: 'Advanced Chest, x2 Rare Chest, Super Chest, Super Gacha' },
    { level: 9, activeness: 15600000, funds: 9000000, maxMembers: 130, rewards: 'Advanced Chest, Rare Chest x2, Super Chest, Family Voice Room' },
    { level: 10, activeness: 37500000, funds: 12000000, maxMembers: 140, rewards: 'Advanced Chest, x2 Rare Chest, x2 Super Chest, Custom Family Title, Family Decor, Nightmare Feather' },
    { level: 11, activeness: 63750000, funds: 16000000, maxMembers: 150, rewards: 'Advanced Chest, x3 Rare Chest, x3 Super Chest, x2 Custom Family Avatar Theme' },
];

// Weekly activeness reward milestones
const WEEKLY_ACTIVENESS_REWARDS = [
    { threshold: 8000, desc: 'Normal Chest x1', rewards: { normalChest: 1 } },
    { threshold: 24000, desc: 'Normal Chest x1, Advanced Chest x1', rewards: { normalChest: 1, advancedChest: 1 } },
    { threshold: 60000, desc: 'Normal Chest x1, Advanced Chest x1, Rare Chest x1', rewards: { normalChest: 1, advancedChest: 1, rareChest: 1 } },
    { threshold: 120000, desc: 'Normal Chest x2, Advanced Chest x2, Rare Chest x1', rewards: { normalChest: 2, advancedChest: 2, rareChest: 1 } },
    { threshold: 280000, desc: 'Normal Chest x2, Advanced Chest x2, Super Chest x1', rewards: { normalChest: 2, advancedChest: 2, superChest: 1 } },
];

// Role hierarchy: leader > deputy > admin > member
const ROLE_HIERARCHY = { 'leader': 4, 'deputy': 3, 'admin': 2, 'member': 1 };

// --- AUTH MIDDLEWARE ---
async function verifyAuth(req, adminSdk) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    try {
        const decoded = await adminSdk.auth().verifyIdToken(authHeader.split(' ')[1]);
        return decoded;
    } catch (e) {
        return null;
    }
}

function getFamilyLevelForActiveness(activeness) {
    let currentLevel = 1;
    for (const lvl of FAMILY_LEVELS) {
        if (activeness >= lvl.activeness) {
            currentLevel = lvl.level;
        }
    }
    return currentLevel;
}

function updateDailyTasks(memberData, taskKey, incrementValue = 1) {
    const today = new Date().toISOString().split('T')[0];
    let dailyTasks = memberData.dailyTasks || { date: today, progress: {}, claimed: [] };
    if (dailyTasks.date !== today) {
        dailyTasks = { date: today, progress: {}, claimed: [] };
    }
    if (!dailyTasks.progress) dailyTasks.progress = {};
    if (!dailyTasks.claimed) dailyTasks.claimed = [];
    
    if (typeof incrementValue === 'boolean') {
        dailyTasks.progress[taskKey] = incrementValue;
    } else {
        dailyTasks.progress[taskKey] = (dailyTasks.progress[taskKey] || 0) + incrementValue;
    }
    return dailyTasks;
}

function getMaxMembersForLevel(level) {
    const lvl = FAMILY_LEVELS.find(l => l.level === level);
    return lvl ? lvl.maxMembers : 30;
}

// --- SETUP ROUTES ---
function setupFamilyRoutes(app, db, adminSdk) {

    // ==========================================
    // POST /api/family/create — Create a new family
    // ==========================================
    app.post('/api/family/create', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { name, description } = req.body;

        if (!name || name.trim().length < 2 || name.trim().length > 20) {
            return res.status(400).json({ error: 'Family name must be 2-20 characters' });
        }

        try {
            // Check user profile
            const userDoc = await db.collection('userProfiles').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
            const userData = userDoc.data();

            // Check if already in a family
            if (userData.familyId) {
                return res.status(400).json({ error: 'You are already in a family. Leave your current family first.' });
            }

            // Check diamond level (aura >= 30000)
            const aura = userData.aura || 0;
            if (aura < 30000) {
                return res.status(403).json({ error: 'You need Diamond level (Aura 30,000+) to create a family.' });
            }

            // Check coins
            const coins = userData.coins || 0;
            if (coins < 10000) {
                return res.status(403).json({ error: 'You need at least 10,000 coins to create a family.' });
            }

            // Check for duplicate family name
            const existingFamily = await db.collection('families').where('name', '==', name.trim()).limit(1).get();
            if (!existingFamily.empty) {
                return res.status(400).json({ error: 'A family with this name already exists.' });
            }

            // Create family document
            const familyRef = db.collection('families').doc();
            const familyId = familyRef.id;
            const now = adminSdk.firestore.FieldValue.serverTimestamp();

            const familyData = {
                name: name.trim(),
                description: (description || '').trim().substring(0, 500),
                iconURL: userData.photoURL || '/boyavatar.jpeg',
                creatorId: uid,
                leaderId: uid,
                leaderName: userData.username || 'Unknown',
                deputyIds: [],
                adminIds: [],
                memberIds: [uid],
                memberCount: 1,
                maxMembers: 30,
                level: 1,
                activeness: 0,
                weeklyActiveness: 0,
                weeklyResetDate: getWeekStr(),
                familyFunds: 0,
                familyCoins: 0,
                weeklyRank: 0,
                acceptApplications: true,
                requireVerification: false,
                minCharmLevel: 0,
                freeToJoin: true,
                announcement: '',
                familySign: name.trim().substring(0, 7).toUpperCase(),
                familySignLevel: 0,
                createdAt: now,
                updatedAt: now,
            };

            const memberData = {
                odination: 0,
                weeklyActiveness: 0,
                totalActiveness: 0,
                goldDonation: 0,
                activityDonation: 0,
                joinedAt: now,
                role: 'leader',
            };

            // Transaction: create family + deduct coins + update user profile + assign shortId
            await db.runTransaction(async (t) => {
                // Re-read user to prevent race condition
                const freshUser = await t.get(db.collection('userProfiles').doc(uid));
                const freshData = freshUser.data();
                if ((freshData.coins || 0) < 10000) throw new Error('Insufficient coins');
                if (freshData.familyId) throw new Error('Already in a family');

                // Get and increment shortId counter
                const counterRef = db.collection('metadata').doc('familyCounter');
                const counterDoc = await t.get(counterRef);
                let currentId = 10000;
                if (counterDoc.exists && counterDoc.data().lastId) {
                    currentId = counterDoc.data().lastId + 1;
                }
                familyData.shortId = currentId.toString();

                t.set(counterRef, { lastId: currentId }, { merge: true });
                t.set(familyRef, familyData);
                t.set(familyRef.collection('members').doc(uid), memberData);
                t.update(db.collection('userProfiles').doc(uid), {
                    coins: adminSdk.firestore.FieldValue.increment(-10000),
                    familyId: familyId,
                    familyRole: 'leader',
                    familyName: name.trim(),
                });

                // Add news entry
                t.set(familyRef.collection('news').doc(), {
                    type: 'create',
                    actorId: uid,
                    actorName: freshData.username || 'Unknown',
                    message: `${freshData.username || 'Unknown'} created the family!`,
                    createdAt: now,
                });
            });

            console.log(`🏠 Family "${name.trim()}" created by ${uid}`);
            return res.json({ success: true, familyId });

        } catch (error) {
            console.error('Error creating family:', error);
            return res.status(500).json({ error: error.message || 'Failed to create family' });
        }
    });

    // ==========================================
    // POST /api/family/join — Join a family
    // ==========================================
    app.post('/api/family/join', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { familyId } = req.body;

        if (!familyId) return res.status(400).json({ error: 'Family ID required' });

        try {
            const result = await db.runTransaction(async (t) => {
                const userRef = db.collection('userProfiles').doc(uid);
                const familyRef = db.collection('families').doc(familyId);

                const [userDoc, familyDoc] = await Promise.all([
                    t.get(userRef),
                    t.get(familyRef),
                ]);

                if (!userDoc.exists) throw new Error('User not found');
                if (!familyDoc.exists) throw new Error('Family not found');

                const userData = userDoc.data();
                const familyData = familyDoc.data();

                if (userData.familyId) throw new Error('You are already in a family');
                if (!familyData.acceptApplications) throw new Error('This family is not accepting members');
                if (familyData.memberCount >= familyData.maxMembers) throw new Error('Family is full');

                // Check charm requirement
                if (familyData.minCharmLevel > 0) {
                    const userAura = userData.aura || 0;
                    if (userAura < familyData.minCharmLevel) {
                        throw new Error(`You need ${familyData.minCharmLevel}+ charm to join this family`);
                    }
                }

                const now = adminSdk.firestore.FieldValue.serverTimestamp();
                
                let isRequest = true;

                // Check if already requested
                const pendingRequests = userData.pendingJoinRequests || [];
                if (pendingRequests.includes(familyId)) {
                    throw new Error('You have already sent a join request to this family');
                }

                // Create join request
                t.set(familyRef.collection('joinRequests').doc(uid), {
                    userId: uid,
                    username: userData.username || 'Unknown',
                    photoURL: userData.photoURL || '',
                    aura: userData.aura || 0,
                    level: userData.level || 1,
                    timestamp: now,
                    status: 'pending'
                });

                // Update user's pending requests
                t.update(userRef, {
                    pendingJoinRequests: adminSdk.firestore.FieldValue.arrayUnion(familyId)
                });
                
                return isRequest;
            });

            if (result === true) {
                console.log(`📩 User ${uid} requested to join family ${familyId}`);
                return res.json({ success: true, status: 'requested' });
            } else {
                console.log(`👋 User ${uid} joined family ${familyId}`);
                return res.json({ success: true, status: 'joined' });
            }

        } catch (error) {
            console.error('Error joining family:', error);
            return res.status(500).json({ error: error.message || 'Failed to join family' });
        }
    });

    // ==========================================
    // POST /api/family/requests/respond — Accept or Reject Join Request
    // ==========================================
    app.post('/api/family/requests/respond', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { targetUserId, action } = req.body;

        if (!targetUserId || !['accept', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Valid targetUserId and action (accept/reject) required' });
        }

        try {
            const callerDoc = await db.collection('userProfiles').doc(uid).get();
            if (!callerDoc.exists) return res.status(404).json({ error: 'Caller not found' });
            
            const callerData = callerDoc.data();
            const familyId = callerData.familyId;
            
            if (!familyId) return res.status(400).json({ error: 'You are not in a family' });

            const callerRole = ROLE_HIERARCHY[callerData.familyRole] || 0;
            if (callerRole < ROLE_HIERARCHY['admin']) {
                return res.status(403).json({ error: 'Only admins and above can manage requests' });
            }

            const familyRef = db.collection('families').doc(familyId);
            const requestRef = familyRef.collection('joinRequests').doc(targetUserId);
            const targetUserRef = db.collection('userProfiles').doc(targetUserId);

            await db.runTransaction(async (t) => {
                const requestDoc = await t.get(requestRef);
                if (!requestDoc.exists) throw new Error('Join request not found or already processed');

                const familyDoc = await t.get(familyRef);
                const targetUserDoc = await t.get(targetUserRef);
                
                if (action === 'accept') {
                    const familyData = familyDoc.data();
                    const targetUserData = targetUserDoc.data();

                    if (targetUserData.familyId) throw new Error('User is already in another family');
                    if (familyData.memberCount >= familyData.maxMembers) throw new Error('Family is full');

                    const now = adminSdk.firestore.FieldValue.serverTimestamp();

                    t.update(familyRef, {
                        memberIds: adminSdk.firestore.FieldValue.arrayUnion(targetUserId),
                        memberCount: adminSdk.firestore.FieldValue.increment(1),
                        updatedAt: now,
                    });

                    t.set(familyRef.collection('members').doc(targetUserId), {
                        odination: 0,
                        weeklyActiveness: 0,
                        totalActiveness: 0,
                        goldDonation: 0,
                        activityDonation: 0,
                        joinedAt: now,
                        role: 'member',
                    });

                    t.update(targetUserRef, {
                        familyId: familyId,
                        familyRole: 'member',
                        familyName: familyData.name,
                        pendingJoinRequests: adminSdk.firestore.FieldValue.arrayRemove(familyId)
                    });

                    t.set(familyRef.collection('news').doc(), {
                        type: 'join',
                        actorId: targetUserId,
                        actorName: targetUserData.username || 'Unknown',
                        message: `${targetUserData.username || 'Unknown'} was accepted into the family!`,
                        createdAt: now,
                    });
                } else {
                    // Reject
                    t.update(targetUserRef, {
                        pendingJoinRequests: adminSdk.firestore.FieldValue.arrayRemove(familyId)
                    });
                }

                // Delete request in both cases
                t.delete(requestRef);
            });

            console.log(`✅ User ${uid} ${action}ed join request for ${targetUserId}`);
            return res.json({ success: true });

        } catch (error) {
            console.error('Error responding to request:', error);
            return res.status(500).json({ error: error.message || 'Failed to respond to request' });
        }
    });

    // ==========================================
    // POST /api/family/leave — Leave current family
    // ==========================================
    app.post('/api/family/leave', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;

        try {
            const userDoc = await db.collection('userProfiles').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
            const userData = userDoc.data();

            if (!userData.familyId) return res.status(400).json({ error: 'You are not in a family' });

            const familyId = userData.familyId;
            const familyRef = db.collection('families').doc(familyId);
            const familyDoc = await familyRef.get();
            if (!familyDoc.exists) {
                // Family deleted, just clean up user
                await db.collection('userProfiles').doc(uid).update({
                    familyId: adminSdk.firestore.FieldValue.delete(),
                    familyRole: adminSdk.firestore.FieldValue.delete(),
                    familyName: adminSdk.firestore.FieldValue.delete(),
                });
                return res.json({ success: true });
            }

            const familyData = familyDoc.data();

            // Leader can't leave — must transfer leadership or disband
            if (familyData.leaderId === uid) {
                return res.status(400).json({ error: 'Leaders cannot leave. Transfer leadership or disband the family.' });
            }

            await db.runTransaction(async (t) => {
                const now = adminSdk.firestore.FieldValue.serverTimestamp();

                // Remove from family
                const updateFields = {
                    memberIds: adminSdk.firestore.FieldValue.arrayRemove(uid),
                    memberCount: adminSdk.firestore.FieldValue.increment(-1),
                    updatedAt: now,
                };

                // Also remove from deputy/admin arrays if applicable
                if (familyData.deputyIds.includes(uid)) {
                    updateFields.deputyIds = adminSdk.firestore.FieldValue.arrayRemove(uid);
                }
                if (familyData.adminIds.includes(uid)) {
                    updateFields.adminIds = adminSdk.firestore.FieldValue.arrayRemove(uid);
                }

                t.update(familyRef, updateFields);
                t.delete(familyRef.collection('members').doc(uid));
                t.update(db.collection('userProfiles').doc(uid), {
                    familyId: adminSdk.firestore.FieldValue.delete(),
                    familyRole: adminSdk.firestore.FieldValue.delete(),
                    familyName: adminSdk.firestore.FieldValue.delete(),
                });

                t.set(familyRef.collection('news').doc(), {
                    type: 'leave',
                    actorId: uid,
                    actorName: userData.username || 'Unknown',
                    message: `${userData.username || 'Unknown'} left the family.`,
                    createdAt: now,
                });
            });

            console.log(`👋 User ${uid} left family ${familyId}`);
            return res.json({ success: true });

        } catch (error) {
            console.error('Error leaving family:', error);
            return res.status(500).json({ error: error.message || 'Failed to leave family' });
        }
    });

    // ==========================================
    // POST /api/family/kick — Kick a member
    // ==========================================
    app.post('/api/family/kick', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { targetUserId } = req.body;

        if (!targetUserId) return res.status(400).json({ error: 'Target user ID required' });
        if (uid === targetUserId) return res.status(400).json({ error: 'Cannot kick yourself' });

        try {
            const userDoc = await db.collection('userProfiles').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
            const userData = userDoc.data();
            if (!userData.familyId) return res.status(400).json({ error: 'You are not in a family' });

            const familyId = userData.familyId;
            const familyRef = db.collection('families').doc(familyId);
            const familyDoc = await familyRef.get();
            if (!familyDoc.exists) return res.status(404).json({ error: 'Family not found' });
            const familyData = familyDoc.data();

            // Permission check: only leader and deputies can kick
            const callerRole = ROLE_HIERARCHY[userData.familyRole] || 0;
            if (callerRole < ROLE_HIERARCHY['deputy']) {
                return res.status(403).json({ error: 'Only leaders and deputies can kick members' });
            }

            // Can't kick someone of equal or higher rank
            const targetMemberDoc = await familyRef.collection('members').doc(targetUserId).get();
            if (!targetMemberDoc.exists) return res.status(404).json({ error: 'Target is not a member of this family' });
            const targetRole = ROLE_HIERARCHY[targetMemberDoc.data().role] || 0;

            if (targetRole >= callerRole) {
                return res.status(403).json({ error: 'Cannot kick a member with equal or higher rank' });
            }

            const targetUserDoc = await db.collection('userProfiles').doc(targetUserId).get();
            const targetUsername = targetUserDoc.exists ? targetUserDoc.data().username : 'Unknown';

            await db.runTransaction(async (t) => {
                const now = adminSdk.firestore.FieldValue.serverTimestamp();

                const updateFields = {
                    memberIds: adminSdk.firestore.FieldValue.arrayRemove(targetUserId),
                    memberCount: adminSdk.firestore.FieldValue.increment(-1),
                    updatedAt: now,
                };
                if (familyData.deputyIds.includes(targetUserId)) {
                    updateFields.deputyIds = adminSdk.firestore.FieldValue.arrayRemove(targetUserId);
                }
                if (familyData.adminIds.includes(targetUserId)) {
                    updateFields.adminIds = adminSdk.firestore.FieldValue.arrayRemove(targetUserId);
                }

                t.update(familyRef, updateFields);
                t.delete(familyRef.collection('members').doc(targetUserId));
                t.update(db.collection('userProfiles').doc(targetUserId), {
                    familyId: adminSdk.firestore.FieldValue.delete(),
                    familyRole: adminSdk.firestore.FieldValue.delete(),
                    familyName: adminSdk.firestore.FieldValue.delete(),
                });

                t.set(familyRef.collection('news').doc(), {
                    type: 'kick',
                    actorId: uid,
                    actorName: userData.username || 'Unknown',
                    targetId: targetUserId,
                    targetName: targetUsername,
                    message: `${userData.username} kicked ${targetUsername} from the family.`,
                    createdAt: now,
                });
            });

            console.log(`🦵 User ${uid} kicked ${targetUserId} from family ${familyId}`);
            return res.json({ success: true });

        } catch (error) {
            console.error('Error kicking member:', error);
            return res.status(500).json({ error: error.message || 'Failed to kick member' });
        }
    });

    // ==========================================
    // POST /api/family/promote — Change member role
    // ==========================================
    app.post('/api/family/promote', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { targetUserId, newRole } = req.body;

        if (!targetUserId || !newRole) return res.status(400).json({ error: 'Target user and new role required' });
        if (!['deputy', 'admin', 'member'].includes(newRole)) return res.status(400).json({ error: 'Invalid role' });

        try {
            const userDoc = await db.collection('userProfiles').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
            const userData = userDoc.data();
            if (!userData.familyId) return res.status(400).json({ error: 'Not in a family' });

            const familyId = userData.familyId;
            const familyRef = db.collection('families').doc(familyId);
            const familyDoc = await familyRef.get();
            if (!familyDoc.exists) return res.status(404).json({ error: 'Family not found' });
            const familyData = familyDoc.data();

            // Only leader can promote to deputy; leader/deputy can promote to admin
            const callerRole = ROLE_HIERARCHY[userData.familyRole] || 0;
            const targetNewRole = ROLE_HIERARCHY[newRole] || 0;

            if (callerRole <= targetNewRole) {
                return res.status(403).json({ error: 'Cannot promote to a role equal or higher than your own' });
            }

            // Check deputy limit (max 4 deputies)
            if (newRole === 'deputy' && familyData.deputyIds.length >= 4) {
                return res.status(400).json({ error: 'Maximum 4 deputies allowed' });
            }

            const targetMemberDoc = await familyRef.collection('members').doc(targetUserId).get();
            if (!targetMemberDoc.exists) return res.status(404).json({ error: 'Target is not a family member' });
            const oldRole = targetMemberDoc.data().role;

            const targetUserDoc = await db.collection('userProfiles').doc(targetUserId).get();
            const targetUsername = targetUserDoc.exists ? targetUserDoc.data().username : 'Unknown';

            await db.runTransaction(async (t) => {
                const now = adminSdk.firestore.FieldValue.serverTimestamp();

                // Update member subcollection
                t.update(familyRef.collection('members').doc(targetUserId), { role: newRole });

                // Update family arrays
                const familyUpdates = { updatedAt: now };

                // Remove from old role arrays
                if (oldRole === 'deputy') {
                    familyUpdates.deputyIds = adminSdk.firestore.FieldValue.arrayRemove(targetUserId);
                }
                if (oldRole === 'admin') {
                    familyUpdates.adminIds = adminSdk.firestore.FieldValue.arrayRemove(targetUserId);
                }
                t.update(familyRef, familyUpdates);

                // Add to new role arrays
                const addUpdates = {};
                if (newRole === 'deputy') {
                    addUpdates.deputyIds = adminSdk.firestore.FieldValue.arrayUnion(targetUserId);
                }
                if (newRole === 'admin') {
                    addUpdates.adminIds = adminSdk.firestore.FieldValue.arrayUnion(targetUserId);
                }
                if (Object.keys(addUpdates).length > 0) {
                    t.update(familyRef, addUpdates);
                }

                // Update user profile
                t.update(db.collection('userProfiles').doc(targetUserId), {
                    familyRole: newRole,
                });

                t.set(familyRef.collection('news').doc(), {
                    type: 'promote',
                    actorId: uid,
                    actorName: userData.username || 'Unknown',
                    targetId: targetUserId,
                    targetName: targetUsername,
                    message: `${userData.username} set ${targetUsername} as ${newRole}.`,
                    createdAt: now,
                });
            });

            console.log(`⬆️ User ${uid} promoted ${targetUserId} to ${newRole}`);
            return res.json({ success: true });

        } catch (error) {
            console.error('Error promoting member:', error);
            return res.status(500).json({ error: error.message || 'Failed to promote member' });
        }
    });

    // ==========================================
    // POST /api/family/transfer-leader — Transfer leadership
    // ==========================================
    app.post('/api/family/transfer-leader', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { targetUserId } = req.body;

        if (!targetUserId) return res.status(400).json({ error: 'Target user ID required' });

        try {
            const userDoc = await db.collection('userProfiles').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
            const userData = userDoc.data();
            if (!userData.familyId) return res.status(400).json({ error: 'Not in a family' });
            if (userData.familyRole !== 'leader') return res.status(403).json({ error: 'Only the leader can transfer leadership' });

            const familyId = userData.familyId;
            const familyRef = db.collection('families').doc(familyId);
            const familyDoc = await familyRef.get();
            if (!familyDoc.exists) return res.status(404).json({ error: 'Family not found' });
            const familyData = familyDoc.data();

            if (!familyData.memberIds.includes(targetUserId)) {
                return res.status(400).json({ error: 'Target is not a member of this family' });
            }

            const targetUserDoc = await db.collection('userProfiles').doc(targetUserId).get();
            const targetUsername = targetUserDoc.exists ? targetUserDoc.data().username : 'Unknown';

            await db.runTransaction(async (t) => {
                const now = adminSdk.firestore.FieldValue.serverTimestamp();

                t.update(familyRef, {
                    leaderId: targetUserId,
                    leaderName: targetUsername,
                    deputyIds: adminSdk.firestore.FieldValue.arrayRemove(targetUserId),
                    adminIds: adminSdk.firestore.FieldValue.arrayRemove(targetUserId),
                    updatedAt: now,
                });

                t.update(familyRef.collection('members').doc(uid), { role: 'member' });
                t.update(familyRef.collection('members').doc(targetUserId), { role: 'leader' });

                t.update(db.collection('userProfiles').doc(uid), { familyRole: 'member' });
                t.update(db.collection('userProfiles').doc(targetUserId), { familyRole: 'leader' });

                t.set(familyRef.collection('news').doc(), {
                    type: 'promote',
                    actorId: uid,
                    actorName: userData.username || 'Unknown',
                    targetId: targetUserId,
                    targetName: targetUsername,
                    message: `${userData.username} transferred leadership to ${targetUsername}.`,
                    createdAt: now,
                });
            });

            console.log(`👑 Leadership transferred from ${uid} to ${targetUserId}`);
            return res.json({ success: true });

        } catch (error) {
            console.error('Error transferring leadership:', error);
            return res.status(500).json({ error: error.message || 'Failed to transfer leadership' });
        }
    });

    // ==========================================
    // POST /api/family/update-settings — Update family settings
    // ==========================================
    app.post('/api/family/update-settings', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { name, description, announcement, acceptApplications, requireVerification, minCharmLevel, freeToJoin, familySign, iconURL } = req.body;

        try {
            const userDoc = await db.collection('userProfiles').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
            const userData = userDoc.data();
            if (!userData.familyId) return res.status(400).json({ error: 'Not in a family' });

            // Check baseline permissions — at least Admin is required to hit this endpoint
            const callerRole = ROLE_HIERARCHY[userData.familyRole] || 0;
            if (callerRole < ROLE_HIERARCHY['admin']) {
                return res.status(403).json({ error: 'Only leaders, deputies, and admins can update settings' });
            }

            const familyId = userData.familyId;
            const updates = { updatedAt: adminSdk.firestore.FieldValue.serverTimestamp() };

            // Edit basic information (Name, Description, Icon, Family Sign) -> LEADER ONLY
            if (name !== undefined || description !== undefined || familySign !== undefined || iconURL !== undefined) {
                if (callerRole < ROLE_HIERARCHY['leader']) {
                    return res.status(403).json({ error: 'Only the Leader can edit basic family information or family sign' });
                }
            }

            if (name !== undefined && name.trim().length >= 2 && name.trim().length <= 20) {
                updates.name = name.trim();
                // Also update all members' cached familyName
            }
            if (description !== undefined) updates.description = description.trim().substring(0, 500);
            if (familySign !== undefined && familySign.trim().length >= 4 && familySign.trim().length <= 7) {
                updates.familySign = familySign.trim().toUpperCase();
            }
            if (iconURL !== undefined && iconURL.trim().length > 0) {
                updates.iconURL = iconURL.trim();
            }

            // Edit family bulletin (Announcement) -> LEADER AND DEPUTY ONLY
            if (announcement !== undefined) {
                if (callerRole < ROLE_HIERARCHY['deputy']) {
                    return res.status(403).json({ error: 'Only Leaders and Deputies can edit the family bulletin' });
                }
                updates.announcement = announcement.trim().substring(0, 1000);
            }

            // Application Settings -> LEADER, DEPUTY, ADMIN
            if (acceptApplications !== undefined) updates.acceptApplications = Boolean(acceptApplications);
            if (requireVerification !== undefined) updates.requireVerification = Boolean(requireVerification);
            if (minCharmLevel !== undefined) updates.minCharmLevel = Math.max(0, Number(minCharmLevel) || 0);
            if (freeToJoin !== undefined) updates.freeToJoin = Boolean(freeToJoin);

            await db.collection('families').doc(familyId).update(updates);

            // If name changed, update all members' cached familyName
            if (updates.name) {
                const familyDoc = await db.collection('families').doc(familyId).get();
                const memberIds = familyDoc.data().memberIds || [];
                const batch = db.batch();
                for (const memberId of memberIds) {
                    batch.update(db.collection('userProfiles').doc(memberId), { familyName: updates.name });
                }
                await batch.commit();
            }

            return res.json({ success: true });

        } catch (error) {
            console.error('Error updating settings:', error);
            return res.status(500).json({ error: error.message || 'Failed to update settings' });
        }
    });

    // ==========================================
    // POST /api/family/donate — Donate coins to family fund
    // ==========================================
    app.post('/api/family/donate', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { amount } = req.body;
        const donationAmount = Number(amount);

        if (!donationAmount || donationAmount < 10) {
            return res.status(400).json({ error: 'Minimum donation is 10 coins' });
        }

        try {
            await db.runTransaction(async (t) => {
                const userRef = db.collection('userProfiles').doc(uid);
                const userDoc = await t.get(userRef);
                if (!userDoc.exists) throw new Error('User not found');
                const userData = userDoc.data();

                if (!userData.familyId) throw new Error('Not in a family');
                if ((userData.coins || 0) < donationAmount) throw new Error('Insufficient coins');

                const familyId = userData.familyId;
                const familyRef = db.collection('families').doc(familyId);
                const memberRef = familyRef.collection('members').doc(uid);

                // READS MUST COME BEFORE WRITES
                const memberDoc = await t.get(memberRef);
                const memberData = memberDoc.exists ? memberDoc.data() : {};
                const dailyTasks = updateDailyTasks(memberData, 'familyHope', true);

                // Deduct coins from user
                t.update(userRef, {
                    coins: adminSdk.firestore.FieldValue.increment(-donationAmount),
                });

                // Add to family funds
                // Every 50 gold donated = 1 activeness
                const activenessGain = Math.floor(donationAmount / 50);

                t.update(familyRef, {
                    familyFunds: adminSdk.firestore.FieldValue.increment(donationAmount),
                    activeness: adminSdk.firestore.FieldValue.increment(activenessGain),
                    weeklyActiveness: adminSdk.firestore.FieldValue.increment(activenessGain),
                    updatedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
                });

                // Update member stats
                t.update(memberRef, {
                    goldDonation: adminSdk.firestore.FieldValue.increment(donationAmount),
                    weeklyActiveness: adminSdk.firestore.FieldValue.increment(activenessGain),
                    totalActiveness: adminSdk.firestore.FieldValue.increment(activenessGain),
                    dailyTasks
                });

                // News
                t.set(familyRef.collection('news').doc(), {
                    type: 'donate',
                    actorId: uid,
                    actorName: userData.username || 'Unknown',
                    message: `${userData.username || 'Unknown'} donated ${donationAmount.toLocaleString()} coins to the family!`,
                    createdAt: adminSdk.firestore.FieldValue.serverTimestamp(),
                });
            });

            return res.json({ success: true });

        } catch (error) {
            console.error('Error donating:', error);
            return res.status(500).json({ error: error.message || 'Failed to donate' });
        }
    });

    // ==========================================
    // POST /api/family/disband — Disband the family
    // ==========================================
    app.post('/api/family/disband', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;

        try {
            const userDoc = await db.collection('userProfiles').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
            const userData = userDoc.data();
            if (!userData.familyId) return res.status(400).json({ error: 'Not in a family' });
            if (userData.familyRole !== 'leader') return res.status(403).json({ error: 'Only the leader can disband' });

            const familyId = userData.familyId;
            const familyRef = db.collection('families').doc(familyId);
            const familyDoc = await familyRef.get();
            if (!familyDoc.exists) return res.status(404).json({ error: 'Family not found' });
            const familyData = familyDoc.data();

            // Clear all members' family fields
            const batch = db.batch();
            for (const memberId of familyData.memberIds) {
                batch.update(db.collection('userProfiles').doc(memberId), {
                    familyId: adminSdk.firestore.FieldValue.delete(),
                    familyRole: adminSdk.firestore.FieldValue.delete(),
                    familyName: adminSdk.firestore.FieldValue.delete(),
                });
            }

            // Delete members subcollection
            const membersSnap = await familyRef.collection('members').get();
            for (const doc of membersSnap.docs) {
                batch.delete(doc.ref);
            }

            // Delete news subcollection
            const newsSnap = await familyRef.collection('news').get();
            for (const doc of newsSnap.docs) {
                batch.delete(doc.ref);
            }

            // Delete the family document
            batch.delete(familyRef);

            await batch.commit();

            console.log(`💥 Family ${familyId} disbanded by ${uid}`);
            return res.json({ success: true });

        } catch (error) {
            console.error('Error disbanding family:', error);
            return res.status(500).json({ error: error.message || 'Failed to disband family' });
        }
    });

    // ==========================================
    // GET /api/family/search — Search families
    // ==========================================
    app.get('/api/family/search', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const { q } = req.query;

        try {
            let query = db.collection('families');

            if (q && /^\d{5}$/.test(q)) {
                query = query.where('shortId', '==', q).limit(1);
            } else {
                query = query
                    .where('acceptApplications', '==', true)
                    .orderBy('memberCount', 'desc')
                    .limit(20);
            }

            const snapshot = await query.get();
            const families = [];

            for (const doc of snapshot.docs) {
                const data = doc.data();
                // If search query provided and it's not a shortId, filter by name (case-insensitive)
                if (q && !/^\d{5}$/.test(q) && !data.name.toLowerCase().includes(q.toLowerCase())) continue;

                families.push({
                    id: doc.id,
                    shortId: data.shortId,
                    name: data.name,
                    description: data.description,
                    iconURL: data.iconURL,
                    level: data.level,
                    memberCount: data.memberCount,
                    maxMembers: data.maxMembers,
                    weeklyActiveness: data.weeklyActiveness,
                    requireVerification: data.requireVerification,
                    freeToJoin: data.freeToJoin,
                    acceptApplications: data.acceptApplications,
                });
            }

            return res.json({ families });

        } catch (error) {
            console.error('Error searching families:', error);
            return res.status(500).json({ error: 'Failed to search families' });
        }
    });

    // ==========================================
    // POST /api/family/cheer — Spend Gold to add Activeness
    // ==========================================
    app.post('/api/family/cheer', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { multiplier } = req.body; // 1, 10, or 100
        const validMultipliers = { 1: { cost: 500, act: 50 }, 10: { cost: 5000, act: 500 }, 100: { cost: 50000, act: 5000 } };
        
        if (!validMultipliers[multiplier]) return res.status(400).json({ error: 'Invalid multiplier' });
        
        const cost = validMultipliers[multiplier].cost;
        const activenessAmount = validMultipliers[multiplier].act;

        try {
            const userRef = db.collection('userProfiles').doc(uid);
            
            await db.runTransaction(async (t) => {
                const userDoc = await t.get(userRef);
                if (!userDoc.exists) throw new Error('User not found');
                const userData = userDoc.data();
                
                if (!userData.familyId) throw new Error('Not in a family');
                if ((userData.coins || 0) < cost) throw new Error('Insufficient Gold');
                
                const familyId = userData.familyId;
                const familyRef = db.collection('families').doc(familyId);
                const memberRef = familyRef.collection('members').doc(uid);
                
                const memberDoc = await t.get(memberRef);
                const memberData = memberDoc.exists ? memberDoc.data() : {};
                
                let dailyTasks = updateDailyTasks(memberData, 'familyActiveness', true);
                dailyTasks = updateDailyTasks({ dailyTasks }, 'familyGrowth', multiplier);

                // Deduct coins
                t.update(userRef, { coins: adminSdk.firestore.FieldValue.increment(-cost) });
                
                // Add to ledger
                const ledgerRef = db.collection('coinLedger').doc();
                t.set(ledgerRef, {
                    userId: uid,
                    amount: -cost,
                    type: 'family_cheer',
                    desc: `Cheered for family x${multiplier}`,
                    timestamp: adminSdk.firestore.FieldValue.serverTimestamp()
                });

                t.update(familyRef, {
                    activeness: adminSdk.firestore.FieldValue.increment(activenessAmount),
                    weeklyActiveness: adminSdk.firestore.FieldValue.increment(activenessAmount),
                    totalActiveness: adminSdk.firestore.FieldValue.increment(activenessAmount),
                });
                
                t.update(memberRef, {
                    weeklyActiveness: adminSdk.firestore.FieldValue.increment(activenessAmount),
                    totalActiveness: adminSdk.firestore.FieldValue.increment(activenessAmount),
                    activityDonation: adminSdk.firestore.FieldValue.increment(activenessAmount),
                    dailyTasks
                });
            });

            return res.json({ success: true, activenessAdded: activenessAmount });
        } catch (error) {
            console.error('Error cheering:', error);
            return res.status(500).json({ error: error.message || 'Failed to cheer' });
        }
    });

    // ==========================================
    // POST /api/family/tasks/claim — Claim task rewards
    // ==========================================
    app.post('/api/family/tasks/claim', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { taskKey } = req.body;
        
        const TASK_CONFIGS = {
            gachaExpert: { req: 10, rewards: { fc: 50, ff: 50, act: 50 } },
            sendGifts: { req: 3, rewards: { fc: 5, ff: 5, act: 5 } },
            loveFamily: { req: 100000, rewards: { fc: 50, ff: 50, act: 50 } },
            familyHope: { req: true, rewards: { fc: 5, ff: 5, act: 5 } },
            familyActiveness: { req: true, rewards: { fc: 5, ff: 5, act: 5 } },
            familyGrowth: { req: 10, rewards: { fc: 50, ff: 50, act: 50 } },
            gotLuck: { req: true, rewards: { fc: 5, ff: 5, act: 5 } },
        };

        if (!TASK_CONFIGS[taskKey]) return res.status(400).json({ error: 'Invalid task' });
        const config = TASK_CONFIGS[taskKey];

        try {
            await db.runTransaction(async (t) => {
                const userRef = db.collection('userProfiles').doc(uid);
                const userDoc = await t.get(userRef);
                if (!userDoc.exists) throw new Error('User not found');
                const userData = userDoc.data();
                
                if (!userData.familyId) throw new Error('Not in a family');
                
                const familyId = userData.familyId;
                const familyRef = db.collection('families').doc(familyId);
                const memberRef = familyRef.collection('members').doc(uid);
                
                const memberDoc = await t.get(memberRef);
                const memberData = memberDoc.exists ? memberDoc.data() : {};
                
                const today = new Date().toISOString().split('T')[0];
                let dailyTasks = memberData.dailyTasks || { date: today, progress: {}, claimed: [] };
                if (dailyTasks.date !== today) dailyTasks = { date: today, progress: {}, claimed: [] };
                if (!dailyTasks.progress) dailyTasks.progress = {};
                if (!dailyTasks.claimed) dailyTasks.claimed = [];
                
                if (dailyTasks.claimed.includes(taskKey)) throw new Error('Task already claimed today');
                
                const progress = dailyTasks.progress[taskKey];
                let isCompleted = false;
                if (typeof config.req === 'boolean') {
                    isCompleted = !!progress;
                } else {
                    isCompleted = (progress || 0) >= config.req;
                }
                
                if (!isCompleted) throw new Error('Task not completed yet');
                
                dailyTasks.claimed.push(taskKey);
                
                // Issue rewards
                t.update(userRef, { familyCoins: adminSdk.firestore.FieldValue.increment(config.rewards.fc) });
                t.update(familyRef, {
                    familyFunds: adminSdk.firestore.FieldValue.increment(config.rewards.ff),
                    activeness: adminSdk.firestore.FieldValue.increment(config.rewards.act),
                    weeklyActiveness: adminSdk.firestore.FieldValue.increment(config.rewards.act),
                    totalActiveness: adminSdk.firestore.FieldValue.increment(config.rewards.act),
                });
                t.update(memberRef, {
                    dailyTasks,
                    weeklyActiveness: adminSdk.firestore.FieldValue.increment(config.rewards.act),
                    totalActiveness: adminSdk.firestore.FieldValue.increment(config.rewards.act),
                });
            });

            return res.json({ success: true, rewards: config.rewards });
        } catch (error) {
            console.error('Error claiming task:', error);
            return res.status(500).json({ error: error.message || 'Failed to claim task' });
        }
    });

    // ==========================================
    // POST /api/family/upgrade — Upgrade family level
    // ==========================================
    app.post('/api/family/upgrade', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;

        try {
            const userDoc = await db.collection('userProfiles').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
            const userData = userDoc.data();
            if (!userData.familyId) return res.status(400).json({ error: 'Not in a family' });

            // Only leader and deputy can upgrade
            const callerRole = ROLE_HIERARCHY[userData.familyRole] || 0;
            if (callerRole < ROLE_HIERARCHY['deputy']) {
                return res.status(403).json({ error: 'Only leaders and deputies can upgrade the family' });
            }

            const familyId = userData.familyId;
            const familyRef = db.collection('families').doc(familyId);

            await db.runTransaction(async (t) => {
                const familyDoc = await t.get(familyRef);
                if (!familyDoc.exists) throw new Error('Family not found');
                const familyData = familyDoc.data();

                const currentLevel = familyData.level;
                if (currentLevel >= 11) throw new Error('Already at max level');

                const nextLevelInfo = FAMILY_LEVELS.find(l => l.level === currentLevel + 1);
                if (!nextLevelInfo) throw new Error('Invalid level');

                if (familyData.activeness < nextLevelInfo.activeness) {
                    throw new Error(`Need ${nextLevelInfo.activeness.toLocaleString()} activeness (current: ${familyData.activeness.toLocaleString()})`);
                }
                if (familyData.familyFunds < nextLevelInfo.funds) {
                    throw new Error(`Need ${nextLevelInfo.funds.toLocaleString()} family funds (current: ${familyData.familyFunds.toLocaleString()})`);
                }

                // Deduct funds and upgrade
                t.update(familyRef, {
                    level: currentLevel + 1,
                    maxMembers: nextLevelInfo.maxMembers,
                    familyFunds: adminSdk.firestore.FieldValue.increment(-nextLevelInfo.funds),
                    updatedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
                });

                t.set(familyRef.collection('news').doc(), {
                    type: 'upgrade',
                    actorId: uid,
                    actorName: userData.username || 'Unknown',
                    message: `Family upgraded to Level ${currentLevel + 1}! 🎉`,
                    createdAt: adminSdk.firestore.FieldValue.serverTimestamp(),
                });
            });

            return res.json({ success: true });

        } catch (error) {
            console.error('Error upgrading family:', error);
            return res.status(500).json({ error: error.message || 'Failed to upgrade family' });
        }
    });

    // ==========================================
    // POST /api/family/activeness/claim — Claim Activeness Milestone
    // ==========================================
    app.post('/api/family/activeness/claim', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { threshold } = req.body;

        if (!threshold) return res.status(400).json({ error: 'Missing threshold' });

        try {
            const userDoc = await db.collection('userProfiles').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
            const userData = userDoc.data();
            if (!userData.familyId) return res.status(400).json({ error: 'Not in a family' });

            const callerRole = ROLE_HIERARCHY[userData.familyRole] || 0;
            if (callerRole < ROLE_HIERARCHY['deputy']) {
                return res.status(403).json({ error: 'Only leaders and deputies can claim activeness rewards' });
            }

            const familyId = userData.familyId;
            const familyRef = db.collection('families').doc(familyId);

            let rewardsGranted = {};

            await db.runTransaction(async (t) => {
                const familyDoc = await t.get(familyRef);
                if (!familyDoc.exists) throw new Error('Family not found');
                const familyData = familyDoc.data();

                if ((familyData.weeklyActiveness || 0) < threshold) {
                    throw new Error(`Activeness threshold ${threshold} not reached. Current: ${familyData.weeklyActiveness || 0}`);
                }

                const claimedRewards = familyData.claimedActivenessRewards || [];
                if (claimedRewards.includes(threshold)) {
                    throw new Error(`Reward for ${threshold} already claimed`);
                }

                const milestone = WEEKLY_ACTIVENESS_REWARDS.find(r => r.threshold === threshold);
                if (!milestone) throw new Error('Invalid threshold');

                const inventoryUpdates = {};
                for (const [chest, qty] of Object.entries(milestone.rewards)) {
                    inventoryUpdates[`inventory.${chest}`] = adminSdk.firestore.FieldValue.increment(qty);
                }

                t.update(familyRef, {
                    ...inventoryUpdates,
                    claimedActivenessRewards: adminSdk.firestore.FieldValue.arrayUnion(threshold)
                });
                
                rewardsGranted = milestone.rewards;
            });

            return res.json({ success: true, rewardsGranted });

        } catch (error) {
            console.error('Error claiming activeness reward:', error);
            return res.status(500).json({ error: error.message || 'Failed to claim reward' });
        }
    });

    // ==========================================
    // POST /api/family/gacha/spin — Spin Gacha
    // ==========================================
    app.post('/api/family/gacha/spin', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { count = 1 } = req.body; // 1 or 10

        try {
            const userDoc = await db.collection('userProfiles').doc(uid).get();
            if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
            const userData = userDoc.data();
            if (!userData.familyId) return res.status(400).json({ error: 'Not in a family' });

            const familyId = userData.familyId;
            const familyRef = db.collection('families').doc(familyId);
            const familyDoc = await familyRef.get();
            if (!familyDoc.exists) return res.status(404).json({ error: 'Family not found' });
            const familyData = familyDoc.data();

            const memberRef = familyRef.collection('members').doc(uid);
            const memberDoc = await memberRef.get();
            const memberData = memberDoc.exists ? memberDoc.data() : {};

            const level = familyData.level || 1;
            let gachaType = 'medium';
            if (level >= 8) gachaType = 'super';
            else if (level >= 4) gachaType = 'advanced';

            // Check if free spin used today
            const now = new Date();
            const dateString = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
            const lastFreeSpinDate = userData.lastFreeGachaSpin || '';
            
            let isFree = false;
            let spinsToPayFor = count;

            if (count === 1 && lastFreeSpinDate !== dateString) {
                // Free spin is only granted if family funds are not negative
                // (Negative means they failed to meet the daily maintenance deduction)
                if ((familyData.familyFunds || 0) >= 0) {
                    isFree = true;
                    spinsToPayFor = 0;
                }
            }

            // Calculate cost
            let cardCost = 0;
            if (!isFree) {
                if (count === 1) cardCost = 6;
                else if (count === 10) cardCost = 52;
                else return res.status(400).json({ error: 'Invalid spin count' });

                if ((userData.gachaCards || 0) < cardCost) {
                    return res.status(400).json({ error: `Not enough Gacha Cards. Need ${cardCost}.` });
                }
            }

            // Generate rewards
            const rewards = [];
            const userUpdates = {};
            const familyUpdates = {};
            
            const mediumPool = [
                { name: 'Gold x30', type: 'gold', amount: 30, weight: 40 },
                { name: 'Family Coins x30', type: 'familyCoins', amount: 30, weight: 40 },
                { name: 'Rose Gift', type: 'packageGift', itemId: 'g11', amount: 1, weight: 20 },
            ];
            const advancedPool = [
                { name: 'Gold x588', type: 'gold', amount: 588, weight: 30 },
                { name: 'Family Coins x600', type: 'familyCoins', amount: 600, weight: 30 },
                { name: 'Advanced Chest', type: 'advancedChest', amount: 1, weight: 15 },
                { name: 'Rose Gift', type: 'packageGift', itemId: 'g11', amount: 1, weight: 10 },
                { name: 'Kiss Gift', type: 'packageGift', itemId: 'g9', amount: 1, weight: 10 },
                { name: 'Rich Boy Title (3d)', type: 'title', itemId: 'rich_boy', durationDays: 3, weight: 5 },
            ];
            const superPool = [
                { name: 'Gold x2000', type: 'gold', amount: 2000, weight: 25 },
                { name: 'Family Coins x1800', type: 'familyCoins', amount: 1800, weight: 25 },
                { name: 'Rare Chest', type: 'rareChest', amount: 1, weight: 15 },
                { name: 'Rose Gift', type: 'packageGift', itemId: 'g11', amount: 1, weight: 15 },
                { name: 'Kiss Gift', type: 'packageGift', itemId: 'g9', amount: 1, weight: 15 },
                { name: 'Rich Boy Title (7d)', type: 'title', itemId: 'rich_boy', durationDays: 7, weight: 5 },
            ];

            let pool = mediumPool;
            if (gachaType === 'super') pool = superPool;
            else if (gachaType === 'advanced') pool = advancedPool;

            const totalWeight = pool.reduce((acc, item) => acc + item.weight, 0);

            for (let i = 0; i < count; i++) {
                let random = Math.floor(Math.random() * totalWeight);
                let selectedItem = pool[pool.length - 1];
                for (const item of pool) {
                    if (random < item.weight) {
                        selectedItem = item;
                        break;
                    }
                    random -= item.weight;
                }
                
                rewards.push({ name: selectedItem.name, amount: selectedItem.amount || 1, icon: selectedItem.type });

                // Accumulate updates
                if (selectedItem.type === 'gold') {
                    userUpdates.coins = adminSdk.firestore.FieldValue.increment(selectedItem.amount);
                } else if (selectedItem.type === 'familyCoins') {
                    userUpdates.familyCoins = adminSdk.firestore.FieldValue.increment(selectedItem.amount);
                } else if (selectedItem.type === 'advancedChest') {
                    familyUpdates['inventory.advancedChest'] = adminSdk.firestore.FieldValue.increment(selectedItem.amount || 1);
                } else if (selectedItem.type === 'rareChest') {
                    familyUpdates['inventory.rareChest'] = adminSdk.firestore.FieldValue.increment(selectedItem.amount || 1);
                } else if (selectedItem.type === 'packageGift') {
                    userUpdates[`packageGifts.${selectedItem.itemId}`] = adminSdk.firestore.FieldValue.increment(selectedItem.amount || 1);
                } else if (selectedItem.type === 'title') {
                    userUpdates[`titles.${selectedItem.itemId}`] = Date.now() + (selectedItem.durationDays * 24 * 60 * 60 * 1000);
                }
            }

            // Apply updates
            const finalUserUpdates = { ...userUpdates };
            if (isFree) {
                finalUserUpdates.lastFreeGachaSpin = dateString;
            }
            if (cardCost > 0) {
                finalUserUpdates.gachaCards = adminSdk.firestore.FieldValue.increment(-cardCost);
            }

            const batch = db.batch();
            batch.update(db.collection('userProfiles').doc(uid), finalUserUpdates);
            
            if (Object.keys(familyUpdates).length > 0) {
                batch.update(familyRef, familyUpdates);
            }

            let dailyTasks = updateDailyTasks(memberData, 'gachaExpert', count);
            dailyTasks = updateDailyTasks({ dailyTasks }, 'gotLuck', true);
            batch.update(memberRef, { dailyTasks });

            await batch.commit();

            return res.json({ success: true, rewards, isFree });

        } catch (error) {
            console.error('Error in gacha spin:', error);
            return res.status(500).json({ error: error.message || 'Failed to spin gacha' });
        }
    });

    // ==========================================
    // POST /api/family/members/role — Assign Role
    // ==========================================
    app.post('/api/family/members/role', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { targetUid, newRole } = req.body;

        if (!targetUid || !newRole) return res.status(400).json({ error: 'Missing targetUid or newRole' });
        if (!['deputy', 'admin', 'member'].includes(newRole)) return res.status(400).json({ error: 'Invalid role' });
        if (targetUid === uid) return res.status(400).json({ error: 'Cannot change your own role this way' });

        try {
            const callerDoc = await db.collection('userProfiles').doc(uid).get();
            const callerData = callerDoc.data() || {};
            if (!callerData.familyId) return res.status(400).json({ error: 'Not in a family' });

            const familyId = callerData.familyId;
            const callerRoleStr = callerData.familyRole || 'member';
            const callerRoleLevel = ROLE_HIERARCHY[callerRoleStr] || 1;

            // Permissions
            if (newRole === 'deputy' && callerRoleStr !== 'leader') {
                return res.status(403).json({ error: 'Only leader can assign deputies' });
            }
            if (newRole === 'admin' && callerRoleLevel < ROLE_HIERARCHY['deputy']) {
                return res.status(403).json({ error: 'Only leader or deputy can assign admins' });
            }
            if (newRole === 'member' && callerRoleLevel < ROLE_HIERARCHY['deputy']) {
                return res.status(403).json({ error: 'Only leader or deputy can demote roles' });
            }

            const targetUserDoc = await db.collection('userProfiles').doc(targetUid).get();
            const targetData = targetUserDoc.data() || {};
            if (targetData.familyId !== familyId) return res.status(400).json({ error: 'Target user is not in your family' });

            const targetRoleStr = targetData.familyRole || 'member';
            const targetRoleLevel = ROLE_HIERARCHY[targetRoleStr] || 1;

            if (callerRoleLevel <= targetRoleLevel) {
                return res.status(403).json({ error: 'Cannot modify a role equal or higher than your own' });
            }
            if (newRole === 'member' && callerRoleLevel <= targetRoleLevel) {
                 return res.status(403).json({ error: 'Cannot demote a role equal or higher than your own' });
            }

            const batch = db.batch();
            
            // 1. Update user profile
            const userRef = db.collection('userProfiles').doc(targetUid);
            batch.update(userRef, { familyRole: newRole });

            // 2. Update family member doc
            const memberRef = db.collection('families').doc(familyId).collection('members').doc(targetUid);
            batch.update(memberRef, { role: newRole });

            // 3. System news
            const newsRef = db.collection('families').doc(familyId).collection('news').doc();
            batch.set(newsRef, {
                id: newsRef.id,
                type: 'upgrade',
                message: `${targetData.username || 'A member'} has been assigned the role of ${newRole.toUpperCase()}.`,
                createdAt: adminSdk.firestore.FieldValue.serverTimestamp()
            });

            await batch.commit();
            return res.json({ success: true, message: `Role updated to ${newRole}` });

        } catch (error) {
            console.error('Error assigning role:', error);
            return res.status(500).json({ error: error.message || 'Failed to assign role' });
        }
    });

    // ==========================================
    // POST /api/family/treasury/send — Send Chest to Member
    // ==========================================
    app.post('/api/family/treasury/send', async (req, res) => {
        const decoded = await verifyAuth(req, adminSdk);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

        const uid = decoded.uid;
        const { targetUid, chestKey } = req.body;

        if (!targetUid || !chestKey) return res.status(400).json({ error: 'Missing targetUid or chestKey' });

        const CHEST_REWARDS = {
            'normalChest': 500,
            'advancedChest': 2000,
            'rareChest': 5000,
            'superChest': 12000
        };

        if (!CHEST_REWARDS[chestKey]) {
            return res.status(400).json({ error: 'Invalid chest type' });
        }

        try {
            const callerDoc = await db.collection('userProfiles').doc(uid).get();
            const callerData = callerDoc.data() || {};
            if (!callerData.familyId) return res.status(400).json({ error: 'Not in a family' });

            const callerRoleStr = callerData.familyRole || 'member';
            const callerRoleLevel = ROLE_HIERARCHY[callerRoleStr] || 1;

            if (callerRoleLevel < ROLE_HIERARCHY['deputy']) {
                return res.status(403).json({ error: 'Only leader or deputy can distribute chests' });
            }

            const familyId = callerData.familyId;

            const targetUserDoc = await db.collection('userProfiles').doc(targetUid).get();
            const targetData = targetUserDoc.data() || {};
            if (targetData.familyId !== familyId) {
                return res.status(400).json({ error: 'Target user is not in your family' });
            }

            let successMessage = '';

            await db.runTransaction(async (t) => {
                const familyRef = db.collection('families').doc(familyId);
                const familyDoc = await t.get(familyRef);
                const familyData = familyDoc.data();

                const inventoryCount = familyData.inventory?.[chestKey] || 0;
                if (inventoryCount <= 0) {
                    throw new Error(`The family does not have any ${chestKey} left`);
                }

                const rewardCoins = CHEST_REWARDS[chestKey];

                // Deduct chest from family
                t.update(familyRef, {
                    [`inventory.${chestKey}`]: adminSdk.firestore.FieldValue.increment(-1),
                    updatedAt: adminSdk.firestore.FieldValue.serverTimestamp()
                });

                // Add coins to target user
                t.update(db.collection('userProfiles').doc(targetUid), {
                    coins: adminSdk.firestore.FieldValue.increment(rewardCoins)
                });

                // Add to ledger
                const ledgerRef = db.collection('coinLedger').doc();
                t.set(ledgerRef, {
                    userId: targetUid,
                    amount: rewardCoins,
                    type: 'family_chest_reward',
                    desc: `Received ${chestKey} reward from family`,
                    timestamp: adminSdk.firestore.FieldValue.serverTimestamp()
                });

                // System news
                const newsRef = familyRef.collection('news').doc();
                t.set(newsRef, {
                    id: newsRef.id,
                    type: 'chest_reward',
                    message: `${callerData.username || 'A leader'} rewarded ${targetData.username || 'a member'} with a ${chestKey.replace('Chest', ' Chest')} (${rewardCoins} coins)!`,
                    createdAt: adminSdk.firestore.FieldValue.serverTimestamp()
                });

                successMessage = `Sent ${chestKey} to ${targetData.username || 'member'} and rewarded ${rewardCoins} coins!`;
            });

            return res.json({ success: true, message: successMessage });

        } catch (error) {
            console.error('Error sending chest:', error);
            return res.status(500).json({ error: error.message || 'Failed to send chest' });
        }
    });

    console.log('🏠 Family routes registered.');
}

// --- HELPER ---
function getWeekStr() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((now - startOfYear) / 86400000);
    const weekNumber = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

module.exports = { setupFamilyRoutes, FAMILY_LEVELS, WEEKLY_ACTIVENESS_REWARDS };
