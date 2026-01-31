// Shared AudioContext to prevent exceeding browser limits on concurrent audio instances
let sharedAudioContext = null;

/**
 * Gets or initializes the shared AudioContext.
 * @returns {AudioContext|null}
 */
export const getAudioContext = () => {
    try {
        if (!sharedAudioContext) {
            sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        // Resume if suspended (browsers auto-suspend context without user interaction)
        if (sharedAudioContext.state === 'suspended') {
            sharedAudioContext.resume();
        }
        return sharedAudioContext;
    } catch (e) {
        console.error('Failed to initialize AudioContext:', e);
        return null;
    }
};

/**
 * Plays a simple beep sound using the Web Audio API.
 * This is more reliable for rapid feedback than playing MP3 files.
 * @param {number} frequency - Frequency in Hz (default 800)
 * @param {number} duration - Duration in seconds (default 0.1)
 * @param {number} volume - Volume from 0 to 1 (default 1.0)
 */
export const playWebAudioBeep = (frequency = 800, duration = 0.1, volume = 1.0) => {
    try {
        const audioContext = getAudioContext();
        if (!audioContext) return;

        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration);
    } catch (error) {
        console.error('Web Audio beep error:', error);
    }
};

/**
 * Plays a coin-like sound effect (two relative beeps).
 */
export const playNotificationSound = () => {
    const audioContext = getAudioContext();
    if (!audioContext) return;

    const now = audioContext.currentTime;

    // High pitched double beep for "coin" effect
    const playBeep = (freq, start, dur) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.3, start);
        gain.gain.exponentialRampToValueAtTime(0.01, start + dur);
        osc.start(start);
        osc.stop(start + dur);
    };

    playBeep(950, now, 0.1);
    playBeep(1200, now + 0.08, 0.15);
};

/**
 * Plays a sequence of beeps as a fallback for the cash register sound.
 */
export const playRegisterFallbackSound = () => {
    const audioContext = getAudioContext();
    if (!audioContext) return;

    const now = audioContext.currentTime;
    const playBeep = (freq, start, dur) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.5, start);
        gain.gain.exponentialRampToValueAtTime(0.01, start + dur);
        osc.start(start);
        osc.stop(start + dur);
    };

    playBeep(800, now, 0.05);
    playBeep(1000, now + 0.05, 0.05);
    playBeep(1200, now + 0.1, 0.1);
};
