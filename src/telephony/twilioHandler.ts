import twilio from 'twilio';
import { TwilioRequest, TwilioResponse } from '../types/twilio';
import { ElevenLabsService } from '../services/elevenLabsService';
import { GoogleSpeechService } from '../services/googleSpeechService';
import { KnowledgeBaseService } from '../services/knowledgeBaseService';
import WebSocket from 'ws';
import { Readable } from 'stream';

const VoiceResponse = twilio.twiml.VoiceResponse;
const elevenLabs = new ElevenLabsService();
const googleSpeech = new GoogleSpeechService();
const knowledgeBase = new KnowledgeBaseService();

// Initialize Twilio client
const client = twilio(
    process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_AUTH_TOKEN!
);

// Track active calls and their streams
const activeCalls: Map<string, {
    ws: WebSocket,
    recognizeStream: any,
    lastResponse: number
}> = new Map();

/**
 * Handle incoming voice calls - now with streaming
 */
export const handleIncomingCall = async (req: TwilioRequest, res: TwilioResponse): Promise<void> => {
    const twiml = new VoiceResponse();
    const callSid = req.body.CallSid;
    console.log('Handling incoming call from:', req.body.From);

    try {
        // Start media stream first
        twiml.start().stream({
            name: 'Audio Stream',
            url: `wss://${req.get('host')}/media/${callSid}`,
            track: 'inbound_track'
        });

        // Initial greeting with pause to keep connection open
        twiml.say({
            voice: 'Polly.Amy-Neural',
            language: 'en-GB'
        }, 'Hi! How can I help you today?');

        // Add a long pause to keep the connection open
        twiml.pause({ length: 120 });

        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error('Error in handleIncomingCall:', error);
        twiml.say({
            voice: 'Polly.Amy-Neural',
            language: 'en-GB'
        }, 'Sorry, please try again.');
        res.type('text/xml');
        res.send(twiml.toString());
    }
};

/**
 * Handle media stream connection
 */
export const handleMediaStream = (ws: WebSocket, callSid: string) => {
    console.log('Media stream connected for call:', callSid);

    // Set up Google Speech streaming
    const recognizeStream = googleSpeech.createStreamingRecognition();

    // Track this call's streams
    activeCalls.set(callSid, {
        ws,
        recognizeStream,
        lastResponse: Date.now()
    });

    // Handle incoming media
    ws.on('message', async (message: any) => {
        try {
            const msg = JSON.parse(message);
            if (msg.event === 'media') {
                // Convert Twilio's base64 audio to a buffer
                const audioBuffer = Buffer.from(msg.media.payload, 'base64');

                // Send to Google Speech
                recognizeStream.write(audioBuffer);
            } else if (msg.event === 'stop') {
                console.log('Media stream stopped by Twilio');
            }
        } catch (error) {
            console.error('Error processing media:', error);
        }
    });

    // Handle stream end
    ws.on('close', () => {
        console.log('Media stream closed for call:', callSid);
        const callData = activeCalls.get(callSid);
        if (callData) {
            callData.recognizeStream.destroy();
            activeCalls.delete(callSid);
        }
    });

    // Handle transcription results
    recognizeStream.on('data', async (data: any) => {
        const callData = activeCalls.get(callSid);
        if (!callData) return;

        // Avoid responding too frequently
        const now = Date.now();
        if (now - callData.lastResponse < 1000) return; // Minimum 1s between responses

        const result = data.results[0];
        if (result?.isFinal) {
            const transcription = result.alternatives[0].transcript;
            console.log('Final transcription:', transcription);

            try {
                // Get contextual response from knowledge base
                const response = await knowledgeBase.getResponse(callSid, transcription);

                // Generate response with a pause to keep the connection open
                const twiml = new VoiceResponse();

                twiml.say({
                    voice: 'Polly.Amy-Neural',
                    language: 'en-GB'
                }, response);

                // Add a long pause to keep the connection open
                twiml.pause({ length: 120 });

                // Send response via Twilio REST API
                await client.calls(callSid)
                    .update({
                        twiml: twiml.toString()
                    });

                callData.lastResponse = now;
            } catch (error) {
                console.error('Error sending response:', error);
            }
        }
    });
};

// Clean up function for ending calls
export const endCall = (callSid: string) => {
    const callData = activeCalls.get(callSid);
    if (callData) {
        callData.ws.close();
        callData.recognizeStream.destroy();
        activeCalls.delete(callSid);
        knowledgeBase.endConversation(callSid);
        console.log('Call ended and cleaned up:', callSid);
    }
}; 