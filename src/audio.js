export class Sound {
  constructor() {
    this.muted = true;
    this.context = null;
    this.last = 0;
  }
  unlock() {
    if (this.muted) return;
    try {
      this.context ||= new (window.AudioContext || window.webkitAudioContext)();
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch {
      this.muted = true;
    }
  }
  play(type) {
    if (this.muted || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (now - this.last < 0.055) return;
    this.last = now;
    try {
      const oscillator = this.context.createOscillator(),
        gain = this.context.createGain();
      const tones = {
        hit: [520, 160, 0.12],
        hurt: [130, 60, 0.2],
        cast: [390, 880, 0.22],
        release: [210, 110, 0.25],
        pickup: [880, 1400, 0.18],
        ascend: [220, 1320, 1.2],
        purchase: [660, 990, 0.2],
        death: [170, 60, 0.3],
      };
      const [from, to, duration] = tones[type] || [330, 440, 0.16];
      oscillator.type = ['hit', 'hurt', 'release'].includes(type) ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(from, now);
      oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start();
      oscillator.stop(now + duration + 0.02);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    } catch {
      /* Audio never blocks play. */
    }
  }
}
