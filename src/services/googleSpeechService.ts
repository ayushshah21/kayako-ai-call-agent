import { SpeechClient } from '@google-cloud/speech';
import { google } from '@google-cloud/speech/build/protos/protos';
import { Readable } from 'stream';

type StreamingRecognitionResult = google.cloud.speech.v1.StreamingRecognitionResult;

export class GoogleSpeechService {
    private client: SpeechClient;
    private config: google.cloud.speech.v1.IRecognitionConfig;
    private streamingConfig: google.cloud.speech.v1.IStreamingRecognitionConfig;

    constructor() {
        this.client = new SpeechClient();
        this.config = {
            encoding: 'MULAW',  // Twilio's audio format
            sampleRateHertz: 8000,
            languageCode: 'en-US',
            model: 'command_and_search',
            useEnhanced: true,
            enableAutomaticPunctuation: true,
            maxAlternatives: 1,
            adaptation: {
                phraseSetReferences: [],
                customClasses: []
            }
        };

        this.streamingConfig = {
            config: this.config,
            interimResults: true,
            singleUtterance: false
        };
    }

    createStreamingRecognition() {
        const recognizeStream = this.client
            .streamingRecognize(this.streamingConfig)
            .on('error', (error) => {
                console.error('Streaming recognition error:', error);
            });

        return recognizeStream;
    }

    async transcribeAudio(audioStream: Readable): Promise<string> {
        try {
            const recognizeStream = this.createStreamingRecognition();

            audioStream.pipe(recognizeStream);

            return new Promise((resolve, reject) => {
                let finalTranscription = '';
                let transcriptionComplete = false;

                recognizeStream.on('data', (data: { results: StreamingRecognitionResult[] }) => {
                    const result = data.results[0];
                    const transcript = result?.alternatives?.[0]?.transcript;
                    if (transcript) {
                        console.log(`Real-time transcription [${result.isFinal ? 'FINAL' : 'INTERIM'}]:`, transcript);

                        if (result.isFinal) {
                            finalTranscription = transcript;
                            transcriptionComplete = true;
                            resolve(transcript);
                        }
                    }
                });

                recognizeStream.on('error', (error) => {
                    reject(error);
                });

                setTimeout(() => {
                    if (!transcriptionComplete) {
                        reject(new Error('Transcription timeout'));
                    }
                }, 5000);
            });
        } catch (error: any) {
            console.error('Error in transcribeAudio:', error);
            throw error;
        }
    }
} 