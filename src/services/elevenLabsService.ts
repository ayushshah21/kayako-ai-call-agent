import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);
const readFileAsync = promisify(fs.readFile);
const existsAsync = promisify(fs.exists);

interface CachedAudio {
    path: string;
    timestamp: number;
}

export class ElevenLabsService {
    private apiKey: string;
    private baseUrl: string = 'https://api.elevenlabs.io/v1';
    private voiceId: string = 'ThT5KcBeYPX3keUQqHPh'; // Rachel voice
    private outputDir: string = path.join(__dirname, '../../temp/audio');
    private cacheDir: string = path.join(__dirname, '../../temp/cache');
    private audioCache: Map<string, CachedAudio> = new Map();
    private cacheDuration: number = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    constructor() {
        console.log('Environment variables:', {
            ELEVEN_LABS_API_KEY: process.env.ELEVEN_LABS_API_KEY ? 'Set' : 'Not set',
            NODE_ENV: process.env.NODE_ENV
        });

        this.apiKey = process.env.ELEVEN_LABS_API_KEY || '';
        if (!this.apiKey) {
            throw new Error('ELEVEN_LABS_API_KEY is required');
        }
        this.initializeDirs();
    }

    private async initializeDirs() {
        await mkdirAsync(this.outputDir, { recursive: true });
        await mkdirAsync(this.cacheDir, { recursive: true });
    }

    private getCacheKey(text: string): string {
        return Buffer.from(text).toString('base64');
    }

    private async getCachedAudio(text: string): Promise<string | null> {
        const cacheKey = this.getCacheKey(text);
        const cached = this.audioCache.get(cacheKey);

        if (cached) {
            if (Date.now() - cached.timestamp < this.cacheDuration) {
                const exists = await existsAsync(cached.path);
                if (exists) {
                    return cached.path;
                }
            }
            this.audioCache.delete(cacheKey);
        }
        return null;
    }

    private async cacheAudio(text: string, audioPath: string) {
        const cacheKey = this.getCacheKey(text);
        this.audioCache.set(cacheKey, {
            path: audioPath,
            timestamp: Date.now()
        });
    }

    async synthesizeSpeech(text: string): Promise<string> {
        try {
            // Check cache first
            const cachedPath = await this.getCachedAudio(text);
            if (cachedPath) {
                console.log('Using cached audio for:', text);
                return this.getPublicUrl(cachedPath);
            }

            const response = await axios({
                method: 'POST',
                url: `${this.baseUrl}/text-to-speech/${this.voiceId}/stream`,  // Using stream endpoint
                headers: {
                    'Accept': 'audio/mpeg',
                    'xi-api-key': this.apiKey,
                    'Content-Type': 'application/json'
                },
                data: {
                    text,
                    model_id: 'eleven_turbo_v2',  // Using Turbo model for lower latency
                    voice_settings: {
                        stability: 0.3,           // Lower stability for faster generation
                        similarity_boost: 0.75,
                        style: 0.5,
                        use_speaker_boost: true
                    },
                    optimize_streaming_latency: 3  // Maximum optimization for streaming
                },
                responseType: 'arraybuffer'
            });

            const fileName = `${this.getCacheKey(text)}.mp3`;
            const outputPath = path.join(this.cacheDir, fileName);
            await writeFileAsync(outputPath, response.data);

            // Cache the generated audio
            await this.cacheAudio(text, outputPath);

            return this.getPublicUrl(outputPath);
        } catch (error) {
            console.error('Error synthesizing speech:', error);
            throw error;
        }
    }

    private getPublicUrl(filePath: string): string {
        // Convert the file path to a public URL
        const relativePath = path.relative(path.join(__dirname, '../../temp'), filePath);
        return `/${relativePath}`;
    }

    // Get available voices
    async getVoices() {
        try {
            const response = await axios.get(`${this.baseUrl}/voices`, {
                headers: {
                    'xi-api-key': this.apiKey
                }
            });
            return response.data;
        } catch (error) {
            console.error('Error getting voices:', error);
            throw error;
        }
    }
} 