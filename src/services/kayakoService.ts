import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

interface KayakoConfig {
    baseUrl: string;
    username: string;
    password: string;
}

interface KayakoArticle {
    id: string;
    titles: Array<{
        id: number;
        text?: string;
        resource_type: string;
    }>;
    contents: Array<{
        id: number;
        text?: string;
        resource_type: string;
    }>;
    status: string;
    category?: {
        id: string;
        title: string;
    };
    resource_url: string;
}

enum TicketPriority {
    URGENT = 4,   // For human agent escalation
    NORMAL = 2    // For informational/AI-handled tickets
}

enum TicketChannel {
    NOTE = 'note'  // Using note for now, can be updated when AI channel is available
}

export class KayakoService {
    private config: KayakoConfig;
    private client: any;

    constructor() {
        this.config = {
            baseUrl: process.env.KAYAKO_API_URL || 'https://doug-test.kayako.com/api/v1',
            username: process.env.KAYAKO_USERNAME || 'anna.kim@trilogy.com',
            password: process.env.KAYAKO_PASSWORD || 'Kayakokayako1?'
        };

        // Initialize axios client with auth headers
        this.client = axios.create({
            baseURL: this.config.baseUrl,
            headers: {
                'Content-Type': 'application/json'
            },
            auth: {
                username: this.config.username,
                password: this.config.password
            }
        });

        console.log('Kayako Service initialized with test instance:', this.config.baseUrl);
    }

    /**
     * Search knowledge base articles
     */
    async searchArticles(query: string): Promise<KayakoArticle[]> {
        try {
            console.log('Fetching all articles...');
            const articlesResponse = await this.client.get('/articles', {
                params: {
                    include: 'category,locale_field',
                    limit: 100
                }
            });

            let articles = articlesResponse.data.data || [];
            console.log(`Found ${articles.length} total articles`);

            // Fetch full content for each article
            const fullArticles = await Promise.all(
                articles.map(async (article: KayakoArticle) => {
                    try {
                        const fullArticleResponse = await this.client.get(article.resource_url, {
                            params: {
                                include: 'category,locale_field'
                            }
                        });
                        console.log(`Fetched full content for article ${article.id}`);
                        return fullArticleResponse.data.data;
                    } catch (error: any) {
                        console.error(`Error fetching article ${article.id}:`, error.message);
                        return article;
                    }
                })
            );

            // Filter if query provided
            if (query.trim()) {
                console.log(`Filtering articles for query: "${query}"`);
                articles = fullArticles.filter((article: KayakoArticle) => {
                    if (!article) return false;
                    const titleText = article.titles?.[0]?.text || '';
                    const contentText = article.contents?.[0]?.text || '';
                    const searchText = `${titleText} ${contentText}`.toLowerCase();
                    return query.toLowerCase().split(' ').every(term => searchText.includes(term));
                });
            } else {
                articles = fullArticles;
            }

            return articles.filter((article: { status: string; } | null): article is KayakoArticle =>
                article !== null && article.status === 'PUBLISHED'
            );
        } catch (error) {
            console.error('Error searching articles:', error);
            if ((error as any).response?.data) {
                console.error('API Response:', JSON.stringify((error as any).response.data, null, 2));
            }
            throw error;
        }
    }

    /**
     * Get article by ID
     */
    async getArticle(articleId: string): Promise<KayakoArticle> {
        try {
            const response = await this.client.get(`/articles/${articleId}`, {
                params: {
                    include: 'category'
                }
            });

            return response.data.data;
        } catch (error) {
            console.error('Error fetching Kayako article:', error);
            throw error;
        }
    }

    /**
     * Create a support ticket with appropriate priority
     */
    async createTicket(data: {
        subject: string;
        description: string;
        email: string;
        fullName?: string;
        phone?: string;
        requiresHumanAgent?: boolean;
    }) {
        try {
            const response = await this.client.post('/cases', {
                subject: data.subject,
                channel: TicketChannel.NOTE,
                description: data.description,
                requester: {
                    email: data.email,
                    fullName: data.fullName,
                    phone: data.phone
                },
                status: 'open',
                priority_id: data.requiresHumanAgent ? TicketPriority.URGENT : TicketPriority.NORMAL,
                type: 'question',
                // Add metadata to identify AI-created tickets
                custom_fields: {
                    source: 'ai_agent',
                    requires_human: data.requiresHumanAgent ? 'yes' : 'no'
                }
            });

            console.log(`Created ${data.requiresHumanAgent ? 'urgent' : 'normal'} ticket:`, response.data.data.id);
            return response.data.data;
        } catch (error) {
            console.error('Error creating Kayako ticket:', error);
            throw error;
        }
    }

    /**
     * Add a conversation to an existing case
     */
    async addConversation(caseId: string, message: string) {
        try {
            const response = await this.client.post(`/cases/${caseId}/posts`, {
                content: message,
                channel: TicketChannel.NOTE,
                resource_type: 'case_post'
            });

            return response.data.data;
        } catch (error) {
            console.error('Error adding conversation to case:', error);
            throw error;
        }
    }

    /**
     * Get category articles
     */
    async getCategoryArticles(categoryId: string): Promise<KayakoArticle[]> {
        try {
            const response = await this.client.get(`/categories/${categoryId}/articles`, {
                params: {
                    status: 'published'
                }
            });

            return response.data.data;
        } catch (error) {
            console.error('Error fetching category articles:', error);
            throw error;
        }
    }

    /**
     * Get all categories
     */
    async getCategories() {
        try {
            const response = await this.client.get('/categories', {
                params: {
                    status: 'published'
                }
            });

            return response.data.data;
        } catch (error) {
            console.error('Error fetching categories:', error);
            throw error;
        }
    }
} 