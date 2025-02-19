import { ConversationState, ConversationResponse, ConversationIntent } from './types';

export class ConversationManager {
    private conversations: Map<string, ConversationState> = new Map();

    /**
     * Initialize or get an existing conversation
     */
    public initializeConversation(callSid: string): ConversationState {
        if (!this.conversations.has(callSid)) {
            const newState: ConversationState = {
                callSid,
                userInfo: {},
                lastResponseTime: Date.now(),
                searchInProgress: false,
                transcriptHistory: [],
                ticketCreated: false,
                requiresHumanFollowup: false
            };
            this.conversations.set(callSid, newState);
        }
        return this.conversations.get(callSid)!;
    }

    /**
     * Add a message to the conversation history
     */
    public addToHistory(callSid: string, speaker: 'user' | 'ai', text: string): void {
        const state = this.getConversation(callSid);
        if (state) {
            state.transcriptHistory.push({
                speaker,
                text,
                timestamp: Date.now()
            });
            state.lastResponseTime = Date.now();
        }
    }

    /**
     * Get the current conversation state
     */
    public getConversation(callSid: string): ConversationState | undefined {
        return this.conversations.get(callSid);
    }

    /**
     * End a conversation and clean up
     */
    public endConversation(callSid: string): void {
        // Only remove the conversation if a ticket has been created
        const state = this.getConversation(callSid);
        if (state?.ticketCreated) {
            this.conversations.delete(callSid);
        }
    }
} 