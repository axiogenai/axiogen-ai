/**
 * voice.js — AXIOGEN Human-Grade TTS Prosody Engine v3
 *
 * Simulates natural human speech prosody using Web Speech API:
 *   • Question marks    → pitch rises (+0.15), slight rate decrease
 *   • Commas            → 110–140ms breath pause between sub-phrases
 *   • Exclamations      → boosted rate + higher pitch
 *   • Ellipsis / em-dash→ longer dramatic pause (300–450ms)
 *   • Sentence-end (.)  → slight pitch drop (completion fall)
 *   • ALL-CAPS words    → pitch spike (emphasis)
 *   • Parentheticals    → slightly faster, lower pitch (aside voice)
 *   • Numbers spelled   → natural cadence
 *   • Filler words      → ever-so-slightly slower for authenticity
 */

// ─── Voice selection ──────────────────────────────────────────────────────────

let _selectedVoice = null;
let _voicesLoaded  = false;

const PREFERRED_VOICES = [
    // Premium neural voices (Chrome / Edge)
    'Google UK English Female',
    'Google US English',
    'Microsoft Aria Online (Natural) - English (United States)',
    'Microsoft Jenny Online (Natural) - English (United States)',
    'Microsoft Guy Online (Natural) - English (United States)',
    'Samantha',           // macOS / iOS
    'Karen',              // macOS AU
    'Daniel',             // macOS UK
    'Google UK English Male',
];

function _loadVoices() {
    if (_voicesLoaded) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    _voicesLoaded = true;

    // Try preferred list first
    for (const name of PREFERRED_VOICES) {
        const v = voices.find(v => v.name === name);
        if (v) { _selectedVoice = v; return; }
    }
    // Fallback: first en-US or en voice
    _selectedVoice =
        voices.find(v => v.lang === 'en-US') ||
        voices.find(v => v.lang.startsWith('en')) ||
        voices[0];
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = _loadVoices;
    _loadVoices();
}

// ─── State ────────────────────────────────────────────────────────────────────

let _isSpeaking      = false;
let _utteranceQueue  = [];   // array of { utter, pauseAfter }
let _currentUtter    = null;
let _onCompleteGlobal= null;
let _onBoundaryGlobal= null;
let _aborted         = false;

// ─── Public API ───────────────────────────────────────────────────────────────

export function loadVoices() {
    return new Promise(resolve => {
        if (_voicesLoaded) return resolve();
        const check = () => {
            _loadVoices();
            if (_voicesLoaded) resolve();
            else setTimeout(check, 50);
        };
        check();
    });
}

export function getAvailableVoices() {
    return typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}

export function getSelectedVoice() {
    return _selectedVoice;
}

export function changeVoice(voiceName) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find(voice => voice.name === voiceName);
    if (v) _selectedVoice = v;
}

export function isSpeaking() { return _isSpeaking; }

export function stopSpeaking() {
    _aborted = true;
    _utteranceQueue = [];
    _currentUtter   = null;
    _onCompleteGlobal = null;
    _onBoundaryGlobal = null;
    try { window.speechSynthesis.cancel(); } catch (_) {}
    _isSpeaking = false;
}

/**
 * speak(text, onComplete, useSSML, onBoundary)
 *
 * Splits text into prosody-aware micro-utterances and plays them
 * with human-like pauses, pitch contours, and rate variation.
 */
export function speak(text, onComplete = null, useSSML = false, onBoundary = null) {
    if (!text || !text.trim()) { onComplete?.(); return; }
    _loadVoices();

    stopSpeaking();
    _aborted = false;
    _onCompleteGlobal = onComplete;
    _onBoundaryGlobal = onBoundary;
    _isSpeaking       = true;

    const cleaned = cleanTextForSpeech(text);
    const units   = _buildProsodyUnits(cleaned);

    _utteranceQueue = units;
    _playNext(0);
}

// ─── Prosody unit builder ─────────────────────────────────────────────────────

/**
 * _buildProsodyUnits(text)
 *
 * Splits text into utterance units, each with prosody params and
 * a pauseAfter (ms) before the next unit begins.
 *
 * Returns: Array<{ text, pitch, rate, volume, pauseAfter }>
 */
function _buildProsodyUnits(text) {
    // Step 1: Split on sentence boundaries first, preserving delimiter
    const sentences = _splitSentences(text);
    const units = [];

    for (const sentence of sentences) {
        if (!sentence.trim()) continue;
        const sentenceUnits = _processSentence(sentence.trim());
        units.push(...sentenceUnits);
    }

    return units;
}

/**
 * Split into sentences. Keeps the terminating punctuation attached.
 */
function _splitSentences(text) {
    // Split on . ! ? … but not decimals (3.14) or abbreviations (Mr.)
    return text
        .split(/(?<=[.!?…])\s+(?=[A-Z"'])/g)
        .map(s => s.trim())
        .filter(Boolean);
}

/**
 * Process one sentence into prosody units, splitting on commas,
 * em-dashes, ellipses, and applying pitch/rate based on terminator.
 */
function _processSentence(sentence) {
    const units = [];

    // Detect sentence type from terminal punctuation
    const isQuestion    = /[?]\s*$/.test(sentence);
    const isExclamation = /[!]\s*$/.test(sentence);
    const isEllipsis    = /[…]\s*$/.test(sentence);

    // Base prosody for this sentence
    let basePitch  = 1.0;
    let baseRate   = 1.0;
    let baseVolume = 1.0;

    if (isQuestion)    { basePitch = 1.0;  baseRate = 0.95; }  // will rise at end
    if (isExclamation) { basePitch = 1.08; baseRate = 1.05; }
    if (isEllipsis)    { basePitch = 0.97; baseRate = 0.90; }

    // Split on commas, em-dashes, semicolons, ellipses (internal)
    // Each segment = one "breath group"
    const BREAK_RE = /([^,;—–…]+)([,;—–…]?)/g;
    const segments = [];
    let match;
    while ((match = BREAK_RE.exec(sentence)) !== null) {
        const seg      = match[1].trim();
        const delim    = match[2];
        if (seg) segments.push({ text: seg + delim, delim });
    }
    if (!segments.length) segments.push({ text: sentence, delim: '' });

    const lastIdx = segments.length - 1;

    segments.forEach((seg, idx) => {
        const isLast     = idx === lastIdx;
        const delim      = seg.delim;
        let   text       = seg.text;

        // Determine pause after this segment
        let pauseAfter = 0;
        if      (delim === ',')      pauseAfter = 115 + Math.random() * 50;   // breath
        else if (delim === ';')      pauseAfter = 160 + Math.random() * 40;
        else if (delim === '—' || delim === '–') pauseAfter = 280 + Math.random() * 80;
        else if (delim === '…')      pauseAfter = 350 + Math.random() * 100;

        // Pitch contour within sentence
        let pitch = basePitch;
        let rate  = baseRate;

        if (isQuestion && isLast) {
            // Final segment of a question: raise pitch (rising intonation)
            pitch = basePitch + 0.15 + Math.random() * 0.05;
            rate  = Math.max(0.85, baseRate - 0.05);
        } else if (isQuestion && idx === lastIdx - 1) {
            // Second-to-last segment of question: begin the rise
            pitch = basePitch + 0.07;
        } else if (isExclamation && isLast) {
            pitch = basePitch + 0.10;
            rate  = baseRate + 0.05;
        } else if (isEllipsis && isLast) {
            // Trailing off — drop pitch, slow down
            pitch = basePitch - 0.08;
            rate  = baseRate - 0.10;
        } else if (!isLast) {
            // Non-final segments: slight pitch sustain or mild rise before comma
            pitch = basePitch + (delim === ',' ? 0.03 : 0.0);
        } else {
            // Final segment of a statement: slight pitch drop (completion fall)
            pitch = basePitch - 0.05;
        }

        // ALL-CAPS word emphasis — inject tiny pitch bumps via text pre-processing
        // (We can't do per-word in Web Speech, but we detect it and boost whole segment)
        const capsWords = (text.match(/\b[A-Z]{2,}\b/g) || []);
        if (capsWords.length) {
            pitch  += 0.06;
            rate   += 0.02;
            // Lowercase them for natural pronunciation
            text = text.replace(/\b[A-Z]{2,}\b/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
        }

        // Parenthetical asides — faster, quieter (inside parentheses)
        const isParenthetical = /^\(.*\)$/.test(text.trim());
        if (isParenthetical) {
            rate  += 0.08;
            pitch -= 0.06;
            baseVolume = 0.88;
        }

        // Filler words — micro-slowdown for naturalness
        const FILLERS = /^(well|honestly|look|right|you know|basically|actually|literally|anyway)$/i;
        if (FILLERS.test(text.trim())) {
            rate -= 0.05;
        }

        // Natural micro-jitter — no two utterances are perfectly identical
        pitch += (Math.random() - 0.5) * 0.025;
        rate  += (Math.random() - 0.5) * 0.02;

        // Clamp
        pitch  = Math.min(2.0, Math.max(0.1, pitch));
        rate   = Math.min(2.0, Math.max(0.5, rate));

        units.push({
            text,
            pitch,
            rate,
            volume: baseVolume,
            pauseAfter: isLast ? 0 : pauseAfter,
        });
    });

    // Add inter-sentence breath pause to the last unit of this sentence
    if (units.length) {
        const lastUnit = units[units.length - 1];
        // Sentences naturally need ~80-180ms between them
        lastUnit.sentenceBreak = 80 + Math.random() * 100;
    }

    return units;
}

// ─── Playback engine ─────────────────────────────────────────────────────────

function _playNext(charOffset) {
    if (_aborted || !_utteranceQueue.length) {
        _isSpeaking = false;
        if (!_aborted) _onCompleteGlobal?.();
        _onCompleteGlobal = null;
        _onBoundaryGlobal = null;
        return;
    }

    const unit = _utteranceQueue.shift();
    if (!unit.text.trim()) {
        _playNext(charOffset);
        return;
    }

    const utter       = new SpeechSynthesisUtterance(unit.text);
    utter.voice       = _selectedVoice;
    utter.lang        = _selectedVoice?.lang || 'en-US';
    utter.pitch       = unit.pitch;
    utter.rate        = unit.rate;
    utter.volume      = unit.volume ?? 1.0;

    _currentUtter = utter;

    let localCharOffset = charOffset;

    utter.onboundary = (e) => {
        if (e.name === 'word' && _onBoundaryGlobal) {
            _onBoundaryGlobal(localCharOffset + e.charIndex, e.charLength);
        }
    };

    utter.onend = () => {
        if (_aborted) return;
        localCharOffset += unit.text.length + 1;

        // Comma / dash / ellipsis pause WITHIN a sentence
        const intraDelay  = unit.pauseAfter    || 0;
        // Sentence-boundary breath pause
        const interDelay  = unit.sentenceBreak || 0;
        const totalDelay  = intraDelay + interDelay;

        if (totalDelay > 10) {
            // During pauses, briefly cancel synthesis so no "stuck" state
            setTimeout(() => {
                if (!_aborted) _playNext(localCharOffset);
            }, totalDelay);
        } else {
            _playNext(localCharOffset);
        }
    };

    utter.onerror = (e) => {
        if (_aborted) return;
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        console.warn('[VOICE] Utterance error:', e.error, unit.text.slice(0, 40));
        // Continue with next unit on error
        _playNext(charOffset);
    };

    // iOS/Safari keepalive: speechSynthesis pauses in background tabs
    _keepAlive();

    try {
        window.speechSynthesis.speak(utter);
    } catch (e) {
        console.warn('[VOICE] speak() threw:', e);
        _playNext(charOffset);
    }
}

// ─── iOS/Safari keep-alive ────────────────────────────────────────────────────

let _keepAliveTimer = null;
function _keepAlive() {
    clearInterval(_keepAliveTimer);
    _keepAliveTimer = setInterval(() => {
        if (!_isSpeaking) { clearInterval(_keepAliveTimer); return; }
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
        }
    }, 5000);
}

// ─── Text cleaning ────────────────────────────────────────────────────────────

/**
 * cleanTextForSpeech — strips markdown artifacts and normalizes for TTS.
 * Called by neura.js before passing text to speak().
 */
export function cleanTextForSpeech(text) {
    if (!text) return '';
    return text
        // Remove markdown bold/italic
        .replace(/\*{1,3}(.*?)\*{1,3}/g, '$1')
        .replace(/_{1,2}(.*?)_{1,2}/g, '$1')
        // Remove code blocks
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        // Remove headers
        .replace(/^#{1,6}\s+/gm, '')
        // Remove URLs
        .replace(/https?:\/\/\S+/g, '')
        // Remove markdown links but keep text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Remove bullet points / numbered lists
        .replace(/^\s*[-*•]\s+/gm, '')
        .replace(/^\s*\d+[.)]\s+/gm, '')
        // Normalize multiple spaces / newlines
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .replace(/\s{2,}/g, ' ')
        // Expand common abbreviations for better TTS
        .replace(/\bDr\./g, 'Doctor')
        .replace(/\bMr\./g, 'Mister')
        .replace(/\bMrs\./g, 'Missus')
        .replace(/\bMs\./g, 'Miss')
        .replace(/\betc\./gi, 'et cetera')
        .replace(/\bvs\./gi, 'versus')
        .replace(/\bi\.e\./gi, 'that is')
        .replace(/\be\.g\./gi, 'for example')
        // Numbers: spell out lone digits for more natural delivery
        .replace(/\b(\d{1,2})\b/g, _spellSmallNumber)
        .trim();
}

const _NUMBER_WORDS = ['zero','one','two','three','four','five','six','seven','eight','nine',
    'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen',
    'twenty'];

function _spellSmallNumber(_, n) {
    const i = parseInt(n, 10);
    return (i >= 0 && i <= 20) ? _NUMBER_WORDS[i] : n;
}

// ─── Text segmentation ────────────────────────────────────────────────────────

/**
 * segmentText — splits a block of text into individual sentences.
 * Used by neura.js for streaming TTS queue.
 */
export function segmentText(text) {
    if (!text || !text.trim()) return [];

    // Split on sentence-ending punctuation followed by whitespace + capital
    const raw = text
        .replace(/([.!?…])\s+(?=[A-Z"'])/g, '$1\n')
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 1);

    return raw.length ? raw : [text.trim()];
}
