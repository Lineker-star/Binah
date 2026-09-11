import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the IndexedDB layer so importing AudioPlayer doesn't pull in Dexie.
const getMock = vi.fn();
vi.mock('@/lib/utils/database', () => ({
  db: { audioFiles: { get: getMock } },
}));

function stubObjectUrl() {
  let next = 0;
  const createObjectURL = vi.fn(() => `blob:fake-url-${++next}`);
  const revokeObjectURL = vi.fn();
  class URLStub extends URL {}
  Object.assign(URLStub, { createObjectURL, revokeObjectURL });
  vi.stubGlobal('URL', URLStub);
}

/** A play() whose promise only settles when the test calls `resolvePlay()` --
 *  models the real gap between HTMLMediaElement.play() returning a promise
 *  and that promise actually settling, which is exactly the window the
 *  "interrupted by a call to pause()" race lives in. */
function stubAudioWithControllablePlay() {
  const pause = vi.fn();
  let resolvePlay!: () => void;
  const playPromise = new Promise<void>((resolve) => {
    resolvePlay = resolve;
  });
  const play = vi.fn(() => playPromise);
  class AudioStub {
    play = play;
    addEventListener = vi.fn();
    pause = pause;
    volume = 1;
    defaultPlaybackRate = 1;
    playbackRate = 1;
    src = '';
    currentTime = 0;
    paused = false;
  }
  vi.stubGlobal('Audio', AudioStub);
  return { pause, play, resolvePlay: () => resolvePlay() };
}

describe('AudioPlayer pause()/play() race', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    getMock.mockReset();
    getMock.mockResolvedValue({ blob: new Blob(['audio']) });
  });

  it('defers the native pause() until play() settles, instead of racing it', async () => {
    stubObjectUrl();
    const { pause, play, resolvePlay } = stubAudioWithControllablePlay();

    const { AudioPlayer } = await import('@/lib/utils/audio-player');
    const player = new AudioPlayer();

    const playing = player.play('audio-1');

    // play() resolves bytes (async) before it ever reaches audio.play() --
    // wait for that to actually happen, or the pause() below would see no
    // element yet and this test would pass for the wrong reason.
    await vi.waitFor(() => expect(play).toHaveBeenCalled(), { timeout: 5000 });

    // pause() called while the native play() is still pending must not
    // touch the element yet -- that's the exact sequence that produces
    // "The play() request was interrupted by a call to pause()".
    player.pause();
    expect(pause).not.toHaveBeenCalled();

    // Once play() actually settles, the deferred pause() fires.
    resolvePlay();
    await playing;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('stop() called mid-play defers the native pause() the same way', async () => {
    stubObjectUrl();
    const { pause, play, resolvePlay } = stubAudioWithControllablePlay();

    const { AudioPlayer } = await import('@/lib/utils/audio-player');
    const player = new AudioPlayer();

    const playing = player.play('audio-1');
    await vi.waitFor(() => expect(play).toHaveBeenCalled(), { timeout: 5000 });

    player.stop();
    expect(pause).not.toHaveBeenCalled();

    resolvePlay();
    await playing;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pause).toHaveBeenCalledTimes(1);
  });
});
