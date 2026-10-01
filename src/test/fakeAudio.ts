/**
 * A recording stand-in for the bits of the Web Audio API the noise builders touch. Node-only
 * (vitest has no jsdom here). Cast at the boundary: `new FakeAudioContext().asContext()`.
 */
export class FakeParam {
  value: number
  calls: { fn: string; args: number[] }[] = []
  constructor(value = 0) {
    this.value = value
  }
  private rec(fn: string, args: number[]): this {
    this.calls.push({ fn, args })
    return this
  }
  setValueAtTime(v: number, t: number) {
    return this.rec('setValueAtTime', [v, t])
  }
  setTargetAtTime(v: number, t: number, c: number) {
    return this.rec('setTargetAtTime', [v, t, c])
  }
  linearRampToValueAtTime(v: number, t: number) {
    return this.rec('linearRampToValueAtTime', [v, t])
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    return this.rec('exponentialRampToValueAtTime', [v, t])
  }
  cancelScheduledValues(t: number) {
    return this.rec('cancelScheduledValues', [t])
  }
}

export class FakeNode {
  readonly connections: unknown[] = []
  disconnected = false
  constructor(readonly kind: string) {}
  connect<T>(dest: T): T {
    this.connections.push(dest)
    return dest
  }
  disconnect(): void {
    this.disconnected = true
  }
}

export class FakeSource extends FakeNode {
  starts: number[][] = []
  stops: number[][] = []
  buffer: unknown = null
  loop = false
  type = 'sine'
  frequency = new FakeParam(440)
  start(...a: number[]) {
    this.starts.push(a)
  }
  stop(...a: number[]) {
    this.stops.push(a)
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1)
}

class FakeFilter extends FakeNode {
  type = 'lowpass'
  frequency = new FakeParam(350)
  Q = new FakeParam(1)
  gain = new FakeParam(0)
}

export class FakeBuffer {
  private data: Float32Array
  constructor(
    length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length)
  }
  get duration() {
    return this.data.length / this.sampleRate
  }
  getChannelData(): Float32Array {
    return this.data
  }
}

export class FakeAudioContext {
  sampleRate = 8000
  currentTime = 0
  readonly nodes: FakeNode[] = []
  private add<T extends FakeNode>(n: T): T {
    this.nodes.push(n)
    return n
  }
  createGain() {
    return this.add(new FakeGain('gain'))
  }
  createBiquadFilter() {
    return this.add(new FakeFilter('filter'))
  }
  createOscillator() {
    return this.add(new FakeSource('osc'))
  }
  createBufferSource() {
    return this.add(new FakeSource('buffer'))
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(length, sampleRate)
  }
  /** Every oscillator and buffer source created so far. */
  get sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource)
  }
  /** Moves the clock forward and fires scheduler timers (call under `vi.useFakeTimers()`). */
  advance(seconds: number, vi: { advanceTimersByTime(ms: number): unknown }): void {
    this.currentTime += seconds
    vi.advanceTimersByTime(seconds * 1000)
  }
  asContext(): AudioContext {
    return this as unknown as AudioContext
  }
}
