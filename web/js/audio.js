// ===== AUDIO =====
// Thin wrapper over HTMLAudioElement. Every clip is optional: if a file is not
// present in web/audio/ the corresponding call becomes a no-op, so the game runs
// unchanged until the assets are dropped in. See web/audio/AUDIO.md.

const AUDIO_BASE_PATH = 'audio/';

// name -> { file, volume, poolSize, minInterval (seconds), loop }
const AUDIO_CLIPS = {
    musicMenu: { file: 'music_menu.mp3', volume: 0.4, loop: true },
    musicBattle: { file: 'music_battle.mp3', volume: 0.35, loop: true },
    uiClick: { file: 'ui_click.mp3', volume: 0.5, poolSize: 2, minInterval: 0.05 },
    shipAttack: { file: 'ship_attack.mp3', volume: 0.25, poolSize: 6, minInterval: 0.08 },
    shipDestroyed: { file: 'ship_destroyed.mp3', volume: 0.35, poolSize: 6, minInterval: 0.06 },
    planetCaptured: { file: 'planet_captured.mp3', volume: 0.6, poolSize: 3, minInterval: 0.2 },
    planetLost: { file: 'planet_lost.mp3', volume: 0.6, poolSize: 3, minInterval: 0.2 },
    upgrade: { file: 'upgrade.mp3', volume: 0.6, poolSize: 2 },
    victory: { file: 'victory.mp3', volume: 0.7 },
    defeat: { file: 'defeat.mp3', volume: 0.7 }
};

const SOUND_STORAGE_KEY = 'stellarConquest.sound';
const MUSIC_STORAGE_KEY = 'stellarConquest.music';

class AudioManager {
    constructor() {
        this.soundEnabled = this._loadFlag(SOUND_STORAGE_KEY, true);
        this.musicEnabled = this._loadFlag(MUSIC_STORAGE_KEY, true);
        this.unlocked = false;
        this.currentTrack = null;

        this._pools = new Map();     // name -> HTMLAudioElement[]
        this._cursors = new Map();   // name -> next element in the pool
        this._lastPlayed = new Map();// name -> timestamp (ms)
        this._missing = new Set();   // clips whose file failed to load

        // Browsers refuse to start audio before a user gesture; arm on the first one.
        const unlock = () => {
            this.unlocked = true;
            if (this.currentTrack) this.playMusic(this.currentTrack);
        };
        document.addEventListener('pointerdown', unlock, { once: true });
        document.addEventListener('keydown', unlock, { once: true });
    }

    _loadFlag(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v === null ? fallback : v === '1';
        } catch {
            return fallback;
        }
    }

    _saveFlag(key, value) {
        try {
            localStorage.setItem(key, value ? '1' : '0');
        } catch {
            // Storage can be unavailable (private mode); the setting just won't persist.
        }
    }

    _element(name) {
        const clip = AUDIO_CLIPS[name];
        const el = new Audio(AUDIO_BASE_PATH + clip.file);
        el.preload = 'none';
        el.volume = clip.volume;
        if (clip.loop) el.loop = true;
        el.addEventListener('error', () => this._missing.add(name));
        return el;
    }

    // Pools grow lazily: a clip whose file is absent only ever requests it once.
    _elementAt(name, index) {
        let pool = this._pools.get(name);
        if (!pool) {
            pool = [];
            this._pools.set(name, pool);
            this._cursors.set(name, 0);
        }
        if (!pool[index]) pool[index] = this._element(name);
        return pool[index];
    }

    _play(name) {
        if (!this.soundEnabled || !AUDIO_CLIPS[name] || this._missing.has(name)) return;
        const clip = AUDIO_CLIPS[name];
        if (clip.minInterval) {
            const now = performance.now();
            const last = this._lastPlayed.get(name) || -Infinity;
            if (now - last < clip.minInterval * 1000) return;
            this._lastPlayed.set(name, now);
        }
        const cursor = this._cursors.get(name) || 0;
        const el = this._elementAt(name, cursor);
        this._cursors.set(name, (cursor + 1) % (clip.poolSize || 1));
        el.currentTime = 0;
        const p = el.play();
        if (p) p.catch(() => { /* autoplay blocked or file missing */ });
    }

    // ----- music -----
    playMusic(name) {
        this.currentTrack = name;
        if (!this.musicEnabled || !AUDIO_CLIPS[name] || this._missing.has(name)) return;
        this.stopMusic(false);
        const el = this._elementAt(name, 0);
        el.currentTime = 0;
        const p = el.play();
        if (p) p.catch(() => { /* waits for the first user gesture */ });
    }

    stopMusic(clearTrack = true) {
        for (const name of ['musicMenu', 'musicBattle']) {
            const pool = this._pools.get(name);
            if (pool && pool[0]) { pool[0].pause(); pool[0].currentTime = 0; }
        }
        if (clearTrack) this.currentTrack = null;
    }

    // ----- settings -----
    setSoundEnabled(enabled) {
        this.soundEnabled = enabled;
        this._saveFlag(SOUND_STORAGE_KEY, enabled);
    }

    setMusicEnabled(enabled) {
        this.musicEnabled = enabled;
        this._saveFlag(MUSIC_STORAGE_KEY, enabled);
        if (enabled) {
            if (this.currentTrack) this.playMusic(this.currentTrack);
        } else {
            this.stopMusic(false);
        }
    }

    // ----- game events -----
    playUiClick() { this._play('uiClick'); }
    playShipAttack() { this._play('shipAttack'); }
    playShipDestroyed() { this._play('shipDestroyed'); }
    playUpgrade() { this._play('upgrade'); }
    // AI-vs-AI captures stay silent; only the player's gains and losses are cued.
    playPlanetCaptured(newTeam, oldTeam) {
        if (newTeam === 1) this._play('planetCaptured');
        else if (oldTeam === 1) this._play('planetLost');
    }

    playGameOver(playerWon) {
        this.stopMusic();
        this._play(playerWon ? 'victory' : 'defeat');
    }
}

const audio = new AudioManager();
