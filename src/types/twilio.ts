import { Request, Response } from 'express';
import { RecordAttributes } from 'twilio/lib/twiml/VoiceResponse';

// Extend Twilio's RecordAttributes to include our additional properties
interface ExtendedRecordAttributes extends RecordAttributes {
    format?: string;
    trim?: 'trim-silence' | 'do-not-trim';
    playBeep?: boolean;
    streamTimeout?: number;  // Timeout in milliseconds for streaming
}

export interface TwilioRequest extends Request {
    body: {
        TranscriptionText?: string;
        RecordingUrl?: string;
        CallSid?: string;
        From?: string;
    }
}

export interface TwilioResponse extends Response {
    type(type: string): this;
}

export { ExtendedRecordAttributes }; 