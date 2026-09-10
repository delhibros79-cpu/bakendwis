// cronJobs.js
const cron = require('node-cron');
const admin = require('firebase-admin');

// VIP Logic Helpers
const VIP_RELEGATION_RULES = {
    1: { periodDays: 0, target: 0, deduct: 0 },
    2: { periodDays: 30, target: 30, deduct: 1000 },
    3: { periodDays: 30, target: 100, deduct: 4000 },
    4: { periodDays: 60, target: 500, deduct: 25000 },
    5: { periodDays: 60, target: 1200, deduct: 60000 },
    6: { periodDays: 60, target: 2800, deduct: 140000 },
    7: { periodDays: 75, target: 6000, deduct: 380000 },
    8: { periodDays: 75, target: 10000, deduct: 820000 },
    9: { periodDays: 90, target: 16000, deduct: 1680000 },
    10: { periodDays: 90, target: 30000, deduct: 3380000 },
    11: { periodDays: 120, target: 160000, deduct: 6800000 }
};

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

function startCronJobs(db) {
    // Runs every day at 00:00 (Midnight) - Aura & VIP Rotation
    cron.schedule('0 0 * * *', async () => {
        console.log('⏳ Running midnight Aura and VIP rotation...');
        
        try {
            const usersRef = db.collection('userProfiles');
            
            // 1. Fetch users with EITHER Aura or VIP points today/yesterday
            const [auraToday, auraYest, vipToday, vipYest] = await Promise.all([
                usersRef.where('auraToday', '>', 0).get(),
                usersRef.where('auraYesterday', '>', 0).get(),
                usersRef.where('vipGrowthToday', '>', 0).get(),
                usersRef.where('vipGrowthYesterday', '>', 0).get()
            ]);

            const usersToUpdate = new Map();
            auraToday.docs.forEach(doc => usersToUpdate.set(doc.id, doc));
            auraYest.docs.forEach(doc => usersToUpdate.set(doc.id, doc));
            vipToday.docs.forEach(doc => usersToUpdate.set(doc.id, doc));
            vipYest.docs.forEach(doc => usersToUpdate.set(doc.id, doc));

            if (usersToUpdate.size === 0) {
                console.log('✅ No users gained points today or yesterday. Skipping rotation.');
                return;
            }

            const BATCH_SIZE = 450; 
            let batches = [];
            let currentBatch = db.batch();
            let operationCount = 0;

            // 2. Rotate both Aura and VIP points
            usersToUpdate.forEach((doc) => {
                const userData = doc.data();
                const todayAura = userData.auraToday || 0;
                const todayVip = userData.vipGrowthToday || 0;

                currentBatch.update(doc.ref, {
                    auraYesterday: todayAura, 
                    auraToday: 0,
                    vipGrowthYesterday: todayVip,
                    vipGrowthToday: 0
                });

                operationCount++;

                if (operationCount === BATCH_SIZE) {
                    batches.push(currentBatch.commit());
                    currentBatch = db.batch(); 
                    operationCount = 0;
                }
            });

            if (operationCount > 0) {
                batches.push(currentBatch.commit());
            }

            await Promise.all(batches);
            console.log(`✅ Successfully rotated Aura and VIP points for ${usersToUpdate.size} users.`);

            // 2.5 Rotate Room EXP
            try {
                console.log('⏳ Running midnight Room EXP rotation...');
                const roomsRef = db.collection('voiceSessions');
                const [expTodayRooms, expYestRooms] = await Promise.all([
                    roomsRef.where('expToday', '>', 0).get(),
                    roomsRef.where('expYesterday', '>', 0).get()
                ]);

                const roomsToUpdate = new Map();
                expTodayRooms.docs.forEach(doc => roomsToUpdate.set(doc.id, doc));
                expYestRooms.docs.forEach(doc => roomsToUpdate.set(doc.id, doc));

                if (roomsToUpdate.size > 0) {
                    let roomBatches = [];
                    let currentRoomBatch = db.batch();
                    let roomOpCount = 0;

                    roomsToUpdate.forEach((doc) => {
                        const roomData = doc.data();
                        const todayExp = roomData.expToday || 0;

                        currentRoomBatch.update(doc.ref, {
                            expYesterday: todayExp,
                            expToday: 0
                        });

                        roomOpCount++;
                        if (roomOpCount === BATCH_SIZE) {
                            roomBatches.push(currentRoomBatch.commit());
                            currentRoomBatch = db.batch();
                            roomOpCount = 0;
                        }
                    });

                    if (roomOpCount > 0) {
                        roomBatches.push(currentRoomBatch.commit());
                    }

                    await Promise.all(roomBatches);
                    console.log(`✅ Successfully rotated Room EXP for ${roomsToUpdate.size} rooms.`);
                } else {
                    console.log('✅ No rooms gained EXP today or yesterday. Skipping room rotation.');
                }
            } catch (error) {
                console.error("❌ Error rotating Room EXP:", error);
            }

            // 3. Process Aura Hall of Fame
            try {
                console.log('⏳ Processing Hall of Fame and Crown Holder titles...');
                const topPlayersSnapshot = await db.collection('userProfiles')
                    .orderBy('auraYesterday', 'desc')
                    .limit(10)
                    .get();

                if (!topPlayersSnapshot.empty) {
                    const topPlayerDoc = topPlayersSnapshot.docs[0];
                    const topPlayerData = topPlayerDoc.data();
                    
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    const dateString = `${yesterday.getDate().toString().padStart(2, '0')}/${(yesterday.getMonth() + 1).toString().padStart(2, '0')}`;

                    if (topPlayerData.auraYesterday > 0) {
                        await db.collection('hallOfFame').add({
                            userId: topPlayerDoc.id,
                            username: topPlayerData.username,
                            photoURL: topPlayerData.photoURL || '',
                            activeFrameId: topPlayerData.activeFrameId || null,
                            date: dateString,
                            timestamp: admin.firestore.FieldValue.serverTimestamp(),
                            aura: topPlayerData.auraYesterday
                        });
                        console.log(`🌟 Added ${topPlayerData.username} to Aura Hall of Fame for ${dateString}!`);
                    }

                    const titleBatch = db.batch();
                    const threeDaysFromNow = Date.now() + (3 * 24 * 60 * 60 * 1000);

                    topPlayersSnapshot.docs.forEach((doc) => {
                        titleBatch.update(doc.ref, {
                            'titles.crown_holder': threeDaysFromNow
                        });
                    });

                    await titleBatch.commit();
                    console.log('🏆 Successfully awarded Crown Holder titles!');
                }

                // 4. Process VIP Hall of Fame
                const topVipSnapshot = await db.collection('userProfiles')
                    .orderBy('vipGrowthYesterday', 'desc')
                    .limit(1)
                    .get();

                if (!topVipSnapshot.empty) {
                    const topVipDoc = topVipSnapshot.docs[0];
                    const topVipData = topVipDoc.data();
                    
                    if (topVipData.vipGrowthYesterday > 0) {
                        const yesterday = new Date();
                        yesterday.setDate(yesterday.getDate() - 1);
                        const dateString = `${yesterday.getDate().toString().padStart(2, '0')}/${(yesterday.getMonth() + 1).toString().padStart(2, '0')}`;

                        await db.collection('hallOfFameVip').add({
                            userId: topVipDoc.id,
                            username: topVipData.username,
                            photoURL: topVipData.photoURL || '',
                            activeFrameId: topVipData.activeFrameId || null,
                            date: dateString,
                            timestamp: admin.firestore.FieldValue.serverTimestamp(),
                            vipGrowthPts: topVipData.vipGrowthYesterday
                        });
                        console.log(`🌟 Added ${topVipData.username} to VIP Hall of Fame for ${dateString}!`);
                    }
                }
                
                // --- NEW TITLES: Golden King and Center Stage ---
                const newTitleBatch = db.batch();
                const threeDaysFromNowNew = Date.now() + (3 * 24 * 60 * 60 * 1000);

                // 5. Golden King Title (Top 10 VIPs)
                const topVipsRankSnapshot = await db.collection('userProfiles')
                    .orderBy('vipGrowthYesterday', 'desc')
                    .limit(10)
                    .get();

                if (!topVipsRankSnapshot.empty) {
                    topVipsRankSnapshot.docs.forEach((doc) => {
                        if (doc.data().vipGrowthYesterday > 0) {
                            newTitleBatch.update(doc.ref, {
                                'titles.golden_king': threeDaysFromNowNew
                            });
                        }
                    });
                }

                // 6. Center Stage Title (Top 10 Level)
                const topLevelsSnapshot = await db.collection('userProfiles')
                    .orderBy('level', 'desc')
                    .orderBy('xp', 'desc')
                    .limit(10)
                    .get();

                if (!topLevelsSnapshot.empty) {
                    topLevelsSnapshot.docs.forEach((doc) => {
                        newTitleBatch.update(doc.ref, {
                            'titles.center_stage': threeDaysFromNowNew
                        });
                    });
                }

                // 7. Soulmate Title (Top 10 Couples in Blessing Ranking)
                const topBlessingSnapshot = await db.collection('userProfiles')
                    .orderBy('cpBlessing', 'desc')
                    .limit(20)
                    .get();

                if (!topBlessingSnapshot.empty) {
                    topBlessingSnapshot.docs.forEach((doc) => {
                        if (doc.data().cpBlessing > 0) {
                            newTitleBatch.update(doc.ref, {
                                'titles.soul': threeDaysFromNowNew
                            });
                        }
                    });
                }

                // 8. True Love Title (Top 10 Couples in Love Ranking)
                const topLoveSnapshot = await db.collection('userProfiles')
                    .orderBy('cpLove', 'desc')
                    .limit(20)
                    .get();

                if (!topLoveSnapshot.empty) {
                    topLoveSnapshot.docs.forEach((doc) => {
                        if (doc.data().cpLove > 0) {
                            newTitleBatch.update(doc.ref, {
                                'titles.love': threeDaysFromNowNew
                            });
                        }
                    });
                }

                await newTitleBatch.commit();
                console.log('🏆 Successfully awarded Golden King, Center Stage, Soulmate, and True Love titles!');

            } catch (postRotationError) {
                console.error('❌ Error in post-rotation tasks:', postRotationError);
            }

        } catch (error) {
            console.error('❌ Error rotating daily points:', error);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata" 
    });

    // Runs every day at 02:00 - Family Fund Deduction for Gacha & Voice Room Maintenance
    cron.schedule('0 2 * * *', async () => {
        console.log('⏳ Running 02:00am Family Fund deduction...');
        try {
            const familiesRef = db.collection('families');
            const familiesSnap = await familiesRef.get();
            
            let batches = [];
            let currentBatch = db.batch();
            let opCount = 0;

            familiesSnap.docs.forEach((doc) => {
                const data = doc.data();
                const level = data.level || 1;
                let cost = 600; // Medium (Lv 1-3)
                if (level >= 8) cost = 1800; // Super (Lv 8+)
                else if (level >= 4) cost = 1000; // Advanced (Lv 4-7)

                // The screenshot also says Family Voice Room costs 2000/day
                if (level >= 9) { // Voice Room unlocks at Level 9 according to familyHandler.js
                    cost += 2000;
                }

                currentBatch.update(doc.ref, {
                    familyFunds: admin.firestore.FieldValue.increment(-cost)
                });
                
                opCount++;
                if (opCount === 450) {
                    batches.push(currentBatch.commit());
                    currentBatch = db.batch();
                    opCount = 0;
                }
            });

            if (opCount > 0) {
                batches.push(currentBatch.commit());
            }

            await Promise.all(batches);
            console.log(`✅ Successfully deducted daily maintenance Family Funds for ${familiesSnap.size} families.`);

        } catch (error) {
            console.error('❌ Error deducting Family Funds:', error);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    });

    // Runs every day at 00:30 - VIP Relegation & Expiry Check
    cron.schedule('30 0 * * *', async () => {
        console.log('⏳ Running VIP Relegation and Expiry check...');
        try {
            const now = new Date();
            const usersRef = db.collection('userProfiles');
            
            // 1. Check for expired VIP subscriptions
            const expiredSnap = await usersRef
                .where('isVip', '==', true)
                .where('vipExpiresAt', '<', admin.firestore.Timestamp.fromDate(now))
                .get();
            
            const expireBatch = db.batch();
            expiredSnap.docs.forEach(doc => {
                expireBatch.update(doc.ref, { isVip: false }); 
            });
            await expireBatch.commit();

            // 2. Process Relegations for active VIPs
            const activeVips = await usersRef
                .where('isVip', '==', true)
                .where('relegationPeriodEnd', '<', admin.firestore.Timestamp.fromDate(now))
                .get();
            
            const relegationBatch = db.batch();

            activeVips.docs.forEach(doc => {
                const data = doc.data();
                const level = data.vipLevel || 1;
                const rules = VIP_RELEGATION_RULES[level];

                if (!rules || level === 1) return; // VIP 1 has no relegation

                let newPts = data.vipGrowthPts || 0;
                const accumulated = data.relegationPtsAccumulated || 0;

                // Failed the target? Deduct points.
                if (accumulated < rules.target) {
                    newPts = Math.max(0, newPts - rules.deduct);
                }

                const newLevel = getVipLevel(newPts);
                const nextRules = VIP_RELEGATION_RULES[newLevel];
                
                const nextDate = new Date();
                nextDate.setDate(nextDate.getDate() + (nextRules.periodDays || 30));

                relegationBatch.update(doc.ref, {
                    vipGrowthPts: newPts,
                    vipLevel: newLevel,
                    relegationPtsAccumulated: 0, 
                    relegationPeriodEnd: admin.firestore.Timestamp.fromDate(nextDate)
                });
            });

            await relegationBatch.commit();
            console.log(`✅ VIP Check complete.`);
        } catch (error) {
            console.error('❌ Error processing VIPs:', error);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    });

    // Runs every 15 seconds - Ludo Turn Timeout Check
    cron.schedule('*/15 * * * * *', async () => {
        try {
            const thirtySecondsAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 30000);
            
            const staleSessions = await db.collection('ludoSessions')
                .where('status', '==', 'playing')
                .where('updatedAt', '<', thirtySecondsAgo)
                .get();

            if (staleSessions.empty) return;

            const batch = db.batch();
            let count = 0;

            staleSessions.docs.forEach(doc => {
                const session = doc.data();
                const currentTurnColor = session.turn;
                if (!currentTurnColor) return;
                
                const colors = ['red', 'blue', 'green', 'yellow'];
                const turnIndex = colors.indexOf(currentTurnColor);
                const turnPlayer = (session.players || {})[turnIndex];

                if (!turnPlayer) return;

                // Inline helper to advance turn
                const getNextTurnColor = (currentTurn, playersMap, tokensMap) => {
                    let nextPlayerIndex = (colors.indexOf(currentTurn) + 1) % 4;
                    let loopCount = 0;
                    while (loopCount < 4) {
                        const nextColor = colors[nextPlayerIndex];
                        const nextPlayer = playersMap[nextPlayerIndex];
                        if (nextPlayer && nextPlayer.id && !nextPlayer.isBot) {
                            const hasWon = (tokensMap[nextColor] || []).every(t => t.position === 'finished' || t.position === 'abandoned');
                            if (!hasWon) return nextColor;
                        } else if (nextPlayer && nextPlayer.isBot) {
                            const hasWon = (tokensMap[nextColor] || []).every(t => t.position === 'finished' || t.position === 'abandoned');
                            if (!hasWon) return nextColor;
                        }
                        nextPlayerIndex = (nextPlayerIndex + 1) % 4;
                        loopCount++;
                    }
                    return currentTurn;
                };

                const nextTurnColor = getNextTurnColor(currentTurnColor, session.players || {}, session.tokens || {});

                batch.update(doc.ref, {
                    turn: nextTurnColor,
                    diceValue: null,
                    waitingForTokenSelection: false,
                    movableTokenIds: [],
                    updatedAt: admin.firestore.FieldValue.serverTimestamp() // reset timer
                });
                count++;
            });

            if (count > 0) {
                await batch.commit();
                console.log(`✅ Ludo turn timeout applied to ${count} rooms.`);
            }
        } catch (error) {
            console.error('❌ Error checking Ludo timeouts:', error);
        }
    });

    // ==========================================
    // FAMILY: Weekly Activeness Reset — Monday 00:00 IST (Sunday 18:30 UTC)
    // ==========================================
    cron.schedule('30 18 * * 0', async () => {
        console.log('🏠 Resetting Family Weekly Activeness...');
        try {
            const familiesSnap = await db.collection('families').get();
            if (familiesSnap.empty) return;

            for (const familyDoc of familiesSnap.docs) {
                const familyRef = familyDoc.ref;
                const familyData = familyDoc.data();

                // Reset family weekly activeness and claimed rewards
                await familyRef.update({
                    weeklyActiveness: 0,
                    claimedActivenessRewards: [],
                    weeklyResetDate: getWeekStr(),
                });

                // Reset all members' weekly activeness
                const membersSnap = await familyRef.collection('members').get();
                if (!membersSnap.empty) {
                    const batch = db.batch();
                    let count = 0;
                    for (const memberDoc of membersSnap.docs) {
                        batch.update(memberDoc.ref, { weeklyActiveness: 0 });
                        count++;
                        // Firestore batch limit is 500
                        if (count >= 490) {
                            await batch.commit();
                            count = 0;
                        }
                    }
                    if (count > 0) await batch.commit();
                }
            }
            console.log(`✅ Reset weekly activeness for ${familiesSnap.size} families.`);
        } catch (error) {
            console.error('❌ Error resetting family activeness:', error);
        }
    });

    // ==========================================
    // FAMILY: Weekly Rank Calculation — Sunday 23:55 IST (18:25 UTC)
    // ==========================================
    cron.schedule('25 18 * * 0', async () => {
        console.log('🏠 Calculating Family Weekly Ranks...');
        try {
            const familiesSnap = await db.collection('families')
                .orderBy('weeklyActiveness', 'desc')
                .get();

            if (familiesSnap.empty) return;

            const batch = db.batch();
            let rank = 1;
            for (const familyDoc of familiesSnap.docs) {
                batch.update(familyDoc.ref, { weeklyRank: rank });
                rank++;
            }
            await batch.commit();
            console.log(`✅ Assigned ranks to ${familiesSnap.size} families.`);
        } catch (error) {
            console.error('❌ Error calculating family ranks:', error);
        }
    });
}

function getWeekStr() {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((now - startOfYear) / 86400000);
    const weekNumber = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

module.exports = { startCronJobs };