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
    lastTranscriptTime: number,
    lastActivityTime: number,
    isProcessingResponse: boolean
}> = new Map();

let isFirstChunk = true;
let lastSentLength = 0;
let lastChunkSent = Date.now();
let accumulatedResponse = '';
let isLastChunk = false;

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
    let recognizeStream = googleSpeech.createStreamingRecognition();

    // Track this call's streams
    activeCalls.set(callSid, {
        ws,
        recognizeStream,
        lastResponse: Date.now(),
        pendingTranscript: '',
        lastTranscriptTime: Date.now(),
        lastActivityTime: Date.now(),
        isProcessingResponse: false
    });

    // Handle incoming media
    ws.on('message', async (message: any) => {
        if (!isCallActive) return;

        try {
            const msg = JSON.parse(message);
            if (msg.event === 'media' && isCallActive) {
                // Reset activity timer on any media received
                const callData = activeCalls.get(callSid);
                if (callData) {
                    callData.lastActivityTime = Date.now();
                }

                // Convert Twilio's base64 audio to a buffer
                const audioBuffer = Buffer.from(msg.media.payload, 'base64');

                // Ensure stream is ready and writable
                if (recognizeStream && !recognizeStream.destroyed) {
                    if (!recognizeStream.writable) {
                        // If stream isn't writable, recreate it
                        console.log('Recreating recognition stream for call:', callSid);
                        recognizeStream = googleSpeech.createStreamingRecognition();
                        if (callData) {
                            callData.recognizeStream = recognizeStream;
                        }

                        // Set up the new stream's data handler
                        setupRecognitionStreamHandler(recognizeStream, callSid, callData);
                    }
                    recognizeStream.write(audioBuffer);
                }
            } else if (msg.event === 'stop') {
                console.log('Media stream stopped by Twilio');
                isCallActive = false;
                await cleanupCall(callSid);
            }
        } catch (error: unknown) {
            console.error('Error processing media:', error);
            if (error instanceof Error &&
                (error.message.includes('EPIPE') || error.message.includes('ERR_STREAM_DESTROYED'))) {
                console.log('Recoverable error, continuing...');
                // Try to recreate the stream
                const callData = activeCalls.get(callSid);
                if (callData && isCallActive) {
                    recognizeStream = googleSpeech.createStreamingRecognition();
                    callData.recognizeStream = recognizeStream;
                    setupRecognitionStreamHandler(recognizeStream, callSid, callData);
                }
            } else {
                isCallActive = false;
                await cleanupCall(callSid);
            }
        }
    });

    // Function to set up recognition stream handler
    function setupRecognitionStreamHandler(stream: any, sid: string, callData: any) {
        stream.on('data', async (data: any) => {
            const result = data.results[0];
            if (!result) return;

            const transcription = result.alternatives[0].transcript;
            const now = Date.now();

            // Always log transcription immediately for debugging
            console.log('Real-time transcription:', transcription, 'isFinal:', result.isFinal);

            // Start transcription immediately for any non-empty input
            if (transcription.trim()) {
                // Reset the response timer on any new speech
                callData.lastTranscriptTime = now;

                // For non-final results, check for potential interruptions
                if (!result.isFinal) {
                    // Detect user starting to speak with more lenient criteria
                    if (isProcessingResponse &&
                        transcription.trim().length > 8 && // Reduced from 15 to detect speech earlier
                        !transcription.toLowerCase().match(/^(um|uh|okay|oh)\b/i)) {

                        console.log('User started speaking, stopping current response');
                        // Immediately stop the current response
                        isProcessingResponse = false;

                        // Send a silent gather to stop current speech and start listening
                        const interruptTwiml = new VoiceResponse();
                        const gather = interruptTwiml.gather({
                            input: ['speech'],
                            timeout: 15,
                            action: '/voice/continue',
                            actionOnEmptyResult: true
                        });
                        gather.pause({ length: 0.1 });

                        try {
                            await client.calls(sid).update({
                                twiml: interruptTwiml.toString()
                            });
                            console.log('Successfully interrupted current response');
                        } catch (error) {
                            console.error('Error interrupting response:', error);
                        }

                        // Start preparing for potential response while waiting for final result
                        callData.pendingTranscript = transcription;
                    }
                } else {
                    // For final results, handle with more context
                    if (isProcessingResponse) {
                        // Verify this is a real interruption with slightly relaxed criteria
                        const isRealInterruption =
                            transcription.trim().length > 15 && // Reduced from 20
                            !transcription.toLowerCase().includes('thank') &&
                            !transcription.toLowerCase().match(/^(um|uh|like|so|and|but|okay)\b/i) &&
                            Date.now() - callData.lastResponse > 1500; // Reduced from 2000ms

                        if (isRealInterruption) {
                            console.log('Confirmed interruption detected:', transcription);
                            isProcessingResponse = false;

                            // Process the interruption immediately
                            const finalTranscript = transcription.trim();
                            console.log('Processing confirmed interruption:', finalTranscript);

                            // Add user's message to conversation history
                            conversationManager.addToHistory(sid, 'user', finalTranscript);

                            // Get conversation state and generate response
                            const conversationState = conversationManager.getConversation(sid);
                            if (conversationState) {
                                isProcessingResponse = true;

                                try {
                                    // Generate and handle the response
                                    const responsePromise = responseGenerator.generateResponse(
                                        finalTranscript,
                                        conversationState,
                                        {
                                            streamCallback: async (partial) => {
                                                if (!isCallActive || !isProcessingResponse) return;

                                                const twiml = new VoiceResponse();
                                                twiml.say({
                                                    voice: 'Polly.Amy-Neural',
                                                    language: 'en-GB'
                                                }, partial);

                                                const gather = twiml.gather({
                                                    input: ['speech'],
                                                    timeout: 15,
                                                    action: '/voice/continue',
                                                    actionOnEmptyResult: true
                                                });

                                                await client.calls(sid).update({
                                                    twiml: twiml.toString()
                                                });
                                            }
                                        }
                                    );

                                    const response = await responsePromise;
                                    conversationManager.addToHistory(sid, 'ai', response);
                                    callData.lastResponse = Date.now();
                                } catch (error) {
                                    console.error('Error generating response for interruption:', error);
                                    isProcessingResponse = false;
                                }
                            }
                        }
                    } else {
                        // Update pending transcript for non-interruption case
                        callData.pendingTranscript += ' ' + transcription;
                        callData.lastTranscriptTime = now;
                    }
                }
            }

            // Check if we should process the accumulated transcript with more responsive timing
            const timeSinceLastTranscript = now - callData.lastTranscriptTime;
            const hasCompleteSentence = isCompleteSentence(callData.pendingTranscript);
            const isLongEnoughPause = timeSinceLastTranscript > 600; // Reduced from 800ms

            if (result.isFinal &&
                callData.pendingTranscript.trim() &&
                (hasCompleteSentence || isLongEnoughPause)) {

                // More responsive rate limiting
                if (now - callData.lastResponse < 400) return; // Reduced from 500ms

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
                        await client.calls(sid)
                            .update({
                                twiml: twiml.toString()
                            });

                        // Clean up the call
                        isCallActive = false;
                        await cleanupCall(sid);
                        return;
                    }

                    // Add user's complete message to conversation history
                    conversationManager.addToHistory(sid, 'user', finalTranscript);

                    // Get conversation state
                    const conversationState = conversationManager.getConversation(sid);
                    if (!conversationState) return;

                    // Mark that we're processing a response
                    isProcessingResponse = true;

                    // Track partial responses
                    let accumulatedResponse = '';
                    let lastSentLength = 0;
                    let isFirstChunk = true;
                    let lastChunkSent = Date.now();

                    console.log('Starting response streaming...');

                    // Start response generation immediately
                    const responsePromise = responseGenerator.generateResponse(
                        finalTranscript,
                        conversationState,
                        {
                            streamCallback: async (partial) => {
                                try {
                                    // Don't process if call is no longer active
                                    if (!isCallActive || !isProcessingResponse) {
                                        console.log('Call no longer active or not processing, skipping partial response');
                                        return;
                                    }

                                    // For first chunk or common Q&A responses, send immediately
                                    if (isFirstChunk) {
                                        console.log('First chunk, sending immediate response');

                                        // Wait for a complete thought before sending first chunk
                                        if (partial.length < 15 || !isCompleteSentence(partial)) {
                                            console.log('Waiting for more complete first chunk');
                                            return;
                                        }

                                        const immediateTwiml = new VoiceResponse();
                                        immediateTwiml.say({
                                            voice: 'Polly.Amy-Neural',
                                            language: 'en-GB'
                                        }, partial);

                                        // Add gather after response to keep listening
                                        const gather = immediateTwiml.gather({
                                            input: ['speech'],
                                            timeout: 15,
                                            action: '/voice/continue',
                                            actionOnEmptyResult: true
                                        });

                                        console.log('Sending first complete chunk:', partial);
                                        await client.calls(sid).update({
                                            twiml: immediateTwiml.toString()
                                        });
                                        console.log('First chunk sent successfully');

                                        lastSentLength = partial.length;
                                        lastChunkSent = Date.now();
                                        isFirstChunk = false;
                                        accumulatedResponse = partial;
                                        return;
                                    }

                                    // For subsequent chunks, ensure minimum time between chunks
                                    const timeSinceLastChunk = Date.now() - lastChunkSent;
                                    if (timeSinceLastChunk < 500) { // Reduced from 1000ms to 500ms
                                        return;
                                    }

                                    // Update accumulated response
                                    accumulatedResponse = partial;

                                    // Get new content since last sent
                                    const newContent = accumulatedResponse.slice(lastSentLength);
                                    if (!newContent.trim()) return;

                                    // Send complete sentences
                                    const sentences = newContent.match(/[^.!?]+[.!?]+/g) || [];
                                    if (sentences.length === 0) return;

                                    const chunkToSend = sentences.join(' ').trim();
                                    console.log('Sending complete sentences:', chunkToSend);

                                    const chunkTwiml = new VoiceResponse();
                                    const gather = chunkTwiml.gather({
                                        input: ['speech'],
                                        timeout: 15,
                                        action: '/voice/continue',
                                        actionOnEmptyResult: true
                                    });

                                    gather.say({
                                        voice: 'Polly.Amy-Neural',
                                        language: 'en-GB'
                                    }, chunkToSend);

                                    // Send chunk
                                    await client.calls(sid).update({
                                        twiml: chunkTwiml.toString()
                                    });

                                    lastSentLength = accumulatedResponse.length;
                                    lastChunkSent = Date.now();

                                    // If this is the last chunk, add a brief pause
                                    if (isLastChunk) {
                                        gather.pause({ length: 0.3 });
                                    }

                                } catch (error) {
                                    console.error('Error in stream callback:', error);
                                }
                            }
                        }
                    );

                    try {
                        // Set up a race between response generation and a delay
                        const ACKNOWLEDGMENT_DELAY = 2000; // 2 seconds
                        const acknowledgmentTimer = new Promise(resolve => setTimeout(resolve, ACKNOWLEDGMENT_DELAY));

                        console.log('Waiting for initial response...');

                        // Race between getting the response and the acknowledgment timer
                        type RaceResult =
                            | { type: 'response'; data: string }
                            | { type: 'timeout' };

                        const raceResult = await Promise.race([
                            responsePromise.then(response => ({ type: 'response', data: response } as const)),
                            acknowledgmentTimer.then(() => ({ type: 'timeout' } as const))
                        ]) as RaceResult;

                        if (raceResult.type === 'response') {
                            // For immediate responses (common Q&A or cached), send directly
                            if (!accumulatedResponse) {
                                console.log('Sending immediate full response');
                                const immediateTwiml = new VoiceResponse();
                                immediateTwiml.say({
                                    voice: 'Polly.Amy-Neural',
                                    language: 'en-GB'
                                }, raceResult.data);

                                // Add gather after response to keep connection open
                                const gather = immediateTwiml.gather({
                                    input: ['speech'],
                                    timeout: 15,
                                    action: '/voice/continue',
                                    actionOnEmptyResult: true
                                });

                                // Keep the connection open with a subtle prompt
                                gather.pause({ length: 0.3 });

                                console.log('Updating call with immediate response');
                                await client.calls(sid).update({
                                    twiml: immediateTwiml.toString()
                                });
                                console.log('Immediate response sent successfully');
                            }
                        } else if (raceResult.type === 'timeout' && !accumulatedResponse) {
                            // Handle potential off-topic questions here
                            const isObviouslyUnrelated = finalTranscript.toLowerCase().match(
                                /(weather|stock|bitcoin|crypto|sports|game|movie|food|restaurant|pizza|uber|lyft|taxi)/g
                            );

                            // Get conversation context
                            const conversationState = conversationManager.getConversation(sid);
                            const hasEstablishedContext = (conversationState?.transcriptHistory?.length ?? 0) > 2;

                            // Only redirect if:
                            // 1. The question is obviously unrelated to customer support/software
                            // 2. We're at the start of the conversation (no context established)
                            // 3. The question isn't a follow-up to previous context
                            if (isObviouslyUnrelated && !hasEstablishedContext) {
                                console.log('Handling clearly off-topic query with redirection');
                                const redirectTwiml = new VoiceResponse();
                                const gather = redirectTwiml.gather({
                                    input: ['speech'],
                                    timeout: 15,
                                    action: '/voice/continue',
                                    actionOnEmptyResult: true
                                });

                                gather.say({
                                    voice: 'Polly.Amy-Neural',
                                    language: 'en-GB'
                                }, "I'm specifically trained to help with Kayako's customer support platform. I noticed you might be asking about something else. Would you like to know about Kayako's features or capabilities instead?");

                                await client.calls(sid).update({
                                    twiml: redirectTwiml.toString()
                                });
                                return;
                            }

                            // For all other cases, proceed with normal response handling
                            console.log('Sending acknowledgment due to timeout');
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

                            await client.calls(sid).update({
                                twiml: searchingTwiml.toString()
                            });
                        }

                        // Wait for the full response
                        console.log('Waiting for full response...');
                        const response = raceResult.type === 'response' ?
                            raceResult.data :
                            await responsePromise;

                        console.log('Full response received:', response);

                        // Send any remaining content
                        if (accumulatedResponse && accumulatedResponse.length < response.length) {
                            const remainingContent = response.slice(accumulatedResponse.length).trim();
                            if (remainingContent) {
                                console.log('Sending remaining content:', remainingContent);
                                const finalTwiml = new VoiceResponse();
                                const gather = finalTwiml.gather({
                                    input: ['speech'],
                                    timeout: 15,
                                    action: '/voice/continue',
                                    actionOnEmptyResult: true
                                });

                                gather.say({
                                    voice: 'Polly.Amy-Neural',
                                    language: 'en-GB'
                                }, remainingContent);

                                gather.pause({ length: 0.3 });

                                await client.calls(sid).update({
                                    twiml: finalTwiml.toString()
                                });
                                console.log('Remaining content sent');
                            }
                        }

                        // Add the complete response to conversation history
                        conversationManager.addToHistory(sid, 'ai', response);

                        // Reset state
                        callData.pendingTranscript = '';
                        callData.lastResponse = now;
                        isProcessingResponse = false;

                        console.log('Response handling completed successfully');

                    } catch (error) {
                        console.error('Error in response handling:', error);

                        // Send a recovery response instead of ending the call
                        const errorTwiml = new VoiceResponse();
                        const gather = errorTwiml.gather({
                            input: ['speech'],
                            timeout: 15,
                            action: '/voice/continue',
                            actionOnEmptyResult: true
                        });

                        gather.say({
                            voice: 'Polly.Amy-Neural',
                            language: 'en-GB'
                        }, "I'm here to help with questions about Kayako. What would you like to know about our customer support platform?");

                        await client.calls(sid)
                            .update({
                                twiml: errorTwiml.toString()
                            });

                        isProcessingResponse = false;
                    }
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

                    await client.calls(sid)
                        .update({
                            twiml: errorTwiml.toString()
                        });
                }
            }
        });

        stream.on('error', (error: { code?: string }) => {
            if (error.code !== 'ERR_STREAM_DESTROYED' && isCallActive) {
                console.error('Recognition stream error:', error);
                // Try to recreate stream on error
                if (callData && isCallActive) {
                    recognizeStream = googleSpeech.createStreamingRecognition();
                    callData.recognizeStream = recognizeStream;
                    setupRecognitionStreamHandler(recognizeStream, sid, callData);
                }
            }
        });
    }

    // Set up initial stream handler
    setupRecognitionStreamHandler(recognizeStream, callSid, activeCalls.get(callSid));

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

// Helper function to find appropriate sentence breaks
function findSentenceBreak(text: string): number {
    // Look for sentence endings with punctuation
    const matches = text.match(/[.!?][^.!?]*$/);
    if (matches) {
        return matches.index! + 1;
    }

    // Look for comma breaks if text is long enough
    if (text.length > 30) {
        const commaMatch = text.match(/,[^,]*$/);
        if (commaMatch) {
            return commaMatch.index! + 1;
        }
    }

    // If text is very long, break at a space after a minimum length
    if (text.length > 50) {
        const spaceMatch = text.match(/\s[^\s]*$/);
        if (spaceMatch) {
            return spaceMatch.index!;
        }
    }

    // No good break point found
    return 0;
}

// Helper function to determine pause length based on punctuation
function getPauseLengthForPunctuation(text: string): number {
    const lastChar = text.trim().slice(-1);
    switch (lastChar) {
        case '.':
            return 0.6;
        case '!':
        case '?':
            return 0.7;
        case ',':
            return 0.3;
        default:
            return 0.2;
    }
} 