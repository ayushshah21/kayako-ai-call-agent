// Types for conversation state management
export interface ConversationState {
    callSid: string;
    currentIntent?: string;
    lastQuery?: string;
    userInfo: {
        email?: string;
        name?: string;
        phone?: string;
    };
    lastResponseTime: number;
    searchInProgress: boolean;
    identifiedIssue?: string;
    transcriptHistory: Array<{
        speaker: 'user' | 'ai';
        text: string;
        timestamp: number;
    }>;
    ticketCreated: boolean;
    requiresHumanFollowup: boolean;
}

// Types for different kinds of responses we might give
export interface ConversationResponse {
    speech: string;  // What we'll say to the user
    responseType: 'immediate' | 'searching' | 'not_found' | 'collecting_info' | 'confirming';
    requiresFollowUp: boolean;
    sourceArticle?: {
        id: string;
        title: string;
        relevance: number;
    };
    nextAction?: 'collect_email' | 'confirm_understanding' | 'create_ticket' | 'end_call';
}

// Types of intents we can handle
export enum ConversationIntent {
    // Knowledge Base Queries
    PASSWORD_RESET = 'password_reset',
    TICKET_STATUS = 'ticket_status',
    CREATE_TICKET = 'create_ticket',
    GENERAL_QUERY = 'general_query',

    // Information Collection
    PROVIDE_EMAIL = 'provide_email',
    CONFIRM_INFO = 'confirm_info',

    // Flow Control
    FOLLOW_UP = 'follow_up',
    CLARIFICATION = 'clarification',
    END_CONVERSATION = 'end_conversation',

    // Fallback
    UNKNOWN = 'unknown'
}

// Represents a ticket to be created in Kayako
export interface TicketCreationData {
    subject: string;
    description: string;
    userInfo: {
        email: string;
        name?: string;
        phone?: string;
    };
    transcriptHistory: ConversationState['transcriptHistory'];
    identifiedIssue?: string;
    requiresHumanFollowup: boolean;
    sourceArticle?: ConversationResponse['sourceArticle'];
} 