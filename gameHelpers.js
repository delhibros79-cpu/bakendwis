const admin = require("firebase-admin");

const _updatePlayerStatsOnGameEnd = async (gameData, gameId) => {
    const db = admin.firestore();
    console.log(`Game ${gameId} ended. Updating stats and levels...`);

    const {participants, gameData: gameDetails} = gameData;
    if (!participants || !gameDetails || !gameDetails.spyId) {
      console.error("Missing data for stat update.", { gameId: gameId });
      return;
    }

    const spyId = gameDetails.spyId;
    const spyWon = gameData.status === "result_spy_wins";
    const villagersWon = gameData.status === "result_spy_caught";

    const playerUpdatePromises = participants.map(async (playerId) => {
        const playerDocRef = db.collection("userProfiles").doc(playerId);
        
        try {
            await db.runTransaction(async (transaction) => {
                const playerDoc = await transaction.get(playerDocRef);
                if (!playerDoc.exists) {
                    throw new Error(`User profile for ${playerId} not found.`);
                }

                const playerData = playerDoc.data();
                const isPlayerSpy = playerId === spyId;
                const didPlayerWin = (isPlayerSpy && spyWon) || (!isPlayerSpy && villagersWon);

                let xpGained = 10; // +10 for playing
                if (didPlayerWin) {
                    xpGained += 30; // +30 for winning
                    if (isPlayerSpy) {
                        xpGained += 40; // +40 for surviving as spy
                    } else {
                        xpGained += 20; // +20 for correctly guessing spy
                    }
                }
                
                const currentXp = playerData.xp || 0;
                const newXp = currentXp + xpGained;
                const newLevel = Math.floor(Math.sqrt(newXp / 100)) + 1;
                
                const statsUpdate = {
                    gamesPlayed: admin.firestore.FieldValue.increment(1),
                    xp: newXp,
                    level: newLevel,
                };
                
                if (didPlayerWin) {
                    statsUpdate.wins = admin.firestore.FieldValue.increment(1);
                }

                transaction.update(playerDocRef, statsUpdate);
                console.log(`Queued transaction for player ${playerId}: `, {xpGained, newXp, newLevel, didPlayerWin});
            });
        } catch (error) {
             console.error(`Error updating stats for player ${playerId}:`, error);
        }
        return;
    });
    
    await Promise.all(playerUpdatePromises);
    console.log("Finished updating stats for all players.");
};


const calculateVoteResult = (gameData) => {
    const votes = gameData.votes || {};
    const wasPkRound = (gameData.pkPlayers || []).length > 0;
    const voteCounts = Object.values(votes).reduce((acc, votedId) => {
        acc[votedId] = (acc[votedId] || 0) + 1;
        return acc;
    }, {});
    
    const currentParticipants = wasPkRound 
        ? gameData.pkPlayers
        : gameData.participants.filter((pId) => !(gameData.eliminatedPlayerIds || []).includes(pId));

    let maxVotes = 0;
    let mostVotedPlayerIds = [];
    for (const playerId in voteCounts) {
        if (currentParticipants.includes(playerId)) {
            if (voteCounts[playerId] > maxVotes) {
                maxVotes = voteCounts[playerId];
                mostVotedPlayerIds = [playerId];
            } else if (voteCounts[playerId] === maxVotes && maxVotes > 0) {
                mostVotedPlayerIds.push(playerId);
            }
        }
    }

    const spyId = gameData.gameData.spyId;
    let nextStatus = '';
    let eliminatedPlayerId = null;
    let pkPlayers = null;

    if (mostVotedPlayerIds.length === 0 || maxVotes === 0) {
        nextStatus = 'result_no_majority';
    } else if (mostVotedPlayerIds.length > 1) {
        if (wasPkRound) {
            nextStatus = 'result_no_majority'; // No PK after a PK
        } else {
            nextStatus = 'result_tie';
            pkPlayers = mostVotedPlayerIds;
        }
    } else {
        eliminatedPlayerId = mostVotedPlayerIds[0];
        if (eliminatedPlayerId === spyId) {
            nextStatus = 'result_spy_caught';
        } else {
            // A villager was eliminated, check for win condition
            const allEliminated = [...(gameData.eliminatedPlayerIds || []), eliminatedPlayerId];
            const remainingPlayerCount = gameData.participants.filter((pId) => !allEliminated.includes(pId)).length;
            nextStatus = remainingPlayerCount <= 2 ? 'result_spy_wins' : 'result_villager_eliminated';
        }
    }
    
    return { status: nextStatus, eliminatedPlayerId, pkPlayers };
};


const createOrderedTurnList = (participantUIDs, sessionPlayers) => {
    if (!participantUIDs || participantUIDs.length === 0 || !sessionPlayers) return [];
    
    const seatedParticipants = participantUIDs
        .map(uid => {
            const seatIndexStr = Object.keys(sessionPlayers).find(key => sessionPlayers[key]?.id === uid);
            return { uid, seatIndex: seatIndexStr ? parseInt(seatIndexStr, 10) : -1 };
        })
        .filter(p => p.seatIndex !== -1);
        
    seatedParticipants.sort((a, b) => a.seatIndex - b.seatIndex);
    
    const sortedUIDs = seatedParticipants.map(p => p.uid);
    if (sortedUIDs.length === 0) return [];
    
    const startIndex = Math.floor(Math.random() * sortedUIDs.length);
    return [...sortedUIDs.slice(startIndex), ...sortedUIDs.slice(0, startIndex)];
};

// Export the functions for CommonJS
module.exports = {
    _updatePlayerStatsOnGameEnd,
    calculateVoteResult,
    createOrderedTurnList
};
