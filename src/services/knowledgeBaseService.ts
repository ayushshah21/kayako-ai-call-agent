import knowledgeBaseData from '../data/knowledge_base.json';

interface ConversationContext {
    lastIntent?: string;
    lastResponse?: string;
    identifiedProblem?: string;
    userEmail?: string;
    ticketCreated?: boolean;
}

interface KnowledgeBaseArticle {
    id: string;
    title: string;
    category: string;
    summary: string;
    content: {
        overview: string;
        solution?: string[];
        steps?: string[] | Record<string, any>;
        important_notes?: string | string[];
        important_notice?: string;
        features?: Record<string, any>;
        default_roles?: Record<string, string>;
        permissions_types?: string[];
        access_methods?: string[];
        form_fields?: string[];
        process?: Record<string, string>;
        [key: string]: any;
    };
    tags: string[];
    faq: Array<{
        question: string;
        answer: string;
    }>;
}

export class KnowledgeBaseService {
    private conversationContexts: Map<string, ConversationContext> = new Map();
    private articles: KnowledgeBaseArticle[];

    constructor() {
        this.articles = knowledgeBaseData.articles as KnowledgeBaseArticle[];
        console.log('Knowledge Base Service initialized with local data:', this.articles.length, 'articles');
    }

    private findRelevantArticles(query: string, limit: number = 3): KnowledgeBaseArticle[] {
        // Convert query to lowercase for case-insensitive matching
        const queryLower = query.toLowerCase();
        const queryTerms = queryLower.split(' ').filter(term => term.length > 2);

        // Score and rank articles based on relevance
        const scoredArticles = this.articles.map(article => {
            let score = 0;

            // Check title matches
            if (article.title.toLowerCase().includes(queryLower)) {
                score += 10;
            }

            // Check tag matches
            const tagMatches = article.tags.filter(tag =>
                queryTerms.some(term => tag.toLowerCase().includes(term))
            ).length;
            score += tagMatches * 5;

            // Check content overview matches
            if (article.content.overview.toLowerCase().includes(queryLower)) {
                score += 3;
            }

            // Check FAQ matches
            const faqMatches = article.faq.filter(qa =>
                qa.question.toLowerCase().includes(queryLower) ||
                qa.answer.toLowerCase().includes(queryLower)
            ).length;
            score += faqMatches * 2;

            // Check individual term matches in content
            queryTerms.forEach(term => {
                if (article.content.overview.toLowerCase().includes(term)) {
                    score += 1;
                }
            });

            return { article, score };
        });

        // Sort by score and return top N articles
        return scoredArticles
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(item => item.article);
    }

    private getContextualResponse(query: string, context: ConversationContext, articles: KnowledgeBaseArticle[]): string {
        const queryLower = query.toLowerCase();

        // If we have relevant articles, construct a response
        if (articles.length > 0) {
            const mainArticle = articles[0];

            // Check if there's a direct FAQ match
            const faqMatch = mainArticle.faq.find(qa =>
                qa.question.toLowerCase().includes(queryLower) ||
                queryLower.includes(qa.question.toLowerCase())
            );

            if (faqMatch) {
                return faqMatch.answer;
            }

            // Construct response from article content
            let response = mainArticle.content.overview;

            // Add solution steps if available
            if (mainArticle.content.solution) {
                response += "\n\nHere's how to solve this:\n" +
                    mainArticle.content.solution.map((step, index) =>
                        `${index + 1}. ${step}`
                    ).join('\n');
            }

            // Add important notes if available
            if (mainArticle.content.important_notes) {
                const notes = Array.isArray(mainArticle.content.important_notes)
                    ? mainArticle.content.important_notes.join('\n')
                    : mainArticle.content.important_notes;
                response += `\n\nImportant Note: ${notes}`;
            }

            return response;
        }

        // If no relevant articles found
        context.identifiedProblem = 'no_relevant_articles';
        return "I apologize, but I couldn't find specific information about that. Would you like me to create a support ticket so a human agent can assist you?";
    }

    public async getResponse(callSid: string, query: string): Promise<string> {
        // Get or create conversation context
        let context = this.conversationContexts.get(callSid) || {};
        this.conversationContexts.set(callSid, context);

        // Find relevant articles
        const relevantArticles = this.findRelevantArticles(query);

        // Get contextual response
        const response = this.getContextualResponse(query, context, relevantArticles);

        // Update context
        context.lastResponse = response;

        // If this is the first interaction and no email, ask for it
        if (!context.userEmail && context.identifiedProblem === 'no_relevant_articles') {
            return `${response} To help you with this, could you please provide your email address?`;
        }

        return response;
    }

    public endConversation(callSid: string) {
        this.conversationContexts.delete(callSid);
    }
} 