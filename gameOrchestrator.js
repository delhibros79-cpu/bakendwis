const admin = require("firebase-admin");
const wordBank = require("./word-bank");
const { _updatePlayerStatsOnGameEnd, calculateVoteResult, createOrderedTurnList } = require("./utils/gameHelpers");

async function runGameOrchestrator(before, after, gameRef, sessionId, gameId, db) {
    if (!before || !after) return null;

    const sendSystemMessage = async (sessionId, messageText) => {
        if (!messageText) return;
        try {
            await db.collection("gameSessions").doc(sessionId).collection("chatMessages").add({
                gameSessionId: sessionId,
                senderUserId: 'system',
                messageText: `🔔 ${messageText}`,
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        } catch (e) {
            console.error(`Failed to send system message to ${sessionId}:`, e);
        }
    };

    const getUsernames = async (userIds) => {
        if (userIds.length === 0) return new Map();
        const userDocs = await Promise.all(userIds.map(id => db.collection('userProfiles').doc(id).get()));
        const usernameMap = new Map();
        userDocs.forEach(doc => {
            if (doc.exists) {
                usernameMap.set(doc.id, doc.data()?.username || 'A player');
            } else {
                usernameMap.set(doc.id, 'A player');
            }
        });
        return usernameMap;
    };

    const isStillValid = async (expectedStatus, expectedRound, expectedIndex) => {
        const fresh = await gameRef.get();
        if (!fresh.exists) return false;
        const data = fresh.data();
        if (data.status !== expectedStatus) return false;
        if (expectedRound !== undefined && data.currentRoundNumber !== expectedRound) return false;
        if (expectedIndex !== undefined && data.currentPlayerIndex !== expectedIndex) return false;
        return true;
    };

    // --- NEW HELPER: GENERATE SECURE BOT AUDIO PROXY URL ---
    const getBotAudioUrl = (botId, category, villagerWord, spyWord, roundNumber, turnIndex) => {
        // 🛑 STRICT SECURITY: Return secure proxy URL so secret words (villagerWord_spyWord) are never exposed to clients via Firestore document inspection!
        const backendHost = process.env.BACKEND_URL || "https://who-is-spy-backend.duckdns.org";
        return `${backendHost}/api/bot-audio?sessionId=${encodeURIComponent(sessionId)}&gameId=${encodeURIComponent(gameId)}&botId=${encodeURIComponent(botId)}&roundNumber=${roundNumber}&turnIndex=${turnIndex}&t=${Date.now()}`;
    };

    // --- 0. HANDLE INSTANT SKIP TURN REQUEST ---
    if (after.skipTurnOf && before.skipTurnOf !== after.skipTurnOf) {
        const currentTurnPlayer = after.turnOrder[after.currentPlayerIndex || 0];
        
        if (currentTurnPlayer === after.skipTurnOf && (after.status === 'describing' || after.status === 'pk_describing')) {
            let nextIndex = (after.currentPlayerIndex || 0) + 1;
            const turnOrder = after.turnOrder || [];
            const eliminated = after.eliminatedPlayerIds || [];

            while (nextIndex < turnOrder.length && eliminated.includes(turnOrder[nextIndex])) {
                nextIndex++;
            }

            const updateData = {
                skipTurnOf: admin.firestore.FieldValue.delete(),
                skipTimestamp: admin.firestore.FieldValue.delete(),
                currentBotAudioUrl: admin.firestore.FieldValue.delete()
            };

            if (nextIndex < turnOrder.length) {
                updateData.currentPlayerIndex = nextIndex;
                updateData.descriptionTurnEndsAt = admin.firestore.FieldValue.serverTimestamp();
                
                // Check if skipped to a bot
                const nextSpeakerId = turnOrder[nextIndex];
                const speakerProfile = await db.collection('userProfiles').doc(nextSpeakerId).get();
                if (speakerProfile.data()?.isBot) {
                    updateData.currentBotAudioUrl = getBotAudioUrl(nextSpeakerId, after.gameData.category, after.gameData.villagerWord, after.gameData.spyWord, after.currentRoundNumber || 1, nextIndex);
                }

            } else {
                if (after.status === 'pk_describing') {
                    updateData.status = 'pk_voting';
                    updateData.votes = {};
                    updateData.votingEndsAt = admin.firestore.FieldValue.serverTimestamp();
                } else {
                    updateData.status = 'voting_intro';
                }
            }
            await gameRef.update(updateData);
        } else {
            await gameRef.update({
                skipTurnOf: admin.firestore.FieldValue.delete(),
                skipTimestamp: admin.firestore.FieldValue.delete()
            });
        }
        return null;
    }

    // --- 1. CATEGORY VOTING ---
    if (after.status === 'voting' && before.status !== 'voting' && !after.gameData) {
        await new Promise(r => setTimeout(r, 10000)); 
        if (!(await isStillValid('voting'))) return null;
        
        const freshSnap = await gameRef.get();
        const freshData = freshSnap.data() || {};

        const votes = freshData.categoryVotes || {};
        const voteCounts = Object.values(votes).reduce((acc, category) => {
            acc[category] = (acc[category] || 0) + 1;
            return acc;
        }, {});

        let selectedCategory = "Random"; 
        const categoriesWithVotes = Object.keys(voteCounts);
        if (categoriesWithVotes.length > 0) {
            const maxVotes = Math.max(...Object.values(voteCounts));
            const tiedCategories = categoriesWithVotes.filter(cat => voteCounts[cat] === maxVotes);
            selectedCategory = tiedCategories[Math.floor(Math.random() * tiedCategories.length)];
        } else {
            const availableCats = freshData.votingCategories || ["Random"];
            selectedCategory = availableCats[Math.floor(Math.random() * availableCats.length)];
        }

        const participants = freshData.participants || [];
        const sessionDoc = await db.collection("gameSessions").doc(sessionId).get();
        const gameMode = sessionDoc.data()?.gameMode || 'whos-the-spy';

        let categoryToSearch = selectedCategory;
        const categoryExists = wordBank.categories.some(c => c.name === categoryToSearch);
        if (categoryToSearch === 'Random' || !categoryExists) {
            const randomIndex = Math.floor(Math.random() * wordBank.categories.length);
            categoryToSearch = wordBank.categories[randomIndex].name;
        }

        const categoryData = wordBank.categories.find(c => c.name === categoryToSearch);
        const pairIndex = Math.floor(Math.random() * categoryData.pairs.length);
        const selectedPair = categoryData.pairs[pairIndex];
        
        const turnOrder = createOrderedTurnList(participants, sessionDoc.data()?.players);

        await gameRef.update({
            status: 'category_reveal',
            currentRoundNumber: 1, 
            gameData: {
                category: categoryToSearch, 
                spyId: participants[Math.floor(Math.random() * participants.length)],
                villagerWord: selectedPair.villagerWord,
                spyWord: gameMode === 'wordless-spy' ? '' : selectedPair.spyWord
            },
            turnOrder: turnOrder,
            currentPlayerIndex: 0,
        });

        await sendSystemMessage(sessionId, `The category for this game is "${categoryToSearch}".`);
        return null;
    }

    // --- 2. CATEGORY REVEAL -> WORD REVEAL ---
    if (after.status === 'category_reveal' && before.status !== 'category_reveal') {
        await new Promise(r => setTimeout(r, 3000));
        if (!(await isStillValid('category_reveal'))) return null;
        await gameRef.update({ status: 'word_reveal' });
        return null;
    }

    // --- 3. WORD REVEAL -> DESCRIBING INTRO ---
    if (after.status === 'word_reveal' && before.status !== 'word_reveal') {
        await new Promise(r => setTimeout(r, 3000));
        if (!(await isStillValid('word_reveal'))) return null;
        await gameRef.update({ status: 'describing_intro' });
        return null;
    }

    // --- 4. DESCRIBING INTRO -> START TURN ---
    if (after.status === 'describing_intro' && before.status !== 'describing_intro') {
        await new Promise(r => setTimeout(r, 3000));
        if (!(await isStillValid('describing_intro'))) return null;
        
        let botAudio = null;
        const firstPlayerId = after.turnOrder?.[0];
        
        if (firstPlayerId) {
            const speakerProfile = await db.collection('userProfiles').doc(firstPlayerId).get();
            if (speakerProfile.data()?.isBot) {
                botAudio = getBotAudioUrl(firstPlayerId, after.gameData.category, after.gameData.villagerWord, after.gameData.spyWord, after.currentRoundNumber || 1, 0);
            }
            const usernameMap = await getUsernames([firstPlayerId]);
            const firstPlayerName = usernameMap.get(firstPlayerId) || 'The first player';
            await sendSystemMessage(sessionId, `Round ${after.currentRoundNumber || 1} description has started. ${firstPlayerName} will speak first.`);
        }

        const updateData = { 
            status: 'describing', 
            currentPlayerIndex: 0, 
            descriptionTurnEndsAt: admin.firestore.FieldValue.serverTimestamp() 
        };
        
        if (botAudio) updateData.currentBotAudioUrl = botAudio;
        else updateData.currentBotAudioUrl = admin.firestore.FieldValue.delete();

        await gameRef.update(updateData);
        return null;
    }

    // --- 5. PLAYER TURN (DESCRIBING / PK DESCRIBING) ---
    const isDescribingPhase = after.status === 'describing' || after.status === 'pk_describing';
    const justEnteredDescribing = isDescribingPhase && before.status !== after.status;
    const turnChanged = isDescribingPhase && before.currentPlayerIndex !== after.currentPlayerIndex;

    if (justEnteredDescribing || turnChanged) {
        const currentIndex = after.currentPlayerIndex || 0;
        const currentRound = after.currentRoundNumber || 1;
        
        const sessionDoc = await db.collection("gameSessions").doc(sessionId).get();
        const playersMap = sessionDoc.data()?.players || {};
        const currentSpeakerId = after.turnOrder?.[currentIndex];
        const seatIndex = Object.keys(playersMap).find(k => playersMap[k]?.id === currentSpeakerId);
        
        const isQuit = playersMap[seatIndex]?.quit === true;
        const isOffline = playersMap[seatIndex]?.offline === true;
        
        // If offline or quit, turn is 3 seconds. Otherwise, normal 20 seconds.
        const waitTime = (isQuit || isOffline) ? 3000 : 20000;
        
        await new Promise(r => setTimeout(r, waitTime));
        
        if (!(await isStillValid(after.status, currentRound, currentIndex))) return null;

        let nextIndex = currentIndex + 1;
        const turnOrder = after.turnOrder || [];
        const eliminated = after.eliminatedPlayerIds || [];

        // Only completely skip over players if they are ELIMINATED
        while (nextIndex < turnOrder.length && eliminated.includes(turnOrder[nextIndex])) {
            nextIndex++;
        }

        if (nextIndex < turnOrder.length) {
            const nextSpeakerId = turnOrder[nextIndex];
            let botAudio = null;
            
            const speakerProfile = await db.collection('userProfiles').doc(nextSpeakerId).get();
            if (speakerProfile.data()?.isBot) {
                botAudio = getBotAudioUrl(nextSpeakerId, after.gameData.category, after.gameData.villagerWord, after.gameData.spyWord, after.currentRoundNumber || 1, nextIndex);
            }

            const updatePayload = {
                currentPlayerIndex: nextIndex,
                descriptionTurnEndsAt: admin.firestore.FieldValue.serverTimestamp()
            };
            
            if (botAudio) updatePayload.currentBotAudioUrl = botAudio;
            else updatePayload.currentBotAudioUrl = admin.firestore.FieldValue.delete();
            
            await gameRef.update(updatePayload);
        } else {
            if (after.status === 'pk_describing') {
                await gameRef.update({ 
                    status: 'pk_voting', 
                    votes: {}, 
                    votingEndsAt: admin.firestore.FieldValue.serverTimestamp(),
                    currentBotAudioUrl: admin.firestore.FieldValue.delete()
                });
            } else {
                await gameRef.update({ 
                    status: 'voting_intro',
                    currentBotAudioUrl: admin.firestore.FieldValue.delete()
                });
            }
        }
        return null;
    }

    // --- 6. VOTING INTRO -> VOTING ACTIVE ---
    if (after.status === 'voting_intro' && before.status !== 'voting_intro') {
        await new Promise(r => setTimeout(r, 2000));
        if (!(await isStillValid('voting_intro'))) return null;
        await gameRef.update({ 
            status: 'voting_active', 
            votes: {}, 
            votingEndsAt: admin.firestore.FieldValue.serverTimestamp() 
        });
        await sendSystemMessage(sessionId, 'All players have spoken. Voting will now begin. Please vote for the player you suspect is the spy.');
        return null;
    }

    // --- 7. VOTING ACTIVE -> VOTE REVEAL ---
    const isVotingPhase = after.status === 'voting_active' || after.status === 'pk_voting';
    
    if (isVotingPhase) {
        const allOutOfPlay = [...new Set([...(after.eliminatedPlayerIds || [])])];
        const activeParticipants = after.participants.filter(p => !allOutOfPlay.includes(p));
        
        let eligibleVoterCount = activeParticipants.length;
        if (after.status === 'pk_voting') {
            const pkIds = after.pkPlayers || [];
            eligibleVoterCount = activeParticipants.filter(p => !pkIds.includes(p)).length;
        }

        const currentVotesCount = Object.keys(after.votes || {}).length;

        if (eligibleVoterCount > 0 && currentVotesCount >= eligibleVoterCount) {
            await gameRef.update({ 
                status: 'vote_reveal', 
                voteRevealStartedAt: admin.firestore.FieldValue.serverTimestamp() 
            });
            return null;
        }
    }

    if (isVotingPhase && before.status !== after.status) {
        await new Promise(r => setTimeout(r, 15000));
        
        if (!(await isStillValid(after.status))) return null;

        await gameRef.update({ 
            status: 'vote_reveal', 
            voteRevealStartedAt: admin.firestore.FieldValue.serverTimestamp() 
        });
        return null;
    }

    // --- 8. VOTE REVEAL -> CALCULATE RESULTS ---
    if (after.status === 'vote_reveal' && before.status !== 'vote_reveal') {
        const votes = after.votes || {};
        const voteEntries = Object.entries(votes);
        if (voteEntries.length > 0) {
            const allUserIdsInVotes = Array.from(new Set(voteEntries.flat()));
            const usernameMap = await getUsernames(allUserIdsInVotes);
            const voteSummary = voteEntries.map(([voterId, votedId]) => {
                const voterName = usernameMap.get(voterId) || 'Someone';
                const votedName = usernameMap.get(votedId) || 'someone';
                return `${voterName} voted for ${votedName}`;
            }).join('. ');
            await sendSystemMessage(sessionId, `Votes revealed: ${voteSummary}.`);
        } else {
            await sendSystemMessage(sessionId, 'No votes were cast in this round.');
        }

        await new Promise(r => setTimeout(r, 5000));
        if (!(await isStillValid('vote_reveal'))) return null;

        const result = calculateVoteResult(after); 
        let { status: nextStatus, eliminatedPlayerId, pkPlayers } = result;

        const allOutOfPlay = [...new Set([...(after.eliminatedPlayerIds || [])])];
        const activeParticipants = after.participants.filter(p => !allOutOfPlay.includes(p));

        if (nextStatus === 'result_tie' && pkPlayers && pkPlayers.length === activeParticipants.length) {
            nextStatus = 'result_no_majority';
            pkPlayers = [];
            eliminatedPlayerId = null; 
        }

        const roundNumber = after.currentRoundNumber || 1;
        const wasPkRound = (after.pkPlayers || []).length > 0;
        const roundUpdate = {
            status: nextStatus,
            [`rounds.${roundNumber}.${wasPkRound ? 'pkVotes' : 'votes'}`]: after.votes || {},
        };
        
        if (eliminatedPlayerId) {
            roundUpdate.eliminatedPlayerIds = admin.firestore.FieldValue.arrayUnion(eliminatedPlayerId);
            roundUpdate[`rounds.${roundNumber}.eliminatedPlayerId`] = eliminatedPlayerId;
        }
        if (pkPlayers && pkPlayers.length > 0) {
            roundUpdate.pkPlayers = pkPlayers;
            roundUpdate[`rounds.${roundNumber}.pkPlayers`] = pkPlayers;
        } else if (nextStatus === 'result_no_majority') {
            roundUpdate.pkPlayers = [];
        }

        await gameRef.update(roundUpdate);
        return null;
    }

    // --- 9. RESULTS -> START NEXT ROUND OR COOLING DOWN ---
    if (after.status.startsWith('result_') && before.status !== after.status) {
        if (after.status === 'result_spy_caught' || after.status === 'result_spy_wins') {
            await _updatePlayerStatsOnGameEnd(after, gameId);
            
            if (after.status === 'result_spy_caught') {
                 const spyId = after.gameData?.spyId;
                 const usernames = await getUsernames([spyId]);
                 const spyName = usernames.get(spyId) || 'The Spy';
                 await sendSystemMessage(sessionId, `${spyName} has been eliminated and was the Spy! Villagers win! The words were: Spy - "${after.gameData?.spyWord}", Villager - "${after.gameData?.villagerWord}".`);
            } else {
                const spyId = after.gameData?.spyId;
                const usernames = await getUsernames([spyId]);
                const spyName = usernames.get(spyId) || 'The Spy';
                await sendSystemMessage(sessionId, `${spyName} has won the game! The words were: Spy - "${after.gameData?.spyWord}", Villager - "${after.gameData?.villagerWord}".`);
            }

            await new Promise(r => setTimeout(r, 3000));
            if (!(await isStillValid(after.status))) return null;

            await gameRef.update({ status: 'cooling_down' });
        } 
        else if (after.status === 'result_tie') {
            const pkPlayerNamesMap = await getUsernames(after.pkPlayers || []);
            const pkPlayerNames = Array.from(pkPlayerNamesMap.values());
            await sendSystemMessage(sessionId, `There was a tie between ${pkPlayerNames.join(' and ')}. A PK round will begin.`);
            await new Promise(r => setTimeout(r, 5000)); 
            if (!(await isStillValid(after.status))) return null;

            const sessionDoc = await db.collection("gameSessions").doc(sessionId).get();
            await gameRef.update({
                status: 'pk_describing',
                turnOrder: createOrderedTurnList(after.pkPlayers, sessionDoc.data()?.players),
                currentPlayerIndex: 0,
                descriptionTurnEndsAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        } 
        else {
            if (after.status === 'result_villager_eliminated') {
                const eliminatedId = after.eliminatedPlayerIds[after.eliminatedPlayerIds.length - 1];
                const usernames = await getUsernames([eliminatedId]);
                const eliminatedName = usernames.get(eliminatedId) || 'A player';
                await sendSystemMessage(sessionId, `${eliminatedName} has been eliminated, but was a Villager.`);
            } else { 
                 const allOutOfPlay = [...new Set([...(after.eliminatedPlayerIds || [])])];
                 const activeParticipants = after.participants.filter(p => !allOutOfPlay.includes(p));
                 const votesCasted = Object.keys(after.votes || {}).length;

                 if (after.status === 'result_no_majority' && votesCasted === activeParticipants.length) {
                     await sendSystemMessage(sessionId, 'All players got equal votes, hence no one is eliminated. The game continues.');
                 } else {
                     await sendSystemMessage(sessionId, 'No player received a majority of votes. The game continues.');
                 }
            }
            await new Promise(r => setTimeout(r, 5000)); 
            if (!(await isStillValid(after.status))) return null;

            // --- MAXIMUM 25 ROUNDS LIMIT ---
            const nextRoundNumber = (after.currentRoundNumber || 1) + 1;
            
            if (nextRoundNumber > 25) {
                await sendSystemMessage(sessionId, 'Maximum rounds reached (25)! The Spy survived and wins by default!');
                await gameRef.update({ status: 'result_spy_wins' });
                return null;
            }

            const sessionDoc = await db.collection("gameSessions").doc(sessionId).get();
            const allOutOfPlay = [...new Set([...(after.eliminatedPlayerIds || [])])];
            const activeParticipants = after.participants.filter(p => !allOutOfPlay.includes(p));

            await gameRef.update({
                status: 'describing_intro',
                currentRoundNumber: nextRoundNumber,
                turnOrder: createOrderedTurnList(activeParticipants, sessionDoc.data()?.players),
                currentPlayerIndex: 0,
                votes: {},
                pkPlayers: [],
            });
        }
        
        return null;
    }
    
    // --- 10. COOLING DOWN -> RESET LOBBY ---
    if (after.status === 'cooling_down' && before.status !== 'cooling_down') {
        await new Promise(r => setTimeout(r, 15000));

        const freshSnap = await gameRef.get();
        if(!freshSnap.exists || freshSnap.data()?.status !== 'cooling_down') return null;
        
        const sessionDoc = await db.collection("gameSessions").doc(sessionId).get();
        const sessionData = sessionDoc.data() || {};
        const playersMap = sessionData.players || {};

        const sessionUpdates = {
            status: 'pending',
            readyPlayers: [],
        };

        Object.keys(playersMap).forEach(seatIndex => {
            if (playersMap[seatIndex]?.quit) {
                sessionUpdates[`players.${seatIndex}`] = admin.firestore.FieldValue.delete();
            }
        });

        await db.collection("gameSessions").doc(sessionId).update(sessionUpdates);
        
        return null;
    }

    return null;
}

module.exports = { runGameOrchestrator };