import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({
    path: path.resolve(process.cwd(), '.env')
});

import express from 'express';
import bodyParser from 'body-parser';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { handleIncomingCall, handleMediaStream, endCall } from '../telephony/twilioHandler';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const port = process.env.PORT || 3000;

// Add environment variable debug logging
console.log('Environment variables loaded:', {
    NODE_ENV: process.env.NODE_ENV,
    ELEVEN_LABS_API_KEY: process.env.ELEVEN_LABS_API_KEY ? 'Set' : 'Not set',
    GOOGLE_CLOUD_PROJECT_ID: process.env.GOOGLE_CLOUD_PROJECT_ID,
    PORT: process.env.PORT
});

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Serve static audio files
app.use('/audio', express.static(path.join(__dirname, '../../temp/audio')));
app.use('/cache', express.static(path.join(__dirname, '../../temp/cache')));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    console.log('Request Body:', req.body);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

// WebSocket connection for media streams
wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const callSid = req.url?.split('/').pop();
    if (!callSid) {
        console.error('No CallSid provided in WebSocket URL');
        ws.close();
        return;
    }

    console.log('WebSocket connected for call:', callSid);
    handleMediaStream(ws, callSid);
});

// Twilio webhook endpoints
app.post('/voice', handleIncomingCall);

// Call status webhook - handle call end
app.post('/voice/status', (req, res) => {
    const { CallSid, CallStatus } = req.body;
    if (CallStatus === 'completed' || CallStatus === 'failed') {
        endCall(CallSid);
    }
    res.sendStatus(200);
});

// Start server
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log('Twilio configuration:');
    console.log(`Account SID: ${process.env.TWILIO_ACCOUNT_SID}`);
    console.log(`Phone Number: ${process.env.TWILIO_PHONE_NUMBER}`);
}); 