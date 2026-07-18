# Cloud Design System — Implementation Spec

Redesign of EchoVault/Engram's mobile UI ("Hearthside" → "Cloud").
Target stack: **Tailwind CSS + shadcn/ui** with CSS variables. Replaces theme code in `src/index.css` and `tailwind.config.js`.
Reference mockups: `engram-redesign-mockups.dc.html` (turns 3, 5–10). Screens: Home, Journal, Insights, AI chat, Voice session, New entry, Settings (+ details: Health, AI & memory, People & places, Therapist export, Reports), Safety plan, Crisis resources, Decompression, Breathing, Grounding, Guided sessions, Quick mood, Day summary, Entry insights, Welcome, Streak celebration.

---

## 1 · Design principles

- Calm, premium, minimal. No glassmorphism, no amber/beige, no handwriting fonts.
- Warm-neutral surfaces ("greige", not zinc) + ONE user-selectable accent.
- White cards with 1px borders and shadow-sm on a soft off-white canvas.
- Serif (Newsreader) is reserved for reflective/emotional moments; Geist for all UI.
- Motion is slow (1.6–10s), always ease-in-out, and always optional (`prefers-reduced-motion`).

## 2 · Core CSS variables

```css
:root {
  --background: #F7F6F2;        /* canvas */
  --card: #FFFFFF;
  --border: #E9E6DF;
  --divider: #F2F0EA;           /* hairlines inside cards */
  --foreground: #1E1D19;
  --secondary-foreground: #4A4842;
  --muted-foreground: #8A867B;
  --faint: #B0ACA1;             /* timestamps, placeholders */
  --primary: #1E1D19;           /* light-mode CTA = ink */
  --primary-foreground: #F7F6F2;
  --destructive: #B0665A;
  --radius: 1rem;               /* cards 16px; chips/CTAs pill (999px) */
}
.dark {
  --background: #151618;
  --card: #1E1F22;
  --border: #2B2C30;
  --divider: #292A2E;
  --foreground: #F0F0EE;
  --secondary-foreground: #B9B8B2;
  --muted-foreground: #96979A;
  --faint: #6A6B6E;
  --primary: var(--accent-btn);          /* dark-mode CTA = lightened accent */
  --primary-foreground: var(--accent-btn-fg);
}
```

## 3 · Accent themes

User-selectable in Settings → App → Accent color (swatch row, 22px circles, active ring)
and mirrored anywhere theme is set. Apply as `data-accent="blue|mauve|terracotta"` on `<html>`;
persist in ThemeContext/localStorage.

### Dusty Blue (default)
```css
[data-accent="blue"] {
  --accent: #667FA8;  --accent-deep: #3D5273;  --accent-wash: #EEF0F4;
  --accent-1: #E2E7EF; --accent-2: #D3DBE8; --accent-3: #B9C6DA; --accent-4: #8FA3C2;
  --accent-wave: rgba(102,127,168,.17);
}
.dark[data-accent="blue"] {
  --accent: #9DB4D8;  --accent-btn: #AFC0DC;  --accent-btn-fg: #1C2330;
  --accent-wash-dark: #1A1E24;
  --accent-d1: #262B33; --accent-d2: #2E3642; --accent-d3: #3C4859; --accent-d4: #56688a;
  --accent-wave-dark: rgba(157,180,216,.09);
}
```

### Mauve
```css
[data-accent="mauve"] {
  --accent: #8E7BA8;  --accent-deep: #5E4F73;  --accent-wash: #F1EEF4;
  --accent-1: #E8E3EF; --accent-2: #DCD4E7; --accent-3: #C7BAD8; --accent-4: #AC9CC2;
  --accent-wave: rgba(142,123,168,.17);
}
.dark[data-accent="mauve"] {
  --accent: #B4A5D0;  --accent-btn: #C3B6DA;  --accent-btn-fg: #262033;
  --accent-wash-dark: #1D1A22;
  --accent-d1: #2A2631; --accent-d2: #342E3F; --accent-d3: #453C55; --accent-d4: #66597f;
  --accent-wave-dark: rgba(180,165,208,.09);
}
```

### Terracotta
```css
[data-accent="terracotta"] {
  --accent: #B87355;  --accent-deep: #7E4A33;  --accent-wash: #F5EFEB;
  --accent-1: #EFE2DB; --accent-2: #E7D2C6; --accent-3: #D8B5A3; --accent-4: #CC9880;
  --accent-wave: rgba(184,115,85,.17);
}
.dark[data-accent="terracotta"] {
  --accent: #D8A288;  --accent-btn: #E0B29A;  --accent-btn-fg: #2E211A;
  --accent-wash-dark: #211B18;
  --accent-d1: #2E2622; --accent-d2: #3A2E28; --accent-d3: #4D3B32; --accent-d4: #75544392;
  --accent-wave-dark: rgba(216,162,136,.09);
}
```

Accent usage: mood dots, active nav item, toggles (checked), progress/equalizer bars,
chips text, links, the tide widget, Pebble's gradient, wave background. Light-mode CTAs
stay ink (`--primary: #1E1D19`); dark-mode CTAs use `--accent-btn`.

## 4 · Typography

| Role | Font | Size / weight |
|---|---|---|
| Page title | Newsreader 500 | 24–27px, letter-spacing -0.01em |
| Reflective copy / quotes / celebration headline | Newsreader 400–500 (italic ok) | 14–30px |
| Card title | Geist 600 | 13–15px |
| Body | Geist 400–500 | 13.5px / 1.5–1.65 |
| Meta / timestamps | Geist 400 | 11.5px, `--faint` |
| Section label | Geist 600 | 11px, uppercase, +0.1em, `--muted-foreground` |

Google Fonts: Geist 400/500/600/700 · Newsreader 400/500/600 (+italic). Remove Fraunces, DM Sans, Caveat.

## 5 · Component map (shadcn/ui)

| UI element | shadcn primitive | Notes |
|---|---|---|
| Cards, grouped lists | `Card` | radius 16, border `--border`, `shadow-sm`; rows divided by `--divider` |
| Filter chips / Week-Month | `Tabs` or `ToggleGroup` | pill; active = `--accent-deep` bg, canvas text |
| Primary CTA | `Button` | pill, 44–52px tall, `--primary` bg, soft shadow |
| Secondary CTA | `Button variant="outline"` | white bg, `--border` |
| Toggles | `Switch` | checked = `--accent` |
| Bottom sheets (new entry, day summary, entry insights) | `Drawer` | radius 24 top, grab handle 36×4 |
| Quick mood | `Dialog` | centered, radius 22 |
| Checkboxes (export include) | `Checkbox` | radius 6, checked = `--accent` |
| Accent picker | custom | 22px swatch circles, active = 2px ring offset |
| Tab bar | custom | 5 items, center 48px raised FAB (`--primary` light / `--accent-btn` dark) |

## 6 · Signature elements

### 6.1 Linen + wave background (every top-level screen)
- Canvas: `linear-gradient(180deg, var(--accent-wash) 0%, var(--background) 240px)`.
- Grain: tiled 256×256 SVG feTurbulence (fractalNoise, baseFrequency .9, 4 octaves,
  stitchTiles='stitch') at 4.5% opacity (3.5% dark). Must declare explicit
  `background-size: 256px 256px` to avoid tile seams.
- Waves: a 2400×2400px layer positioned -1600px top/left holding 2–3 radial-gradient
  rings (transparent → `--accent-wave` → transparent), each animating
  `translate(-52px,-52px) ↔ translate(52px,52px)` at 11s / 15s / 19s ease-in-out
  alternate with negative delays. On screen this reads as long curved bands drifting
  top-left ↔ bottom-right. Pointer-events none; behind all content.
- Gate the wave behind a "Background motion" toggle + `prefers-reduced-motion`.

### 6.2 Rising tide (momentum widget)
Stat card, overflow hidden. Two absolutely-positioned rounded squares
(`border-radius: 44%` / `40%`, accent bg at 22% / 14% opacity, sized ~280% of card,
positioned ~55% down) rotating 12s / 17s (one reversed). Content above the water.
Copy: `+12%` + "Rising" / "tide rising".

### 6.3 Pebble mascot
CSS-only blob: `border-radius: 48% 52% 55% 45% / 58% 54% 46% 42%`,
`background: linear-gradient(160deg, var(--accent-3), var(--accent))`, ink facial
features (dark mode: features `#151618`, gradient accent-d4 → accent).
Ship as `<Pebble state size />` with states:

| state | face | motion | used in |
|---|---|---|---|
| calm | oval eyes + small smile | breathe 8s, blink every 5s | home, welcome |
| listening | wide eyes, "o" mouth | tilt ±4° 4s + 3 equalizer dots | voice session |
| celebrating | arc-up eyes, big smile | bounce 1.6s + 4–5 confetti pips | streak milestone |
| empathy | inner-ends-UP tilted brows, soft eyes | rotate -5°, breathe 9s | crisis, hard days |
| resting | closed-arc eyes | breathe 10s + drifting z's | decompression, night |
| thinking | eyes up, mouth tilt | thought dots pulsing | insight generation |

Empathy brows: left `rotate(-12deg)`, right `rotate(12deg)` — inner ends UP
(inner-ends-down reads angry).

### 6.4 Motion vocabulary (keyframes)
```
breathe: scale(1) → scale(1.08)      · 4–10s ease-in-out infinite
tilt:    rotate(-4deg) ↔ rotate(4deg) · 4s
bounce:  translateY 0/-12/-4/-8px     · 1.6s
rise:    translateY(6px)→(-6px), fade · 2.2–2.8s (confetti, ↗ arrow)
eq:      scaleY(.25) ↔ scaleY(1)      · 1.1–1.2s staggered (voice bars, caret)
blink:   scaleY(1)→(.1)→(1) at 92–95% · 5s
wave:    translate(-52,-52) ↔ (52,52) · 11/15/19s alternate
spin:    rotate(360deg)               · 12–17s linear (tide)
```

## 7 · Screen-by-screen notes

- **Home**: greeting (serif) → Reflect card (prompt + Write/Speak) → 3 stat cells
  (Avg mood / Streak / Rising tide) → mood-trend bar card → Recent list. Tab bar:
  Home, Journal, [+], Insights, Settings.
- **Journal**: search icon, filter chips, day-grouped Card lists, mood dot per row,
  meta line "6:12 PM · Voice · 2 min · calm".
- **Insights**: Week/Month segment, trend bars (accent scale, today = full accent),
  momentum tide + streak cells, Patterns card (dot + sentence, bold stat).
- **AI chat**: companion bubbles = white cards (radius 16/6 corner), user = accent-deep,
  suggestion chips, pill input + accent mic button. Subtitle "here with you".
- **Voice session**: listening Pebble → LISTENING caps → 12-bar equalizer (staggered eq)
  → live transcript (user grey / companion serif quote). Controls: mute, End session
  (dark pill), switch-to-text.
- **New entry**: Drawer with grab handle, Reflect context chip, 15px/1.65 editor with
  blinking accent caret, mic + Aa buttons, Save entry pill.
- **Settings**: profile row, sections HEALTH & DATA / AI & PRIVACY / APP.
  APP contains Accent color swatches, Dark mode, Notifications.
- **Crisis resources**: empathy Pebble, serif "You're not alone right now.", 988 call
  card (accent-deep, white text), Crisis Text Line, grounding link, safety-plan link.
  Never red/alarming.
- **Streak celebration**: full screen post-save; celebrating Pebble + confetti, serif
  "8 days. A new personal best.", dot tracker (record dot ringed), Keep it going CTA,
  "Share with my therapist" text link.
- Minimum hit targets 44px. Dark mode is a first-class theme, not an afterthought.
