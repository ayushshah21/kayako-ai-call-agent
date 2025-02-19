import { KayakoService } from './kayakoService';
import { ConversationState } from '../conversation/types';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface ResponseOptions {
    streamCallback?: (partialResponse: string) => Promise<void>;
    minConfidence?: number;
}

interface KnowledgeBaseCache {
    articles: any[];
    timestamp: number;
    articleContext: string;
}

interface KayakoArticle {
    id: string;
    titles: Array<{
        id: number;
        translation?: string;
        resource_type: string;
    }>;
    contents: Array<{
        id: number;
        translation?: string;
        resource_type: string;
    }>;
    status: string;
    category?: {
        id: string;
        title: string;
    };
    resource_url: string;
}

interface CommonQA {
    patterns: string[];
    response: string;
    confidence: number;
}

export class ResponseGenerator {
    private kayakoService: KayakoService;
    private genAI: GoogleGenerativeAI;
    private model: any;
    private responseCache: Map<string, {
        response: string;
        timestamp: number;
        confidence: number;
    }> = new Map();
    private knowledgeBaseCache: KnowledgeBaseCache | null = null;
    private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
    private readonly KB_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for KB cache
    private lastGeminiCall: number = 0;
    private readonly RATE_LIMIT_DELAY = 1000; // 1 second between calls

    // Common Q&A patterns for instant responses
    private readonly commonQAs: CommonQA[] = [
        {
            patterns: [
                'reset password',
                'forgot password',
                'change password',
                'password reset',
                'cant login'
            ],
            response: "I can help you reset your password. To do this, please visit the login page and click on 'Forgot Password'. You'll receive an email with reset instructions. Would you like me to send you the reset link now?",
            confidence: 0.95
        },
        {
            patterns: [
                'what is kayako',
                'tell me about kayako',
                'kayako features',
                'kayako product'
            ],
            response: "Kayako is a comprehensive customer service platform that offers help desk solutions. It comes in two versions: Kayako Classic for on-premise deployment, and The New Kayako (TNK) which is a cloud-based SaaS solution. It includes features like multi-channel support, automated workflows, and real-time analytics. Would you like to know more about any specific feature?",
            confidence: 0.95
        },
        {
            patterns: [
                'automation features',
                'automate responses',
                'automatic replies',
                'automation capabilities'
            ],
            response: "Kayako offers several powerful automation features including SLAs for response times, automatic ticket assignment, macro responses for common queries, and end-to-end workflow automation. Which specific automation capability would you like to learn more about?",
            confidence: 0.9
        }
    ];

    // Add instant responses for conversational phrases
    private readonly conversationalResponses: { [key: string]: string } = {
        'i have more questions': "Of course, I'm happy to help. What would you like to know?",
        'can i ask another question': "Absolutely, go ahead!",
        'is that ok': "Yes, of course!",
        'do you understand': "Yes, I understand. Please continue.",
        'are you there': "Yes, I'm here and ready to help.",
        'can you help': "Yes, I'd be happy to help.",
        'thank you': "You're welcome!",
        'thanks': "You're welcome!",
        'ok': "What would you like to know?",
        'alright': "What would you like to know?",
        'i see': "What else would you like to know?",
        'interesting': "What else would you like to know?",
        'got it': "What else would you like to know?"
    };

    constructor() {
        this.kayakoService = new KayakoService();
        this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');
        this.model = this.genAI.getGenerativeModel({
            model: 'gemini-1.5-pro-latest',
            generationConfig: {
                temperature: 0.7,
                topP: 0.9,
                maxOutputTokens: 2048,
            },
        });
        console.log('Initialized Gemini 1.5 Pro model');
        // Pre-fetch articles on startup
        this.initializeKnowledgeBase();
    }

    private async initializeKnowledgeBase() {
        try {
            console.log('Pre-fetching knowledge base articles...');
            await this.refreshKnowledgeBase();
            // Set up periodic refresh
            setInterval(() => this.refreshKnowledgeBase(), this.KB_CACHE_TTL);
        } catch (error) {
            console.error('Error pre-fetching knowledge base:', error);
        }
    }

    private async refreshKnowledgeBase(): Promise<string> {
        console.log('Refreshing knowledge base cache...');
        try {
            const articles = await this.kayakoService.searchArticles('');
            console.log(`Fetched ${articles.length} articles from knowledge base`);

            // Prepare context from all articles
            const articleContext = articles
                .map((article: KayakoArticle) => {
                    const title = article.titles?.[0]?.translation || 'Untitled';
                    const content = article.contents?.[0]?.translation?.replace(/<[^>]*>/g, '') || 'No content available';
                    return `Article [${article.id}]: ${title}\nContent: ${content}`;
                })
                .join('\n\n');

            // Update cache
            this.knowledgeBaseCache = {
                articles,
                timestamp: Date.now(),
                articleContext
            };

            return articleContext;
        } catch (error) {
            console.error('Error refreshing knowledge base:', error);
            // If we have existing cache, use it even if expired
            if (this.knowledgeBaseCache?.articleContext) {
                return this.knowledgeBaseCache.articleContext;
            }
            throw error;
        }
    }

    private matchCommonQA(query: string): { response: string; confidence: number } | null {
        const normalizedQuery = query.toLowerCase();

        for (const qa of this.commonQAs) {
            if (qa.patterns.some(pattern => normalizedQuery.includes(pattern))) {
                return {
                    response: qa.response,
                    confidence: qa.confidence
                };
            }
        }
        return null;
    }

    private checkConversationalResponse(query: string): string | null {
        const normalizedQuery = query.toLowerCase().trim();

        // Check exact matches first
        if (this.conversationalResponses[normalizedQuery]) {
            return this.conversationalResponses[normalizedQuery];
        }

        // Check partial matches
        for (const [phrase, response] of Object.entries(this.conversationalResponses)) {
            if (normalizedQuery.includes(phrase)) {
                return response;
            }
        }

        return null;
    }

    private async callGeminiWithRetry(prompt: string, maxRetries: number = 3): Promise<string> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Rate limiting
                const now = Date.now();
                const timeSinceLastCall = now - this.lastGeminiCall;
                if (timeSinceLastCall < this.RATE_LIMIT_DELAY) {
                    await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY - timeSinceLastCall));
                }

                const result = await Promise.race([
                    this.model.generateContent(prompt),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Gemini request timeout')), 8000)
                    )
                ]);

                this.lastGeminiCall = Date.now();
                return result.response.text();
            } catch (error: any) {
                if (error.status === 429 && attempt < maxRetries) {
                    // Rate limit hit, wait longer before retry
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                    continue;
                }
                throw error;
            }
        }
        throw new Error('Max retries exceeded for Gemini API');
    }

    async generateResponse(
        query: string,
        conversationState: ConversationState,
        options: ResponseOptions = {}
    ): Promise<string> {
        console.log('Starting response generation for query:', query);

        // First, check for conversational responses (fastest path)
        const conversationalResponse = this.checkConversationalResponse(query);
        if (conversationalResponse) {
            console.log('Found instant conversational response');
            return conversationalResponse;
        }

        // Then check common Q&As
        console.log('Checking common Q&As...');
        const commonQA = this.matchCommonQA(query);
        if (commonQA && commonQA.confidence >= (options.minConfidence || 0.7)) {
            console.log('Found matching common Q&A');
            return commonQA.response;
        }

        // Then check response cache
        console.log('Checking response cache...');
        const cacheKey = this.generateCacheKey(query);
        const cachedResponse = this.responseCache.get(cacheKey);
        if (cachedResponse &&
            Date.now() - cachedResponse.timestamp < this.CACHE_TTL &&
            cachedResponse.confidence >= (options.minConfidence || 0.7)) {
            console.log('Found cached response');
            return cachedResponse.response;
        }

        // Get knowledge base context (should be pre-fetched)
        console.log('Getting knowledge base context...');
        let articleContext: string;
        try {
            articleContext = this.knowledgeBaseCache?.articleContext || await this.refreshKnowledgeBase();
            console.log('Successfully retrieved article context');
        } catch (error) {
            console.error('Error getting article context:', error);
            return "I apologize, but I'm having trouble accessing our knowledge base at the moment. Could you please try your question again?";
        }

        // Include conversation history for context
        console.log('Building conversation history...');
        const conversationHistory = conversationState.transcriptHistory
            .map(msg => `${msg.speaker}: ${msg.text}`)
            .join('\n');

        // Construct prompt for more natural responses
        console.log('Constructing Gemini prompt...');
        const prompt = `You are a helpful customer support AI assistant on a phone call.
Use the knowledge base articles below to provide direct, concise responses.
Focus only on answering the specific question asked.

Knowledge Base Articles:
${articleContext}

${conversationHistory ? `Previous Conversation:\n${conversationHistory}\n` : ''}
Customer Query: "${query}"

Guidelines for your response:
1. Answer the question directly and immediately
2. Use at most 2-3 short sentences
3. Only include essential information that directly answers the question
4. No small talk, opinions, or unnecessary explanations
5. Maximum 50 words
6. If you can't find a direct answer, say "I'll need to have our support team help you with that. Could you confirm your email address?"

Response:`;

        try {
            console.log('Sending request to Gemini...');
            const response = await this.callGeminiWithRetry(prompt);

            if (response.toLowerCase().includes("i apologize") && response.toLowerCase().includes("follow up")) {
                conversationState.requiresHumanFollowup = true;
            }

            console.log('Caching response...');
            this.cacheResponse(cacheKey, response, 0.9);
            return response;
        } catch (error: any) {
            console.error('Error in Gemini response generation:', error);
            if (error.message === 'Max retries exceeded for Gemini API') {
                return "I apologize, but our system is experiencing high load right now. Let me connect you with a support agent. Could you please provide your email address?";
            }
            if (error.message === 'Gemini request timeout') {
                return "I apologize, but I'm taking longer than expected to process your request. Could you please try asking your question again?";
            }
            throw new Error('Failed to generate response: ' + error.message);
        }
    }

    private generateCacheKey(query: string): string {
        return query.toLowerCase().trim();
    }

    private cacheResponse(key: string, response: string, confidence: number) {
        this.responseCache.set(key, {
            response,
            timestamp: Date.now(),
            confidence
        });
    }
} 