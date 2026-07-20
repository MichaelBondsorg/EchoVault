import { describe, it, expect, vi } from 'vitest';
import { runPostSavePipelines } from '../postSavePipeline';

const makeCallbacks = () => ({
  runSignals: vi.fn(),
  runNexus: vi.fn(),
  runAnalysisChain: vi.fn(),
});

describe('runPostSavePipelines', () => {
  it('flag ON: runs signals + nexus but NOT the analysis chain', () => {
    const cb = makeCallbacks();
    const getFlag = vi.fn((name) => name === 'serverAnalysisOrchestrator');

    const result = runPostSavePipelines({ ...cb, getFlag });

    expect(cb.runSignals).toHaveBeenCalledTimes(1);
    expect(cb.runNexus).toHaveBeenCalledTimes(1);
    expect(cb.runAnalysisChain).not.toHaveBeenCalled();
    expect(result).toEqual({ analysisChainSkipped: true });
    expect(getFlag).toHaveBeenCalledWith('serverAnalysisOrchestrator');
  });

  it('flag OFF: runs all three pipelines', () => {
    const cb = makeCallbacks();
    const getFlag = vi.fn(() => false);

    const result = runPostSavePipelines({ ...cb, getFlag });

    expect(cb.runSignals).toHaveBeenCalledTimes(1);
    expect(cb.runNexus).toHaveBeenCalledTimes(1);
    expect(cb.runAnalysisChain).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ analysisChainSkipped: false });
  });

  it('never awaits the injected callbacks (fire-and-forget, matches legacy IIFE behavior)', () => {
    const cb = makeCallbacks();
    // A callback that returns a pending promise must not make
    // runPostSavePipelines itself return a promise or block.
    cb.runAnalysisChain.mockReturnValue(new Promise(() => {}));
    const getFlag = () => false;

    const result = runPostSavePipelines({ ...cb, getFlag });

    expect(result).toEqual({ analysisChainSkipped: false });
  });

  it('runs signals before nexus before the analysis chain (order preserved)', () => {
    const order = [];
    const cb = {
      runSignals: vi.fn(() => order.push('signals')),
      runNexus: vi.fn(() => order.push('nexus')),
      runAnalysisChain: vi.fn(() => order.push('analysis')),
    };
    runPostSavePipelines({ ...cb, getFlag: () => false });
    expect(order).toEqual(['signals', 'nexus', 'analysis']);
  });
});
