const { AccessToken } = require('livekit-server-sdk');

async function testToken() {
    try {
        const apiKey = 'fake_key';
        const apiSecret = 'fake_secret';
        const at = new AccessToken(apiKey, apiSecret, { identity: 'test_user' });
        at.addGrant({ roomJoin: true, room: 'test_room', canUpdateOwnMetadata: true, canPublish: true, canPublishData: true });
        at.name = "User";
        at.metadata = JSON.stringify({ seat: null });
        
        const token = await at.toJwt();
        console.log("Token generated successfully:", token.substring(0, 20) + "...");
    } catch (e) {
        console.error("Failed to generate token:", e);
    }
}

testToken();
