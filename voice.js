import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

const pollyVoices = [
    { name: 'Matthew', lang: 'en-US', gender: 'Male' },
    { name: 'Joanna', lang: 'en-US', gender: 'Female' },
    { name: 'Stephen', lang: 'en-US', gender: 'Male' },
    { name: 'Ruth', lang: 'en-US', gender: 'Female' },
    { name: 'Amy', lang: 'en-GB', gender: 'Female' },
    { name: 'Brian', lang: 'en-GB', gender: 'Male' },
    { name: 'Aria', lang: 'en-NZ', gender: 'Female' }
];

let _selectedVoice = pollyVoices[1]; // Joanna
let _isSpeaking = false;
let _currentAudio = null;
let _aborted = false;
let _onCompleteGlobal = null;

let _client = null;

function getClient() {
    if (!_client) {
        _client = new PollyClient({
            region: import.meta.env.VITE_AWS_REGION || "us-east-1",
            credentials: {
                accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID || "",
                secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY || ""
            }
        });
    }
    return _client;
}

export function loadVoices() {
    return Promise.resolve();
}

export function getAvailableVoices() {
    return pollyVoices;
}

export function getSelectedVoice() {
    return _selectedVoice;
}

export function changeVoice(voiceName) {
    const v = pollyVoices.find(voice => voice.name === voiceName);
    if (v) _selectedVoice = v;
}

export function isSpeaking() {
    return _isSpeaking;
}

export function stopSpeaking() {
    _aborted = true;
    if (_currentAudio) {
        _currentAudio.pause();
        _currentAudio.currentTime = 0;
        _currentAudio = null;
    }
    _isSpeaking = false;
    if (_onCompleteGlobal) {
        _onCompleteGlobal();
        _onCompleteGlobal = null;
    }
}

export async function speak(text, onComplete = null, useSSML = false, onBoundary = null) {
    if (!text || !text.trim()) { onComplete?.(); return; }
    
    stopSpeaking();
    _aborted = false;
    _onCompleteGlobal = onComplete;
    _isSpeaking = true;

    try {
        const client = getClient();
        
        const command = new SynthesizeSpeechCommand({
            OutputFormat: "mp3",
            Text: text,
            TextType: useSSML ? "ssml" : "text",
            VoiceId: _selectedVoice.name,
            Engine: "neural"
        });

        const response = await client.send(command);
        
        let arrayBuffer;
        if (typeof response.AudioStream.transformToByteArray === 'function') {
            const uint8 = await response.AudioStream.transformToByteArray();
            arrayBuffer = uint8.buffer;
        } else {
            arrayBuffer = await new Response(response.AudioStream).arrayBuffer();
        }

        const blob = new Blob([arrayBuffer], { type: "audio/mp3" });
        const url = URL.createObjectURL(blob);
        
        _currentAudio = new Audio(url);
        
        _currentAudio.onended = () => {
            _isSpeaking = false;
            URL.revokeObjectURL(url);
            if (!_aborted && _onCompleteGlobal) {
                _onCompleteGlobal();
                _onCompleteGlobal = null;
            }
        };
        
        _currentAudio.onerror = (e) => {
            console.warn("[VOICE] Audio playback error:", e);
            alert("Audio playback error: " + (e.message || "Unknown audio error"));
            _isSpeaking = false;
            URL.revokeObjectURL(url);
            if (!_aborted && _onCompleteGlobal) {
                _onCompleteGlobal();
                _onCompleteGlobal = null;
            }
        };
        
        await _currentAudio.play().catch(e => {
            console.warn("[VOICE] Play error:", e);
            alert("Audio Play Error: " + e.message);
            _isSpeaking = false;
            URL.revokeObjectURL(url);
            if (!_aborted && _onCompleteGlobal) {
                _onCompleteGlobal();
                _onCompleteGlobal = null;
            }
        });
    } catch (e) {
        console.error("[VOICE] Polly API error:", e);
        alert("Polly Error: " + e.name + " - " + e.message);
        _isSpeaking = false;
        if (!_aborted && _onCompleteGlobal) {
            _onCompleteGlobal();
            _onCompleteGlobal = null;
        }
    }
}

export function cleanTextForSpeech(text) {
    if (!text) return '';
    return text
        // CRITICAL FIX: Completely remove text inside asterisks (actions/roleplay)
        .replace(/\*[^*]+\*/g, '')
        .replace(/_{1,2}(.*?)_{1,2}/g, '$1')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^\s*[-*•]\s+/gm, '')
        .replace(/^\s*\d+[.)]\s+/gm, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/\bDr\./g, 'Doctor')
        .replace(/\bMr\./g, 'Mister')
        .replace(/\bMrs\./g, 'Missus')
        .replace(/\bMs\./g, 'Miss')
        .replace(/\betc\./gi, 'et cetera')
        .replace(/\bvs\./gi, 'versus')
        .replace(/\bi\.e\./gi, 'that is')
        .replace(/\be\.g\./gi, 'for example')
        .trim();
}

export function segmentText(text) {
    if (!text || !text.trim()) return [];
    const raw = text
        .replace(/([.!?…])\s+(?=[A-Z"'])/g, '$1\n')
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 1);
    return raw.length ? raw : [text.trim()];
}
