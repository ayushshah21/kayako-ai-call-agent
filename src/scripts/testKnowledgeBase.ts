import 'dotenv/config';
import { ResponseGenerator } from '../services/responseGenerator';
import { KayakoService } from '../services/kayakoService';
import { ConversationState } from '../conversation/types';

async function testKnowledgeBaseIntegration() {
    console.log('🚀 Starting Knowledge Base Integration Test\n');

    // Initialize services
    const kayako = new KayakoService();
    const responseGenerator = new ResponseGenerator();

    try {
        // Step 1: Test direct Kayako API access
        console.log('📚 Testing Kayako Knowledge Base Access...');
        const allArticles = await kayako.searchArticles('');
        console.log(`\nFound ${allArticles.length} articles in knowledge base`);

        if (allArticles.length > 0) {
            console.log('\n📚 Knowledge Base Articles:\n');
            allArticles.forEach((article: any, index: number) => {
                // Skip articles with no meaningful content or test articles
                const content = article.contents?.[0]?.translation?.replace(/<[^>]*>/g, '') || '';
                const title = article.titles?.[0]?.translation || '';

                if (!content.trim() ||
                    title.toLowerCase().includes('test') ||
                    content.toLowerCase().includes('test change') ||
                    content.includes('@keyframes')) {
                    return;
                }

                console.log(`\n=== Article ${index + 1} ===`);
                console.log(`ID: ${article.id}`);
                console.log(`Title: ${title}`);
                console.log('Content:');
                console.log(content);
                console.log('\n---');
            });

            // Update test queries based on actual content
            const testQueries = [
                {
                    name: 'Password Reset Process',
                    query: 'What are the steps to reset my password in OmniTrack CRM?',
                    history: []
                },
                {
                    name: 'Automation Capabilities',
                    query: 'What automation features does Kayako offer for customer responses?',
                    history: []
                },
                {
                    name: 'Macro Usage',
                    query: 'How can I use macros to automate common replies in conversations?',
                    history: []
                },
                {
                    name: 'Product Information',
                    query: 'What are the main differences between Kayako Classic and The New Kayako?',
                    history: []
                },
                {
                    name: 'SLA Management',
                    query: 'How can I set up and manage SLAs for response times?',
                    history: []
                }
            ];

            console.log('\n🧪 Testing Queries Against Knowledge Base\n');

            for (const test of testQueries) {
                console.log(`\n📝 Testing: ${test.name}`);
                console.log(`Query: ${test.query}`);

                // Create conversation state
                const conversationState: ConversationState = {
                    callSid: `test-${Date.now()}`,
                    userInfo: {},
                    lastResponseTime: Date.now(),
                    searchInProgress: false,
                    transcriptHistory: test.history,
                    ticketCreated: false,
                    requiresHumanFollowup: false
                };

                try {
                    // Generate response using the full knowledge base
                    const response = await responseGenerator.generateResponse(
                        test.query,
                        conversationState
                    );

                    console.log('\nResponse:', response);
                    console.log('Requires Human Followup:', conversationState.requiresHumanFollowup);
                } catch (error) {
                    console.error('Error generating response:', error);
                }

                console.log('\n-------------------------------------------');
            }

        }

    } catch (error) {
        console.error('Test failed:', error);
    }
}

// Run the test
console.log('Starting Knowledge Base Integration Test...\n');
testKnowledgeBaseIntegration().catch(console.error); 