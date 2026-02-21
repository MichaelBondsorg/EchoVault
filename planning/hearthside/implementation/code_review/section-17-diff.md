diff --git a/src/App.jsx b/src/App.jsx
index 1128e69..87b3871 100644
--- a/src/App.jsx
+++ b/src/App.jsx
@@ -1987,7 +1987,7 @@ export default function App() {
     const isIOS = Capacitor.getPlatform() === 'ios';
 
     return (
-      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-warm-50 to-honey-50">
+      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-warm-50 to-honey-50 dark:from-hearth-950 dark:to-hearth-900">
         <motion.div
           className="h-16 w-16 bg-gradient-to-br from-honey-600 to-honey-700 rounded-3xl flex items-center justify-center mb-4 shadow-soft-lg rotate-3"
           initial={{ scale: 0, rotate: -10 }}
diff --git a/src/components/ui/DarkModeToggle.jsx b/src/components/ui/DarkModeToggle.jsx
index faf6e75..d8e157e 100644
--- a/src/components/ui/DarkModeToggle.jsx
+++ b/src/components/ui/DarkModeToggle.jsx
@@ -1,10 +1,11 @@
 import { useState, useEffect } from 'react';
 import { Sun, Moon } from 'lucide-react';
-import { motion, AnimatePresence } from 'framer-motion';
+import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
 import { isDarkMode, toggleDarkMode, initDarkMode, cleanupDarkMode } from '../../utils/darkMode';
 
 export default function DarkModeToggle({ className = '' }) {
   const [dark, setDark] = useState(() => isDarkMode());
+  const prefersReducedMotion = useReducedMotion();
 
   useEffect(() => {
     initDarkMode();
@@ -17,12 +18,16 @@ export default function DarkModeToggle({ className = '' }) {
     setDark(newState);
   };
 
+  const iconTransition = prefersReducedMotion
+    ? { duration: 0 }
+    : { duration: 0.2 };
+
   return (
     <motion.button
       className={`p-2 rounded-xl text-hearth-600 dark:text-hearth-300 hover:bg-hearth-100 dark:hover:bg-hearth-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-honey-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-hearth-850 ${className}`}
       onClick={handleToggle}
-      whileHover={{ scale: 1.1 }}
-      whileTap={{ scale: 0.9 }}
+      whileHover={prefersReducedMotion ? {} : { scale: 1.1 }}
+      whileTap={prefersReducedMotion ? {} : { scale: 0.9 }}
       aria-pressed={dark}
       aria-label="Toggle dark mode"
       type="button"
@@ -30,10 +35,10 @@ export default function DarkModeToggle({ className = '' }) {
       <AnimatePresence mode="wait" initial={false}>
         <motion.div
           key={dark ? 'sun' : 'moon'}
-          initial={{ rotate: -90, scale: 0, opacity: 0 }}
-          animate={{ rotate: 0, scale: 1, opacity: 1 }}
-          exit={{ rotate: 90, scale: 0, opacity: 0 }}
-          transition={{ duration: 0.2 }}
+          initial={prefersReducedMotion ? { opacity: 0 } : { rotate: -90, scale: 0, opacity: 0 }}
+          animate={prefersReducedMotion ? { opacity: 1 } : { rotate: 0, scale: 1, opacity: 1 }}
+          exit={prefersReducedMotion ? { opacity: 0 } : { rotate: 90, scale: 0, opacity: 0 }}
+          transition={iconTransition}
         >
           {dark ? <Sun size={20} /> : <Moon size={20} />}
         </motion.div>
diff --git a/src/components/zen/AppLayout.jsx b/src/components/zen/AppLayout.jsx
index 647b243..4b5d8b5 100644
--- a/src/components/zen/AppLayout.jsx
+++ b/src/components/zen/AppLayout.jsx
@@ -299,6 +299,7 @@ const AppLayout = ({
       <main
         className="
           min-h-screen
+          dark:bg-hearth-950
           pt-[calc(env(safe-area-inset-top)+60px)]
           pb-[calc(env(safe-area-inset-bottom)+100px)]
           overflow-y-auto
diff --git a/src/components/zen/MoodBackgroundProvider.jsx b/src/components/zen/MoodBackgroundProvider.jsx
index a3c41f1..d499a38 100644
--- a/src/components/zen/MoodBackgroundProvider.jsx
+++ b/src/components/zen/MoodBackgroundProvider.jsx
@@ -1,5 +1,6 @@
 import { createContext, useContext, useMemo } from 'react';
 import { motion } from 'framer-motion';
+import { isDarkMode } from '../../utils/darkMode';
 
 // Context for sharing mood state across components
 const MoodBackgroundContext = createContext({
@@ -25,7 +26,29 @@ const getMoodCategory = (score) => {
  * @param {string} category - 'warm' | 'balanced' | 'calm'
  * @returns {Object} - CSS gradient color stops
  */
-const getGradientColors = (category) => {
+const getGradientColors = (category, dark = false) => {
+  if (dark) {
+    // Dark mode: muted, transparent gradients over hearth-950 base
+    const darkGradients = {
+      warm: {
+        from: 'rgba(110, 69, 18, 0.3)',   // Honey dark
+        via: 'rgba(37, 53, 39, 0.2)',      // Sage dark
+        to: 'rgba(28, 25, 22, 0.1)',       // Hearth dark
+      },
+      balanced: {
+        from: 'rgba(42, 36, 32, 0.4)',     // Hearth-800
+        via: 'rgba(35, 29, 27, 0.3)',      // Hearth-850
+        to: 'rgba(28, 25, 22, 0.2)',       // Hearth-900
+      },
+      calm: {
+        from: 'rgba(53, 47, 73, 0.3)',     // Lavender dark
+        via: 'rgba(34, 30, 48, 0.2)',      // Lavender deeper
+        to: 'rgba(28, 25, 22, 0.1)',       // Hearth dark
+      },
+    };
+    return darkGradients[category] || darkGradients.balanced;
+  }
+
   const gradients = {
     warm: {
       from: '#FDDB8C',    // Honey gold
@@ -55,7 +78,8 @@ const getGradientColors = (category) => {
  */
 const MoodBackgroundProvider = ({ children, moodScore = 0.5 }) => {
   const moodCategory = useMemo(() => getMoodCategory(moodScore), [moodScore]);
-  const colors = useMemo(() => getGradientColors(moodCategory), [moodCategory]);
+  const dark = isDarkMode();
+  const colors = useMemo(() => getGradientColors(moodCategory, dark), [moodCategory, dark]);
 
   const contextValue = useMemo(
     () => ({ moodScore, moodCategory }),
@@ -65,7 +89,7 @@ const MoodBackgroundProvider = ({ children, moodScore = 0.5 }) => {
   return (
     <MoodBackgroundContext.Provider value={contextValue}>
       {/* Fixed background layer (z-0) */}
-      <div className="fixed inset-0 z-0 overflow-hidden">
+      <div className="fixed inset-0 z-0 overflow-hidden bg-warm-50 dark:bg-hearth-950">
         {/* Animated gradient background */}
         <motion.div
           className="absolute inset-0"
diff --git a/src/index.css b/src/index.css
index c2674f4..08c9037 100644
--- a/src/index.css
+++ b/src/index.css
@@ -178,6 +178,18 @@
     box-shadow: 0 0 20px rgba(122, 158, 126, 0.4);
   }
 
+  /* ============================================
+     Dark Mode Surface Hierarchy
+     ============================================
+     hearth-950 (#131110) — Base/deepest: app background, full-page views
+     hearth-900 (#1C1916) — Raised: panels, sections, modals, sidebars
+     hearth-850 (#231D1B) — Cards/elevated: cards, interactive surfaces
+     hearth-800 (#2A2420) — Overlay: dropdowns, tooltips, hover on cards
+
+     Elevation in dark mode is communicated via progressively lighter
+     surfaces and subtle border highlights, NOT shadows.
+     ============================================ */
+
   /* ============================================
      Cards — Journal-page feel
      ============================================ */
diff --git a/src/utils/__tests__/darkModePolish.test.js b/src/utils/__tests__/darkModePolish.test.js
new file mode 100644
index 0000000..7d23ad8
--- /dev/null
+++ b/src/utils/__tests__/darkModePolish.test.js
@@ -0,0 +1,174 @@
+import { describe, it, expect } from 'vitest';
+import { execSync } from 'child_process';
+import fs from 'fs';
+import path from 'path';
+
+const SRC_DIR = path.resolve(__dirname, '../../..');
+const SRC_PATH = path.join(SRC_DIR, 'src');
+
+/**
+ * Helper: run grep across src/ and return matched lines.
+ * Uses hardcoded paths only — no user input is interpolated.
+ * Returns array of { raw, file, content } objects or empty array.
+ */
+function grepSrc(pattern, extensions = ['js', 'jsx', 'ts', 'tsx', 'css']) {
+  const includes = extensions.map(ext => `--include="*.${ext}"`).join(' ');
+  try {
+    const result = execSync(
+      `grep -rn ${includes} -E "${pattern}" "${SRC_PATH}"`,
+      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
+    );
+    return result.trim().split('\n').filter(Boolean).map(line => {
+      const colonIdx = line.indexOf(':', SRC_PATH.length);
+      const file = line.substring(0, colonIdx);
+      const content = line.substring(colonIdx + 1);
+      return { raw: line, file, content };
+    });
+  } catch (e) {
+    // grep returns exit code 1 when no matches — that's fine
+    if (e.status === 1) return [];
+    throw e;
+  }
+}
+
+describe('Dark Mode Polish - Gradient Dark Variants', () => {
+  it('gradient dark variants in index.css use transparency suffixes', () => {
+    const css = fs.readFileSync(path.join(SRC_PATH, 'index.css'), 'utf-8');
+
+    // Find all html.dark gradient definitions
+    const darkGradientBlocks = css.match(/html\.dark\s+\.gradient-[\w-]+\s*\{[^}]+\}/g) || [];
+    expect(darkGradientBlocks.length).toBeGreaterThan(0);
+
+    for (const block of darkGradientBlocks) {
+      // Skip hearth-surface — it uses opaque colors intentionally (surface gradient)
+      if (block.includes('gradient-hearth-surface')) continue;
+
+      // Dark gradient color stops should use rgba() for transparency
+      expect(block).toMatch(/rgba\(/);
+    }
+  });
+
+  it('tailwind gradient presets have dark variants with transparency', () => {
+    const config = fs.readFileSync(path.join(SRC_DIR, 'tailwind.config.js'), 'utf-8');
+
+    // All dark gradient presets (except hearth-surface) should use rgba
+    const darkPresets = config.match(/dark:\s*\{[^}]+\}/g) || [];
+    expect(darkPresets.length).toBeGreaterThan(0);
+
+    for (const preset of darkPresets) {
+      // hearth-surface uses opaque hex — it's the base surface gradient
+      if (preset.includes('#1C1916') && preset.includes('#231D1B')) continue;
+
+      // All other dark presets should use rgba for transparency
+      expect(preset).toMatch(/rgba\(/);
+    }
+  });
+});
+
+describe('Dark Mode Polish - No Pure Black', () => {
+  it('no bg-black used outside of overlay/modal/brand contexts', () => {
+    const matches = grepSrc('bg-black', ['js', 'jsx']);
+
+    // Filter out legitimate uses:
+    const illegitimate = matches.filter(m => {
+      const content = m.content || '';
+      const file = m.file || '';
+      // Exclude test files (they mention bg-black in test code/comments)
+      if (file.includes('__tests__')) return false;
+      // bg-black with opacity modifier is for overlays — fine
+      if (/bg-black\/\d+/.test(content)) return false;
+      // Apple sign-in button is brand-required (bg-black text-white is Apple's spec)
+      if (content.includes('Apple') || content.includes('@color-safe')) return false;
+      // Apple Sign-in uses bg-black text-white — Apple's HIG requires this exact style
+      if (content.includes('bg-black') && content.includes('text-white')) return false;
+      return true;
+    });
+
+    // Pure bg-black (no opacity) should only exist for brand requirements
+    expect(illegitimate).toEqual([]);
+  });
+
+  it('bg-black with opacity modifiers are only used for overlays/backdrops', () => {
+    const matches = grepSrc('bg-black/\\d+', ['js', 'jsx']);
+
+    // Filter out test files
+    const nonTestMatches = matches.filter(m => !(m.file || '').includes('__tests__'));
+
+    // All bg-black/NN should be in overlay/backdrop/modal/dark-surface contexts
+    for (const match of nonTestMatches) {
+      const content = match.content || '';
+      const hasOverlayContext = (
+        content.includes('inset-0') ||
+        content.includes('backdrop') ||
+        content.includes('modal') ||
+        content.includes('overlay') ||
+        content.includes('z-') ||
+        content.includes('rounded') ||  // rounded elements (icon bgs, progress bars)
+        content.includes('bg-black/2') ||  // low opacity (20-30%) for subtle darkening
+        content.includes('bg-black/3')     // 30% opacity for subtle darkening
+      );
+      expect(hasOverlayContext).toBe(true);
+    }
+  });
+
+  it('no #000000 hex used in component files', () => {
+    const matches = grepSrc('#000000|#000[^0-9a-fA-F]', ['js', 'jsx']);
+
+    // Filter out test files
+    const nonTestMatches = matches.filter(m => !m.file.includes('__tests__'));
+    expect(nonTestMatches).toEqual([]);
+  });
+});
+
+describe('Dark Mode Polish - Elevation Strategy', () => {
+  it('dark mode uses surface color hierarchy', () => {
+    // Verify all three tiers are used somewhere in the codebase
+    const tier950 = grepSrc('dark:bg-hearth-950');
+    const tier900 = grepSrc('dark:bg-hearth-900');
+    const tier850 = grepSrc('dark:bg-hearth-850');
+
+    expect(tier950.length).toBeGreaterThan(0); // app-level backgrounds
+    expect(tier900.length).toBeGreaterThan(0); // raised surfaces
+    expect(tier850.length).toBeGreaterThan(0); // cards, interactive elements
+  });
+
+  it('dark mode cards use border-based elevation', () => {
+    const css = fs.readFileSync(path.join(SRC_PATH, 'index.css'), 'utf-8');
+
+    // The .card dark variant should use border, not just shadow
+    const darkCardBlock = css.match(/html\.dark\s+\.card\s*\{[^}]+\}/);
+    expect(darkCardBlock).not.toBeNull();
+    expect(darkCardBlock[0]).toMatch(/border/);
+  });
+
+  it('index.css documents the dark surface hierarchy', () => {
+    const css = fs.readFileSync(path.join(SRC_PATH, 'index.css'), 'utf-8');
+
+    // A comment documenting the hierarchy should exist
+    expect(css).toMatch(/hearth-950.*base|950.*deepest|950.*background/i);
+    expect(css).toMatch(/hearth-900.*raised|900.*panel|900.*section/i);
+    expect(css).toMatch(/hearth-850.*card|850.*elevated|850.*interactive/i);
+  });
+});
+
+describe('Dark Mode Polish - Hover/Focus Visibility', () => {
+  it('DarkModeToggle respects prefers-reduced-motion', () => {
+    const toggle = fs.readFileSync(
+      path.join(SRC_PATH, 'components/ui/DarkModeToggle.jsx'), 'utf-8'
+    );
+
+    expect(toggle).toMatch(/prefers-reduced-motion|reducedMotion|reduced.motion/i);
+  });
+
+  it('dark focus-visible styles exist in base CSS', () => {
+    const css = fs.readFileSync(path.join(SRC_PATH, 'index.css'), 'utf-8');
+    expect(css).toMatch(/html\.dark\s+:focus-visible/);
+  });
+});
+
+describe('Dark Mode Polish - Scrollbar Dark Mode', () => {
+  it('dark mode scrollbar styles exist', () => {
+    const css = fs.readFileSync(path.join(SRC_PATH, 'index.css'), 'utf-8');
+    expect(css).toMatch(/html\.dark\s+::-webkit-scrollbar-thumb/);
+  });
+});
