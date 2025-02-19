import 'dotenv/config';
import { ResponseGenerator } from '../services/responseGenerator';
import { ConversationState } from '../conversation/types';

async function testGeminiIntegration() {
    console.log('🚀 Starting Gemini Integration Tests...\n');
    const responseGenerator = new ResponseGenerator();

    // Test cases with varying complexity
    const testCases = [
        {
            name: 'Simple Query',
            query: 'How do I reset my password?',
            history: []
        },
        {
            name: 'Multi-part Query',
            query: 'I need help with two-factor authentication and password recovery',
            history: []
        },
        {
            name: 'Context-dependent Query',
            query: 'Is there anything else I should know about security?',
            history: [
                { speaker: 'user' as const, text: 'How do I enable two-factor authentication?', timestamp: Date.now() - 4000 },
                { speaker: 'ai' as const, text: 'To enable two-factor authentication, go to your account settings and look for the Security section. You\'ll find the 2FA option there. Would you like me to walk you through the setup process?', timestamp: Date.now() - 3000 },
                { speaker: 'user' as const, text: 'Yes, please explain the setup process', timestamp: Date.now() - 2000 },
                { speaker: 'ai' as const, text: 'First, you\'ll need to download an authenticator app like Google Authenticator or Authy. Then, in your account security settings, click "Enable 2FA". You\'ll see a QR code - scan this with your authenticator app. Enter the 6-digit code shown in your app to verify. Make sure to save your backup codes in case you lose access to your authenticator app.', timestamp: Date.now() - 1000 }
            ]
        }
    ];

    for (const testCase of testCases) {
        console.log(`\n🧪 Testing: ${testCase.name}`);
        console.log('Query:', testCase.query);

        if (testCase.history.length > 0) {
            console.log('\nConversation History:');
            testCase.history.forEach(msg => {
                console.log(`${msg.speaker}: ${msg.text}`);
            });
        }

        try {
            const conversationState: ConversationState = {
                callSid: `test-${Date.now()}`,
                userInfo: {},
                lastResponseTime: Date.now(),
                searchInProgress: false,
                transcriptHistory: testCase.history,
                ticketCreated: false,
                requiresHumanFollowup: false,
                lastQuery: testCase.query
            };

            console.log('\nGenerating response...');
            const response = await responseGenerator.generateResponse(
                testCase.query,
                conversationState
            );

            console.log('\n✅ Response:', response);
        } catch (error) {
            console.error('\n❌ Error:', error);
        }

        console.log('\n-------------------------------------------');
    }
}

// Run the tests
testGeminiIntegration().catch(console.error); 