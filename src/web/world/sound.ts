export class Sound {
  enabled = false;
  private context: AudioContext | null = null;

  private audio(): AudioContext | null {
    if (!this.enabled) return null;
    this.context ??= new AudioContext();

    return this.context;
  }

  private tone(frequency: number, start: number, duration: number, kind: OscillatorType, volume: number): void {
    const context = this.audio();

    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = context.currentTime + start;
    oscillator.type = kind;
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.05);
  }

  hatch(): void {
    this.tone(880, 0, 0.12, "sine", 0.08);
    this.tone(1320, 0.06, 0.1, "sine", 0.05);
  }

  befriend(): void {
    for (const [index, frequency] of [523.25, 659.25, 783.99].entries())
      this.tone(frequency, index * 0.04, 0.9, "triangle", 0.05);
  }

  win(): void {
    this.tone(90, 0, 0.25, "sine", 0.25);
    this.tone(60, 0.02, 0.3, "square", 0.04);
  }
}
