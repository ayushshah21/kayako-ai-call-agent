import { google } from '@google-cloud/speech/build/protos/protos';

interface KnowledgeBaseArticle {
    id: string;
    title: string;
    content: string;
    keywords: string[];
    category: string;
}

interface ConversationContext {
    lastIntent?: string;
    lastResponse?: string;
    identifiedProblem?: string;
    userEmail?: string;
    ticketCreated?: boolean;
}

// Mock knowledge base articles
const mockArticles: KnowledgeBaseArticle[] = [
    {
        id: 'pwd-reset-1',
        title: 'How to Reset Your Password',
        content: 'To reset your password, visit our login page and click "Forgot Password". You\'ll receive an email with reset instructions.',
        keywords: ['password', 'reset', 'forgot', 'change', 'login'],
        category: 'account'
    },
    {
        id: 'pwd-reset-2',
        title: 'Password Reset Email Not Received',
        content: 'If you haven\'t received the password reset email: 1) Check your spam folder, 2) Verify your email address is correct, 3) Wait 5-10 minutes and try again.',
        keywords: ['password', 'reset', 'email', 'not received', 'spam'],
        category: 'account'
    },
    {
        id: 'pwd-requirements',
        title: 'Password Requirements',
        content: 'Your password must be at least 8 characters long and include: 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.',
        keywords: ['password', 'requirements', 'rules', 'criteria'],
        category: 'account'
    }
];

export class KnowledgeBaseService {
    private conversationContexts: Map<string, ConversationContext> = new Map();

    constructor() {
        console.log('Knowledge Base Service initialized with mock data');
    }

    private findRelevantArticle(query: string): KnowledgeBaseArticle | null {
        // Convert query to lowercase for better matching
        const queryLower = query.toLowerCase();

        // Find articles with matching keywords
        const matchingArticles = mockArticles.filter(article =>
            article.keywords.some(keyword => queryLower.includes(keyword))
        );

        if (matchingArticles.length === 0) return null;

        // Return the most relevant article (in a real implementation, we'd use proper relevance scoring)
        return matchingArticles[0];
    }

    private getContextualResponse(transcription: string, context: ConversationContext): string {
        const queryLower = transcription.toLowerCase();

        // Check if user is stating they can't receive emails or mentions spam
        if (queryLower.includes('spam') || queryLower.includes('not received') || queryLower.includes('no email')) {
            const article = this.findRelevantArticle('email not received');
            context.identifiedProblem = 'email_not_received';
            return article?.content || 'Please check your spam folder for the reset email. If you still haven\'t received it, I can help you create a support ticket.';
        }

        // Check if user is asking about password requirements
        if (queryLower.includes('requirements') || queryLower.includes('rules') || queryLower.includes('what should')) {
            const article = this.findRelevantArticle('requirements');
            context.identifiedProblem = 'password_requirements';
            return article?.content || 'Let me explain the password requirements...';
        }

        // Default to general password reset help
        const article = this.findRelevantArticle('reset');
        context.identifiedProblem = 'password_reset';
        return article?.content || 'I can help you reset your password. Would you like me to send you a reset link?';
    }

    public async getResponse(callSid: string, transcription: string): Promise<string> {
        // Get or create conversation context
        let context = this.conversationContexts.get(callSid) || {};
        this.conversationContexts.set(callSid, context);

        // Get contextual response
        const response = this.getContextualResponse(transcription, context);

        // Update context
        context.lastIntent = 'password_reset';
        context.lastResponse = response;

        // If this is the first interaction, ask for email
        if (!context.userEmail) {
            return `${response} To help you with this, could you please provide your email address?`;
        }

        return response;
    }

    public endConversation(callSid: string) {
        this.conversationContexts.delete(callSid);
    }
} 