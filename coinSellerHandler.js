const express = require('express');
const rateLimit = require('express-rate-limit');

const transferLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // limit each IP to 5 transfer requests per minute
  message: { success: false, message: 'Too many transfer requests from this IP. Please try again after a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function setupCoinSellerRoutes(app, db, admin) {
  
  // Endpoint to transfer coins from a seller to a user (with rate limiting)
  app.post('/api/seller/transfer-coins', transferLimiter, async (req, res) => {
    try {
      // 1. Authenticate user
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Missing or invalid token' });
      }

      const idToken = authHeader.split('Bearer ')[1];
      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } catch (error) {
        console.error('Token verification error:', error);
        return res.status(401).json({ success: false, message: 'Unauthorized: Invalid token' });
      }

      const senderId = decodedToken.uid;
      const { recipientId, amount } = req.body;

      // Validate inputs
      const parsedAmount = parseInt(amount, 10);
      if (!recipientId || isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid recipient ID or amount' });
      }

      // 2. Perform Transaction
      const result = await db.runTransaction(async (transaction) => {
        const senderRef = db.collection('userProfiles').doc(senderId);
        const recipientRef = db.collection('userProfiles').doc(recipientId);

        const senderDoc = await transaction.get(senderRef);
        if (!senderDoc.exists) {
          throw new Error('Sender not found');
        }

        const senderData = senderDoc.data();

        // 3. Check Permissions
        if (senderData.isCoinSeller !== true) {
          throw new Error('Unauthorized: Not a registered coin seller');
        }

        // 4. Verify Balance (Use panelCoins instead of coins)
        const senderPanelCoins = senderData.panelCoins || 0;
        if (senderPanelCoins < parsedAmount) {
          throw new Error('Insufficient panel coins');
        }

        const recipientDoc = await transaction.get(recipientRef);
        if (!recipientDoc.exists) {
           throw new Error('Recipient not found');
        }
        
        const recipientData = recipientDoc.data();
        const recipientCoins = recipientData.coins || 0;

        // 5. Update Balances
        // Deduct from sender's panelCoins
        transaction.update(senderRef, { panelCoins: senderPanelCoins - parsedAmount });
        // Add to recipient's regular coins
        transaction.update(recipientRef, { coins: recipientCoins + parsedAmount });

        // 6. Log Transfer
        const transferRef = db.collection('coin_transfers').doc();
        transaction.set(transferRef, {
          senderId: senderId,
          recipientId: recipientId,
          amount: parsedAmount,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          status: 'completed',
          recipientName: recipientData.name || recipientData.username || 'Unknown User',
          recipientDisplayId: recipientData.displayId || 'Unknown ID'
        });

        return { success: true, message: 'Coins transferred successfully', newBalance: senderPanelCoins - parsedAmount };
      });

      res.status(200).json(result);

    } catch (error) {
      console.error('Error transferring coins:', error);
      const status = error.message.includes('Unauthorized') || 
                     error.message.includes('Insufficient') || 
                     error.message.includes('not found') ? 400 : 500;
      res.status(status).json({ success: false, message: error.message || 'Internal server error' });
    }
  });

  // Verify a user exists by displayId (to show their name/pic before transfer)
  app.get('/api/seller/verify-user/:displayId', async (req, res) => {
    try {
        const { displayId } = req.params;
        const numericId = parseInt(displayId, 10);
        
        // Query by displayId instead of document ID. 
        // Firestore is strictly typed, so we must check both string and number representations.
        const searchValues = isNaN(numericId) ? [displayId] : [displayId, numericId];
        const snapshot = await db.collection('userProfiles').where('displayId', 'in', searchValues).limit(1).get();
        
        if (snapshot.empty) {
            return res.status(404).json({ success: false, message: 'User not found with this Display ID' });
        }

        const userDoc = snapshot.docs[0];
        const data = userDoc.data();
        
        return res.status(200).json({ 
            success: true, 
            user: { 
                id: userDoc.id, // We need to return the actual document ID for the transfer route
                name: data.name || data.username || 'Unknown User', 
                profilePicture: data.profilePicture || data.photoURL || null,
                displayId: data.displayId
            } 
        });
    } catch (error) {
        console.error('Error verifying user:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // Fetch transaction history for the logged-in seller
  app.get('/api/seller/history', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Missing or invalid token' });
      }

      const idToken = authHeader.split('Bearer ')[1];
      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
      } catch (error) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Invalid token' });
      }

      const senderId = decodedToken.uid;

      // Query past transactions where senderId matches
      const snapshot = await db.collection('coin_transfers')
        .where('senderId', '==', senderId)
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();

      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        // Convert Firestore timestamp to string
        timestamp: doc.data().timestamp ? doc.data().timestamp.toDate().toISOString() : new Date().toISOString()
      }));

      res.status(200).json({ success: true, history });

    } catch (error) {
      console.error('Error fetching history:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = { setupCoinSellerRoutes };
