import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFreshnessTick } from '../useFreshnessTick';

describe('useFreshnessTick', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at 0', () => {
    const { result } = renderHook(() => useFreshnessTick());
    expect(result.current).toBe(0);
  });

  it('bumps on visibilitychange when the document becomes visible', () => {
    const { result } = renderHook(() => useFreshnessTick());
    expect(result.current).toBe(0);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(result.current).toBe(1);
  });

  it('does not bump on visibilitychange when the document becomes hidden', () => {
    const { result } = renderHook(() => useFreshnessTick());

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(result.current).toBe(0);
  });

  it('bumps every intervalMs while the document stays visible', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    const { result } = renderHook(() => useFreshnessTick(1000));

    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(1);

    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBe(3);
  });

  it('does not bump on the interval while the document is hidden', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const { result } = renderHook(() => useFreshnessTick(1000));

    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(0);
  });

  it('defaults intervalMs to 5 minutes', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    const { result } = renderHook(() => useFreshnessTick());

    act(() => { vi.advanceTimersByTime(5 * 60 * 1000 - 1); });
    expect(result.current).toBe(0);

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(1);
  });

  it('cleans up the visibilitychange listener and interval on unmount', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    const { result, unmount } = renderHook(() => useFreshnessTick(1000));
    expect(result.current).toBe(0);

    unmount();
    act(() => { vi.advanceTimersByTime(10000); });
    document.dispatchEvent(new Event('visibilitychange'));

    // No error thrown, and (since the component is unmounted) no way to
    // observe further bumps — this mainly guards against a leaked timer
    // throwing after unmount / setting state on an unmounted hook.
    expect(result.current).toBe(0);
  });
});
