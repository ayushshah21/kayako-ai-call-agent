import twilio from 'twilio';
import { TwilioRequest, TwilioResponse } from '../types/twilio';
import { ElevenLabsService } from '../services/elevenLabsService';
import { GoogleSpeechService } from '../services/googleSpeechService';
import { KnowledgeBaseService } from '../services/knowledgeBaseService';
import { ConversationManager } from '../conversation/conversationManager';
import WebSocket from 'ws';
import { Readable } from 'stream';
import { ResponseGenerator } from '../services/responseGenerator';

const VoiceResponse = twilio.twiml.VoiceResponse;
const elevenLabs = new ElevenLabsService();
const googleSpeech = new GoogleSpeechService();
const knowledgeBase = new KnowledgeBaseService();
const conversationManager = new ConversationManager();
const responseGenerator = new ResponseGenerator();

// Initialize Twilio client
const client = twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
);

// Track active calls and their streams
const activeCalls: Map<string, {
    ws: WebSocket,
    recognizeStream: any,
    lastResponse: number,
    pendingTranscript: string,
    lastTranscriptTime: number
}> = new Map();

/**
 * Handle incoming voice calls - now with streaming
 */
export const handleIncomingCall = async (req: TwilioRequest, res: TwilioResponse): Promise<void> => {
    const twiml = new VoiceResponse();
    const callSid = req.body.CallSid;
    const phoneNumber = req.body.From;
    console.log('Handling incoming call from:', phoneNumber);

    if (!callSid) {
        console.error('No CallSid provided');
        const errorMessage = 'Sorry, there was an error with your call.';
        twiml.say({
            voice: 'Polly.Amy-Neural',
            language: 'en-GB'
        }, errorMessage);
        res.type('text/xml');
        res.send(twiml.toString());
        return;
    }

    try {
        // Initialize conversation state
        const conversation = conversationManager.initializeConversation(callSid);
        if (phoneNumber) {
            conversation.userInfo.phone = phoneNumber;
        }

        // Start media stream first
        twiml.start().stream({
            name: 'Audio Stream',
            url: `wss://${req.get('host')}/media/${callSid}`,
            track: 'inbound_track'
        });

        // Initial greeting
        const greeting = 'Hi! How can I help you today?';
        twiml.say({
            voice: 'Polly.Amy-Neural',
            language: 'en-GB'
        }, greeting);

        // Record the AI's greeting in conversation history
        conversationManager.addToHistory(callSid, 'ai', greeting);

        // Add a long pause to keep the connection open
        twiml.pause({ length: 120 });

        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error('Error in handleIncomingCall:', error);
        const errorMessage = 'Sorry, please try again.';
        twiml.say({
            voice: 'Polly.Amy-Neural',
            language: 'en-GB'
        }, errorMessage);

        if (callSid) {
            conversationManager.addToHistory(callSid, 'ai', errorMessage);
        }

        res.type('text/xml');
        res.send(twiml.toString());
    }
};

/**
 * Handle media stream connection
 */
export const handleMediaStream = (ws: WebSocket, callSid: string) => {
    console.log('Media stream connected for call:', callSid);
    let isCallActive = true;
    let isProcessingResponse = false;

    // Set up Google Speech streaming
    const recognizeStream = googleSpeech.createStreamingRecognition();

    // Track this call's streams
    activeCalls.set(callSid, {
        ws,
        recognizeStream,
        lastResponse: Date.now(),
        pendingTranscript: '',
        lastTranscriptTime: Date.now()
    });

    // Handle incoming media
    ws.on('message', async (message: any) => {
        if (!isCallActive) return;

        try {
            const msg = JSON.parse(message);
            if (msg.event === 'media' && isCallActive) {
                // Convert Twilio's base64 audio to a buffer
                const audioBuffer = Buffer.from(msg.media.payload, 'base64');

                // Only write if stream is writable and not destroyed
                if (recognizeStream && !recognizeStream.destroyed && recognizeStream.writable) {
                    recognizeStream.write(audioBuffer);
                }
            } else if (msg.event === 'stop') {
                console.log('Media stream stopped by Twilio');
                isCallActive = false;
                await cleanupCall(callSid);
            }
        } catch (error) {
            console.error('Error processing media:', error);
        }
    });

    // Handle stream end
    ws.on('close', async () => {
        console.log('Media stream closed for call:', callSid);
        isCallActive = false;
        await cleanupCall(callSid);
    });

    // Handle errors
    ws.on('error', async (error) => {
        console.error('WebSocket error:', error);
        isCallActive = false;
        await cleanupCall(callSid);
    });

    recognizeStream.on('error', (error: { code?: string }) => {
        // Only log non-destroyed stream errors
        if (error.code !== 'ERR_STREAM_DESTROYED' && isCallActive) {
            console.error('Recognition stream error:', error);
        }
    });

    // Handle transcription results with interruption support
    recognizeStream.on('data', async (data: any) => {
        const callData = activeCalls.get(callSid);
        if (!callData || !isCallActive) return;

        const result = data.results[0];
        if (!result) return;

        const transcription = result.alternatives[0].transcript;
        const now = Date.now();

        // Update the pending transcript
        if (result.isFinal) {
            // Check for user interruption - if we detect speech while processing a response
            if (isProcessingResponse && transcription.trim().length > 5) {
                isProcessingResponse = false;

                // Immediately stop current response and process new input
                const twiml = new VoiceResponse();
                const gather = twiml.gather({
                    input: ['speech'],
                    timeout: 15,
                    action: '/voice/continue',
                    actionOnEmptyResult: true
                });

                // Process the interruption immediately
                callData.pendingTranscript = transcription;
                callData.lastTranscriptTime = now;
            } else {
                callData.pendingTranscript += ' ' + transcription;
                callData.lastTranscriptTime = now;
            }
            console.log('Accumulated transcription:', callData.pendingTranscript);
        }

        // Check if we should process the accumulated transcript
        const timeSinceLastTranscript = now - callData.lastTranscriptTime;
        const hasCompleteSentence = isCompleteSentence(callData.pendingTranscript);
        const isLongEnoughPause = timeSinceLastTranscript > 1500;

        if (result.isFinal &&
            callData.pendingTranscript.trim() &&
            (hasCompleteSentence || isLongEnoughPause)) {

            // Avoid responding too frequently
            if (now - callData.lastResponse < 1000) return;

            try {
                const finalTranscript = callData.pendingTranscript.trim();
                console.log('Processing complete query:', finalTranscript);

                // Check if this is a goodbye/end call message
                if (isGoodbyeMessage(finalTranscript)) {
                    const goodbyeResponse = "Thank you for calling Kayako support! Have a great day!";
                    const twiml = new VoiceResponse();
                    twiml.say({
                        voice: 'Polly.Amy-Neural',
                        language: 'en-GB'
                    }, goodbyeResponse);

                    // Add a brief pause before hanging up
                    twiml.pause({ length: 1 });
                    twiml.hangup();

                    // Send final response
                    await client.calls(callSid)
                        .update({
                            twiml: twiml.toString()
                        });

                    // Clean up the call
                    isCallActive = false;
                    await cleanupCall(callSid);
                    return;
                }

                // Add user's complete message to conversation history
                conversationManager.addToHistory(callSid, 'user', finalTranscript);

                // Get conversation state
                const conversationState = conversationManager.getConversation(callSid);
                if (!conversationState) return;

                // Mark that we're processing a response
                isProcessingResponse = true;

                // Start response generation immediately
                let responsePromise = responseGenerator.generateResponse(
                    finalTranscript,
                    conversationState,
                    {
                        streamCallback: async (partial) => {
                            console.log('Received partial response:', partial);
                        }
                    }
                );

                // Set up a race between response generation and a delay
                const ACKNOWLEDGMENT_DELAY = 2000; // 2 seconds
                const acknowledgmentTimer = new Promise(resolve => setTimeout(resolve, ACKNOWLEDGMENT_DELAY));

                // Race between getting the response and the acknowledgment timer
                type RaceResult =
                    | { type: 'response'; data: string }
                    | { type: 'timeout' };

                const raceResult = await Promise.race([
                    responsePromise.then(response => ({ type: 'response', data: response } as const)),
                    acknowledgmentTimer.then(() => ({ type: 'timeout' } as const))
                ]) as RaceResult;

                if (raceResult.type === 'timeout') {
                    // Only send acknowledgment if we hit the timeout
                    const searchingTwiml = new VoiceResponse();
                    const gather = searchingTwiml.gather({
                        input: ['speech'],
                        timeout: 15,
                        action: '/voice/continue',
                        actionOnEmptyResult: true
                    });

                    gather.say({
                        voice: 'Polly.Amy-Neural',
                        language: 'en-GB'
                    }, "One moment.");

                    gather.pause({ length: 0.3 });

                    await client.calls(callSid)
                        .update({
                            twiml: searchingTwiml.toString()
                        });
                }

                // Wait for the actual response if we haven't gotten it yet
                const response = raceResult.type === 'response' ?
                    raceResult.data :
                    await responsePromise;

                console.log('Generated response:', response);

                // Add AI's response to conversation history
                conversationManager.addToHistory(callSid, 'ai', response);

                // Construct final response TwiML
                const responseTwiml = new VoiceResponse();
                const responseGather = responseTwiml.gather({
                    input: ['speech'],
                    timeout: 10,
                    action: '/voice/continue',
                    actionOnEmptyResult: true
                });

                responseGather.say({
                    voice: 'Polly.Amy-Neural',
                    language: 'en-GB'
                }, response);

                // Very short natural pause
                responseGather.pause({ length: 0.2 });

                // Keep connection alive with minimal pause
                responseTwiml.pause({ length: 1 });

                console.log('Sending final response...');
                await client.calls(callSid)
                    .update({
                        twiml: responseTwiml.toString()
                    });

                // Reset pending transcript after successful processing
                callData.pendingTranscript = '';
                callData.lastResponse = now;

                // Reset processing flag after response is complete
                isProcessingResponse = false;

            } catch (error) {
                console.error('Error in response generation:', error);
                isProcessingResponse = false;

                // Simplified error response
                const errorTwiml = new VoiceResponse();
                const errorGather = errorTwiml.gather({
                    input: ['speech'],
                    timeout: 10,
                    action: '/voice/continue',
                    actionOnEmptyResult: true
                });

                errorGather.say({
                    voice: 'Polly.Amy-Neural',
                    language: 'en-GB'
                }, "I apologize, could you please repeat your question?");

                await client.calls(callSid)
                    .update({
                        twiml: errorTwiml.toString()
                    });
            }
        }
    });
};

// Helper function to check if a sentence seems complete
function isCompleteSentence(text: string): boolean {
    // Trim the text and convert to lowercase for checking
    const trimmed = text.trim().toLowerCase();

    // If it's too short, it's probably not complete
    if (trimmed.length < 10) return false;

    // Check for sentence-ending punctuation
    if (/[.!?]$/.test(trimmed)) return true;

    // Check for common question patterns
    if (trimmed.startsWith('how') ||
        trimmed.startsWith('what') ||
        trimmed.startsWith('why') ||
        trimmed.startsWith('can') ||
        trimmed.startsWith('could')) {
        return true;
    }

    // Check for natural pause words/phrases
    const pausePatterns = [
        'please',
        'thank you',
        'help me',
        'need help',
        'can you',
        'would you'
    ];

    return pausePatterns.some(pattern => trimmed.includes(pattern));
}

// Helper function to check if a message is a goodbye
function isGoodbyeMessage(text: string): boolean {
    const goodbyePhrases = [
        'goodbye',
        'bye',
        'thank you',
        'thanks',
        'that\'s all',
        'that is all',
        'that\'s it',
        'that will be all',
        'have a good day',
        'end the call'
    ];

    const normalizedText = text.toLowerCase().trim();
    return goodbyePhrases.some(phrase => normalizedText.includes(phrase)) &&
        !normalizedText.includes('question') &&
        !normalizedText.includes('help') &&
        !normalizedText.includes('another');
}

// Clean up function for ending calls
export const endCall = (callSid: string) => {
    cleanupCall(callSid);
};

// Helper function to clean up resources
async function cleanupCall(callSid: string) {
    const callData = activeCalls.get(callSid);
    if (callData) {
        try {
            // Close WebSocket if it's still open
            if (callData.ws && callData.ws.readyState === WebSocket.OPEN) {
                callData.ws.close();
            }

            // Destroy recognition stream if it exists and isn't already destroyed
            if (callData.recognizeStream && !callData.recognizeStream.destroyed) {
                callData.recognizeStream.destroy();
            }

            // Clean up other resources
            activeCalls.delete(callSid);
            knowledgeBase.endConversation(callSid);
            conversationManager.endConversation(callSid);
            console.log('Call resources cleaned up successfully:', callSid);
        } catch (error) {
            console.error('Error during call cleanup:', error);
        }
    }
} 