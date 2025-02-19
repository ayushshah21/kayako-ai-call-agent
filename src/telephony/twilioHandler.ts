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

        // Always log transcription immediately for debugging
        console.log('Real-time transcription:', transcription, 'isFinal:', result.isFinal);

        // Update the pending transcript immediately for any non-empty transcription
        if (transcription.trim()) {
            if (result.isFinal) {
                // Check for user interruption immediately - if we detect any speech during response
                if (isProcessingResponse && transcription.trim()) {
                    console.log('User interruption detected:', transcription);
                    isProcessingResponse = false;

                    // Immediately process the new input
                    callData.pendingTranscript = transcription;
                    callData.lastTranscriptTime = now;

                    // Process the interruption immediately if it's a complete thought
                    if (isCompleteSentence(transcription) || transcription.length > 15) {
                        const finalTranscript = transcription.trim();
                        console.log('Processing interruption immediately:', finalTranscript);

                        // Add user's message to conversation history
                        conversationManager.addToHistory(callSid, 'user', finalTranscript);

                        // Get conversation state and generate response
                        const conversationState = conversationManager.getConversation(callSid);
                        if (conversationState) {
                            isProcessingResponse = true;

                            // Generate and handle the response
                            try {
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

                                            await client.calls(callSid).update({
                                                twiml: twiml.toString()
                                            });
                                        }
                                    }
                                );

                                const response = await responsePromise;
                                conversationManager.addToHistory(callSid, 'ai', response);
                                callData.lastResponse = Date.now();
                            } catch (error) {
                                console.error('Error generating response for interruption:', error);
                                isProcessingResponse = false;
                            }
                        }
                    }
                } else {
                    callData.pendingTranscript += ' ' + transcription;
                    callData.lastTranscriptTime = now;
                }
                console.log('Accumulated transcription:', callData.pendingTranscript);
            } else {
                // For non-final results, still check for potential interruptions
                if (isProcessingResponse && transcription.trim().length > 10) {
                    console.log('Potential interruption detected in interim result:', transcription);
                    // Don't stop processing yet, but prepare for potential interruption
                }
            }
        }

        // Check if we should process the accumulated transcript
        const timeSinceLastTranscript = now - callData.lastTranscriptTime;
        const hasCompleteSentence = isCompleteSentence(callData.pendingTranscript);
        const isLongEnoughPause = timeSinceLastTranscript > 1000; // Reduced from 1500ms to 1000ms

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
                                console.log('Received partial response:', partial);

                                // Don't process if call is no longer active
                                if (!isCallActive || !isProcessingResponse) {
                                    console.log('Call no longer active or not processing, skipping partial response');
                                    return;
                                }

                                // For common Q&A or instant responses, send immediately
                                if (isFirstChunk) {
                                    console.log('First chunk, sending immediate response');

                                    // Wait for a complete sentence before sending first chunk
                                    if (partial.length < 20 || !isCompleteSentence(partial)) {
                                        console.log('Waiting for more complete first chunk');
                                        return;
                                    }

                                    const immediateTwiml = new VoiceResponse();

                                    // Don't use gather for the first response to ensure continuous playback
                                    immediateTwiml.say({
                                        voice: 'Polly.Amy-Neural',
                                        language: 'en-GB'
                                    }, partial);

                                    // Add gather after response to keep connection open and listen for follow-up
                                    const gather = immediateTwiml.gather({
                                        input: ['speech'],
                                        timeout: 15,
                                        action: '/voice/continue',
                                        actionOnEmptyResult: true
                                    });

                                    // Add a subtle prompt for follow-up
                                    gather.pause({ length: 0.5 });
                                    gather.say({
                                        voice: 'Polly.Amy-Neural',
                                        language: 'en-GB'
                                    }, "What else would you like to know?");

                                    // Add a longer pause to keep the connection open
                                    gather.pause({ length: 5 });

                                    console.log('Sending first complete chunk:', partial);
                                    await client.calls(callSid).update({
                                        twiml: immediateTwiml.toString()
                                    });
                                    console.log('First chunk sent successfully');

                                    lastSentLength = partial.length;
                                    lastChunkSent = Date.now();
                                    isFirstChunk = false;
                                    return;
                                }

                                // For subsequent chunks, ensure minimum time between chunks
                                const now = Date.now();
                                const timeSinceLastChunk = now - lastChunkSent;
                                if (timeSinceLastChunk < 1000) { // Increased to 1 second minimum between chunks
                                    console.log('Waiting for larger time gap between chunks');
                                    return;
                                }

                                // Update accumulated response
                                accumulatedResponse = partial;

                                // Get new content since last sent
                                const newContent = accumulatedResponse.slice(lastSentLength);
                                if (!newContent.trim() || newContent.length < 10) {
                                    console.log('Waiting for more substantial content');
                                    return;
                                }

                                // Find sentence breaks
                                const sentences = newContent.match(/[^.!?]+[.!?]+/g) || [];
                                if (sentences.length === 0) {
                                    console.log('No complete sentences found in new content');
                                    return;
                                }

                                // Send complete sentences
                                const chunkToSend = sentences.join(' ').trim();
                                console.log('Sending complete sentences:', chunkToSend);

                                const chunkTwiml = new VoiceResponse();
                                chunkTwiml.say({
                                    voice: 'Polly.Amy-Neural',
                                    language: 'en-GB'
                                }, chunkToSend);

                                // Add natural pause
                                chunkTwiml.pause({ length: 0.3 });

                                // Send chunk
                                console.log('Updating call with next chunk...');
                                await client.calls(callSid).update({
                                    twiml: chunkTwiml.toString()
                                });
                                console.log('Chunk sent successfully');

                                lastSentLength += chunkToSend.length;
                                lastChunkSent = now;

                            } catch (error) {
                                console.error('Error in stream callback:', error);
                                if (error instanceof Error) {
                                    console.error('Error details:', error.message);
                                    console.error('Stack trace:', error.stack);
                                }
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

                            gather.pause({ length: 0.5 });
                            gather.say({
                                voice: 'Polly.Amy-Neural',
                                language: 'en-GB'
                            }, "What else would you like to know?");

                            gather.pause({ length: 5 });

                            console.log('Updating call with immediate response');
                            await client.calls(callSid).update({
                                twiml: immediateTwiml.toString()
                            });
                            console.log('Immediate response sent successfully');
                        }
                    } else if (raceResult.type === 'timeout' && !accumulatedResponse) {
                        console.log('Sending acknowledgment due to timeout');
                        // Only send acknowledgment if we hit the timeout and haven't started streaming yet
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

                        await client.calls(callSid).update({
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
                    if (accumulatedResponse.length > lastSentLength) {
                        const remainingContent = accumulatedResponse.slice(lastSentLength).trim();
                        if (remainingContent) {
                            console.log('Sending remaining content:', remainingContent);
                            const finalTwiml = new VoiceResponse();
                            const gather = finalTwiml.gather({
                                input: ['speech'],
                                timeout: 10,
                                action: '/voice/continue',
                                actionOnEmptyResult: true
                            });

                            gather.say({
                                voice: 'Polly.Amy-Neural',
                                language: 'en-GB'
                            }, remainingContent);

                            gather.pause({ length: 0.2 });

                            await client.calls(callSid).update({
                                twiml: finalTwiml.toString()
                            });
                            console.log('Remaining content sent');
                        }
                    }

                    // Add the complete response to conversation history
                    conversationManager.addToHistory(callSid, 'ai', response);

                    // Reset state
                    callData.pendingTranscript = '';
                    callData.lastResponse = now;
                    isProcessingResponse = false;

                    console.log('Response handling completed successfully');

                } catch (error) {
                    console.error('Error in response handling:', error);
                    if (error instanceof Error) {
                        console.error('Error details:', error.message);
                        console.error('Stack trace:', error.stack);
                    }
                    isProcessingResponse = false;

                    // Send error response to user
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
                    }, "I apologize, I encountered an error. Could you please repeat your question?");

                    await client.calls(callSid).update({
                        twiml: errorTwiml.toString()
                    });
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