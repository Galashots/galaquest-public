import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createAudioEngine } from '../public/src/audio/engine.js';
import { RECIPES } from '../public/src/audio/recipes.js';

// A minimal stand-in for a real AudioContext -- just enough surface for engine.js to drive: node
// creation, connect() chaining (Web Audio's own connect() returns the node connected TO, which is
// why engine.js can write `osc.connect(gain).connect(ctx.destination)`), start/stop, and a
// createBuffer()/getChannelData() pair for the noise steps. state starts 'suspended', the same as a
// real AudioContext before its first resume(); resume() here is synchronous for a test-friendly
// engine, unlike the real (Promise-based, sometimes-deferred) one -- engine.js must not assume
// resume() has settled by the time it returns.
class FakeAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = { id: 'destination' };
    this.oscillators = [];
    this.gains = [];
    this.bufferSources = [];
    this.buffers = [];
  }

  createOscillator() {
    const node = {
      frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect(target) { return target; },
      start() {},
      stop() {},
    };
    this.oscillators.push(node);
    return node;
  }

  createGain() {
    const node = {
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect(target) { return target; },
    };
    this.gains.push(node);
    return node;
  }

  createBufferSource() {
    const node = {
      buffer: null,
      connect(target) { return target; },
      start() {},
      stop() {},
    };
    this.bufferSources.push(node);
    return node;
  }

  createBuffer(channels, length, sampleRate) {
    const data = new Array(length).fill(0);
    const buffer = { channels, length, sampleRate, getChannelData: () => data };
    this.buffers.push(buffer);
    return buffer;
  }

  resume() {
    this.resumeCalls = (this.resumeCalls ?? 0) + 1;
    this.state = 'running';
    return Promise.resolve();
  }
}

// A context whose resume() only succeeds after a configurable number of attempts -- models a real
// AudioContext whose first resume() doesn't leave it running (still 'suspended' after the gesture),
// so a later gesture must be able to retry it.
class SlowResumeAudioContext extends FakeAudioContext {
  constructor(succeedOnAttempt) {
    super();
    this.succeedOnAttempt = succeedOnAttempt;
    this.resumeCalls = 0;
  }

  resume() {
    this.resumeCalls += 1;
    if (this.resumeCalls >= this.succeedOnAttempt) this.state = 'running';
    return Promise.resolve();
  }
}

// A context whose resume() rejects -- models resume() failing outright (e.g. blocked by the
// browser). unlock() must not let this become an unhandled rejection or a thrown error.
class RejectingAudioContext extends FakeAudioContext {
  resume() {
    this.resumeCalls = (this.resumeCalls ?? 0) + 1;
    return Promise.reject(new Error('resume blocked'));
  }
}

function stepCounts(recipeName) {
  const steps = RECIPES[recipeName];
  return {
    tone: steps.filter((step) => step.type === 'tone').length,
    noise: steps.filter((step) => step.type === 'noise').length,
  };
}

test('never throws when the context factory throws, and stays silent', () => {
  const engine = createAudioEngine({ createContext: () => { throw new Error('no audio here'); } });
  assert.doesNotThrow(() => engine.unlock());
  assert.doesNotThrow(() => engine.play('whoosh'));
  assert.equal(engine.audioDebug().contextState, 'none');
  assert.deepEqual(engine.audioDebug().triggered, {});
});

test('never throws when the context factory returns null, and stays silent', () => {
  const engine = createAudioEngine({ createContext: () => null });
  assert.doesNotThrow(() => engine.unlock());
  assert.doesNotThrow(() => engine.play('whoosh'));
  assert.equal(engine.audioDebug().contextState, 'none');
  assert.deepEqual(engine.audioDebug().triggered, {});
});

test('unlock creates the context exactly once and resumes it', () => {
  const fake = new FakeAudioContext();
  let calls = 0;
  const engine = createAudioEngine({ createContext: () => { calls += 1; return fake; } });

  engine.unlock();
  engine.unlock();
  engine.unlock();

  assert.equal(calls, 1, 'the factory must be called only once across repeated unlock() calls');
  assert.equal(fake.state, 'running', 'unlock() must resume the context');
  assert.equal(engine.audioDebug().contextState, 'running');
});

// A legitimate user gesture should be able to retry an unlock that didn't leave the context
// running -- e.g. a first pointerdown whose resume() doesn't take. There must be no code path that
// makes this a permanent, one-shot failure.
test('an unsuccessful unlock attempt can be retried by a later gesture', () => {
  const fake = new SlowResumeAudioContext(2);
  const engine = createAudioEngine({ createContext: () => fake });

  engine.unlock();
  assert.equal(engine.audioDebug().contextState, 'suspended',
    'the first attempt did not reach running');

  engine.unlock();
  assert.equal(engine.audioDebug().contextState, 'running',
    'a second gesture must be able to retry and succeed');
});

// Once running, further unlock() calls (from further gestures) must not keep doing unlock work --
// resume() should not be called again.
test('once running, further unlock() calls do no further unlock work', () => {
  const fake = new FakeAudioContext();
  const engine = createAudioEngine({ createContext: () => fake });

  engine.unlock();
  assert.equal(fake.resumeCalls, 1);
  assert.equal(engine.audioDebug().contextState, 'running');

  engine.unlock();
  engine.unlock();
  assert.equal(fake.resumeCalls, 1, 'resume() must not be called again once already running');
});

// Failures must remain non-fatal -- audio must never crash the game, including when resume()
// itself rejects asynchronously rather than throwing synchronously.
test('a rejecting resume() is non-fatal and stays silent', async () => {
  const fake = new RejectingAudioContext();
  const engine = createAudioEngine({ createContext: () => fake });

  assert.doesNotThrow(() => engine.unlock());
  // Let the rejected resume() promise settle; the engine must not turn this into an unhandled
  // rejection or a thrown error.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.audioDebug().contextState, 'suspended');
  assert.doesNotThrow(() => engine.play('whoosh'));
});

// Ruling 6's shape decided here: a play() before unlock() has no context to schedule against, so it
// is a no-op -- and per the brief's recommendation, `triggered` counts sounds actually SCHEDULED,
// not attempts, so a pre-unlock play must not appear in it at all.
test('play() before unlock() is a silent no-op that is not counted', () => {
  const fake = new FakeAudioContext();
  const engine = createAudioEngine({ createContext: () => fake });

  engine.play('whoosh');
  engine.play('impact');

  assert.deepEqual(engine.audioDebug().triggered, {});
  assert.equal(fake.oscillators.length, 0);
  assert.equal(fake.bufferSources.length, 0);
});

test('play() after unlock() schedules every step of the recipe and counts it as triggered', () => {
  const fake = new FakeAudioContext();
  const engine = createAudioEngine({ createContext: () => fake });
  engine.unlock();

  engine.play('whoosh');
  const whoosh = stepCounts('whoosh');
  assert.equal(fake.oscillators.length, whoosh.tone);
  assert.equal(fake.bufferSources.length, whoosh.noise);
  assert.equal(engine.audioDebug().triggered.whoosh, 1);

  engine.play('impact');
  const impact = stepCounts('impact');
  assert.equal(fake.oscillators.length, whoosh.tone + impact.tone);
  assert.equal(fake.bufferSources.length, whoosh.noise + impact.noise);
  assert.equal(engine.audioDebug().triggered.impact, 1);

  engine.play('impact');
  assert.equal(engine.audioDebug().triggered.impact, 2);
});

test('every recipe schedules oscillator/noise-source counts matching its own step shape', () => {
  const fake = new FakeAudioContext();
  const engine = createAudioEngine({ createContext: () => fake });
  engine.unlock();

  for (const recipeName of Object.keys(RECIPES)) {
    const before = { osc: fake.oscillators.length, noise: fake.bufferSources.length };
    engine.play(recipeName);
    const expected = stepCounts(recipeName);
    assert.equal(fake.oscillators.length - before.osc, expected.tone, `${recipeName} tone step count`);
    assert.equal(fake.bufferSources.length - before.noise, expected.noise, `${recipeName} noise step count`);
  }
});

test('unknown recipe name is a safe no-op', () => {
  const fake = new FakeAudioContext();
  const engine = createAudioEngine({ createContext: () => fake });
  engine.unlock();

  assert.doesNotThrow(() => engine.play('does-not-exist'));
  assert.deepEqual(engine.audioDebug().triggered, {});
  assert.equal(fake.oscillators.length, 0);
  assert.equal(fake.bufferSources.length, 0);
});

// Ruling 2's "never throws" for the engine, exercised at schedule time rather than at construction:
// a context that exists but fails mid-schedule must still degrade to silence, not crash the frame
// that tried to play a sound.
test('a throw while scheduling degrades to silence rather than propagating or partially counting', () => {
  const fake = new FakeAudioContext();
  fake.createBufferSource = () => { throw new Error('boom'); };
  const engine = createAudioEngine({ createContext: () => fake });
  engine.unlock();

  assert.doesNotThrow(() => engine.play('whoosh'));
  assert.deepEqual(engine.audioDebug().triggered, {});
});

test('audioDebug() reports "none" before any unlock attempt', () => {
  const engine = createAudioEngine({ createContext: () => new FakeAudioContext() });
  assert.equal(engine.audioDebug().contextState, 'none');
  assert.deepEqual(engine.audioDebug().triggered, {});
});
