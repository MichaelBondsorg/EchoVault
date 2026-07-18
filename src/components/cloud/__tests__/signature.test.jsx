/**
 * Render coverage for the Cloud signature components (task B1-B3).
 * Mirrors the conventions in cloud-kit.test.jsx (A4).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LinenWaveBackground } from '../LinenWaveBackground';
import { Pebble } from '../Pebble';
import { RisingTide } from '../RisingTide';
import { Equalizer } from '../Equalizer';
import { ConfettiPips } from '../ConfettiPips';
import { useUiStore } from '../../../stores/uiStore';

const PEBBLE_STATES = ['calm', 'listening', 'celebrating', 'empathy', 'resting', 'thinking'];

describe('LinenWaveBackground', () => {
  afterEach(() => {
    cleanup();
    useUiStore.setState({ backgroundMotion: true });
  });

  it('renders the static gradient layer', () => {
    const { getByTestId } = render(<LinenWaveBackground />);
    expect(getByTestId('linen-wave-background')).toBeTruthy();
    expect(getByTestId('linen-wave-gradient')).toBeTruthy();
    const grainEl = getByTestId('linen-wave-grain');
    expect(grainEl).toBeTruthy();
    expect(grainEl.style.backgroundSize).toBe('256px 256px');
  });

  it('renders the wave rings when backgroundMotion is enabled', () => {
    useUiStore.setState({ backgroundMotion: true });
    const { getByTestId, container } = render(<LinenWaveBackground />);
    expect(getByTestId('linen-wave-rings')).toBeTruthy();
    // Verify the three wave rings have correct animation classes
    const waveRings = container.querySelectorAll('[class*="animate-cloud-wave"]');
    expect(waveRings.length).toBe(3);
    expect(waveRings[0].className).toContain('animate-cloud-wave-11s');
    expect(waveRings[1].className).toContain('animate-cloud-wave-15s');
    expect(waveRings[2].className).toContain('animate-cloud-wave-19s');
  });

  it('omits the wave rings (but keeps gradient + grain) when backgroundMotion is disabled', () => {
    useUiStore.setState({ backgroundMotion: false });
    const { queryByTestId, getByTestId } = render(<LinenWaveBackground />);
    expect(queryByTestId('linen-wave-rings')).toBeNull();
    expect(getByTestId('linen-wave-gradient')).toBeTruthy();
    expect(getByTestId('linen-wave-grain')).toBeTruthy();
  });

  it('is inert to hit-testing and hidden from the accessibility tree', () => {
    const { getByTestId } = render(<LinenWaveBackground />);
    const el = getByTestId('linen-wave-background');
    expect(el.className).toContain('pointer-events-none');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Pebble', () => {
  it.each(PEBBLE_STATES)('renders the %s state with a distinct state marker', (state) => {
    const { container } = render(<Pebble state={state} />);
    const el = container.querySelector(`[data-pebble-state="${state}"]`);
    expect(el).toBeTruthy();
  });

  it('renders each state with a role of img and a state-specific label', () => {
    PEBBLE_STATES.forEach((state) => {
      const { unmount, getByRole } = render(<Pebble state={state} />);
      expect(getByRole('img', { name: new RegExp(state, 'i') })).toBeTruthy();
      unmount();
    });
  });

  it('scales the rendered size via the size prop', () => {
    const { container: containerA } = render(<Pebble state="calm" size={88} />);
    const { container: containerB } = render(<Pebble state="calm" size={44} />);
    const widthA = parseFloat(containerA.querySelector('[data-pebble-state="calm"]').style.width);
    const widthB = parseFloat(containerB.querySelector('[data-pebble-state="calm"]').style.width);
    expect(widthB).toBeCloseTo(widthA / 2);
  });

  it('empathy brows are inner-ends-UP: left rotate(-12deg), right rotate(12deg)', () => {
    const { getByTestId } = render(<Pebble state="empathy" />);
    const left = getByTestId('pebble-brow-left');
    const right = getByTestId('pebble-brow-right');
    // Guards against the "reads angry" regression the spec explicitly warns
    // about (mirrored signs): left must be negative, right must be positive.
    expect(left.style.transform).toBe('rotate(-12deg)');
    expect(right.style.transform).toBe('rotate(12deg)');
  });

  it('listening state includes 3 equalizer-style dots', () => {
    const { container } = render(<Pebble state="listening" />);
    const dots = container.querySelectorAll('.animate-cloud-eq-1100ms');
    expect(dots.length).toBe(3);
  });

  it('celebrating state includes confetti pips', () => {
    const { container } = render(<Pebble state="celebrating" />);
    const pips = container.querySelectorAll('.animate-cloud-rise-2200ms');
    expect(pips.length).toBeGreaterThanOrEqual(4);
  });
});

describe('RisingTide', () => {
  it('renders children above the two rotating water layers', () => {
    render(
      <RisingTide>
        <span data-testid="tide-content">+12%</span>
      </RisingTide>
    );
    expect(screen.getByTestId('tide-content')).toBeTruthy();
    expect(screen.getByTestId('rising-tide-ring-outer')).toBeTruthy();
    expect(screen.getByTestId('rising-tide-ring-inner')).toBeTruthy();
  });

  it('content sits after (visually above) the water rings in DOM order', () => {
    const { container } = render(
      <RisingTide>
        <span data-testid="tide-content">+12%</span>
      </RisingTide>
    );
    const html = container.innerHTML;
    const contentIdx = html.indexOf('tide-content');
    const outerRingIdx = html.indexOf('rising-tide-ring-outer');
    const innerRingIdx = html.indexOf('rising-tide-ring-inner');
    expect(contentIdx).toBeGreaterThan(outerRingIdx);
    expect(contentIdx).toBeGreaterThan(innerRingIdx);
  });

  it('applies the two spin animation classes (one reversed)', () => {
    const { getByTestId } = render(<RisingTide>content</RisingTide>);
    expect(getByTestId('rising-tide-ring-outer').className).toContain('animate-cloud-spin-12s');
    expect(getByTestId('rising-tide-ring-inner').className).toContain('animate-cloud-spin-17s-reverse');
  });
});

describe('Equalizer', () => {
  it('renders 12 bars by default', () => {
    const { container } = render(<Equalizer />);
    expect(container.querySelectorAll('span').length).toBe(12);
  });

  it('renders a custom bar count', () => {
    const { container } = render(<Equalizer bars={5} />);
    expect(container.querySelectorAll('span').length).toBe(5);
  });

  it('applies the height prop to the container', () => {
    const { container } = render(<Equalizer height={40} />);
    expect(container.firstChild.style.height).toBe('40px');
  });
});

describe('ConfettiPips', () => {
  it('renders 4 pips by default', () => {
    const { container } = render(<ConfettiPips />);
    expect(container.querySelectorAll('span').length).toBe(4);
  });

  it('renders up to 5 pips', () => {
    const { container } = render(<ConfettiPips count={5} />);
    expect(container.querySelectorAll('span').length).toBe(5);
  });

  it('is hidden from the accessibility tree', () => {
    const { container } = render(<ConfettiPips />);
    expect(container.firstChild.getAttribute('aria-hidden')).toBe('true');
  });
});
