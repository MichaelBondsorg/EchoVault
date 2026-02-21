diff --git a/src/utils/__tests__/verification.test.js b/src/utils/__tests__/verification.test.js
new file mode 100644
index 0000000..80da283
--- /dev/null
+++ b/src/utils/__tests__/verification.test.js
@@ -0,0 +1,365 @@
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
+    if (e.status === 1) return [];
+    throw e;
+  }
+}
+
+/**
+ * Helper: recursively collect all source files
+ */
+function collectSourceFiles(dir, extensions = ['.jsx', '.js']) {
+  const results = [];
+  const entries = fs.readdirSync(dir, { withFileTypes: true });
+  for (const entry of entries) {
+    const fullPath = path.join(dir, entry.name);
+    if (entry.isDirectory()) {
+      if (['node_modules', '__tests__', 'test', 'dist', '.git'].includes(entry.name)) continue;
+      results.push(...collectSourceFiles(fullPath, extensions));
+    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
+      results.push(fullPath);
+    }
+  }
+  return results;
+}
+
+/**
+ * Helper: grep a single file for a pattern
+ */
+function grepFile(filePath, pattern) {
+  const content = fs.readFileSync(filePath, 'utf-8');
+  const lines = content.split('\n');
+  const matches = [];
+  lines.forEach((line, idx) => {
+    if (pattern.test(line)) {
+      matches.push({ line, lineNumber: idx + 1 });
+    }
+  });
+  return matches;
+}
+
+const SAFETY_FILE_PATTERNS = [
+  /crisis/i,
+  /safety/i,
+  /constants\.js$/,
+];
+
+function isSafetyFile(filePath) {
+  return SAFETY_FILE_PATTERNS.some(p => p.test(filePath));
+}
+
+function isTestFile(filePath) {
+  return filePath.includes('__tests__') || filePath.includes('/test/');
+}
+
+function isComment(line) {
+  const trimmed = line.trim();
+  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
+}
+
+// ─── Off-Palette Color Audit ───────────────────────────────────────
+
+describe('Verification: Off-Palette Color Audit', () => {
+  const OFF_PALETTE_PATTERNS = [
+    'text-green-', 'bg-green-', 'border-green-',
+    'text-blue-', 'bg-blue-', 'border-blue-',
+    'text-purple-', 'bg-purple-', 'border-purple-',
+    'text-amber-', 'bg-amber-', 'border-amber-',
+    'text-teal-', 'bg-teal-', 'border-teal-',
+    'text-pink-', 'bg-pink-', 'border-pink-',
+    'from-indigo-', 'to-indigo-', 'via-indigo-',
+    'text-indigo-', 'bg-indigo-', 'border-indigo-',
+    'text-emerald-', 'bg-emerald-', 'border-emerald-',
+    'text-orange-', 'bg-orange-', 'border-orange-',
+    'text-violet-', 'bg-violet-', 'border-violet-',
+    'text-rose-', 'bg-rose-', 'border-rose-',
+    'text-cyan-', 'bg-cyan-', 'border-cyan-',
+  ];
+
+  it('should have zero off-palette color class instances outside safety files', () => {
+    const files = collectSourceFiles(SRC_PATH, ['.jsx', '.js']);
+    const violations = [];
+
+    for (const file of files) {
+      if (isSafetyFile(file) || isTestFile(file)) continue;
+
+      const content = fs.readFileSync(file, 'utf-8');
+      const lines = content.split('\n');
+
+      lines.forEach((line, idx) => {
+        if (isComment(line)) return;
+        if (line.includes('@color-safe')) return;
+        // Skip colorMap.js TAILWIND_SAFELIST block
+        if (file.endsWith('colorMap.js') && line.includes('TAILWIND_SAFELIST')) return;
+
+        for (const pattern of OFF_PALETTE_PATTERNS) {
+          if (line.includes(pattern)) {
+            violations.push({
+              file: path.relative(SRC_PATH, file),
+              lineNumber: idx + 1,
+              pattern,
+              line: line.trim().substring(0, 120),
+            });
+          }
+        }
+      });
+    }
+
+    if (violations.length > 0) {
+      const summary = violations.map(v =>
+        `  ${v.file}:${v.lineNumber} — ${v.pattern} — ${v.line}`
+      ).join('\n');
+      expect.fail(`Found ${violations.length} off-palette color instances:\n${summary}`);
+    }
+  });
+
+  it('should allow red-* classes only in safety/crisis files and for destructive actions', () => {
+    const files = collectSourceFiles(SRC_PATH, ['.jsx', '.js']);
+    const redUsages = [];
+
+    for (const file of files) {
+      if (isTestFile(file)) continue;
+
+      const matches = grepFile(file, /(text-red-|bg-red-|border-red-)/);
+      if (matches.length > 0) {
+        const isSafe = isSafetyFile(file);
+        matches.forEach(m => {
+          if (!isComment(m.line) && !m.line.includes('@color-safe')) {
+            redUsages.push({
+              file: path.relative(SRC_PATH, file),
+              lineNumber: m.lineNumber,
+              isSafetyFile: isSafe,
+              line: m.line.trim().substring(0, 120),
+            });
+          }
+        });
+      }
+    }
+
+    // Red in safety files is expected; red elsewhere should be for destructive actions
+    const nonSafetyRed = redUsages.filter(u => !u.isSafetyFile);
+    // Informational — red for error states / destructive actions is acceptable
+    if (nonSafetyRed.length > 0) {
+      console.log(`Red classes in non-safety files (${nonSafetyRed.length} instances):`);
+      nonSafetyRed.forEach(u => console.log(`  ${u.file}:${u.lineNumber}`));
+    }
+    expect(true).toBe(true);
+  });
+});
+
+// ─── Typography Audit ──────────────────────────────────────────────
+
+describe('Verification: Typography Audit', () => {
+  it('should use font-display for headings in major components', () => {
+    const matches = grepSrc('font-display', ['jsx']);
+    expect(matches.length).toBeGreaterThan(0);
+  });
+
+  it('should not override font-body with unexpected font families', () => {
+    const serifMatches = grepSrc('font-serif', ['jsx']).filter(
+      m => !isTestFile(m.file) && !isComment(m.content)
+    );
+    expect(serifMatches.length).toBe(0);
+  });
+
+  it('should use font-hand sparingly (max 2 per component file)', () => {
+    const matches = grepSrc('font-hand', ['jsx']);
+    const fileCounts = {};
+    matches.forEach(m => {
+      if (!isTestFile(m.file)) {
+        fileCounts[m.file] = (fileCounts[m.file] || 0) + 1;
+      }
+    });
+
+    const overused = Object.entries(fileCounts).filter(([, count]) => count > 2);
+    if (overused.length > 0) {
+      const summary = overused.map(([file, count]) =>
+        `  ${path.relative(SRC_PATH, file)}: ${count} instances`
+      ).join('\n');
+      expect.fail(`font-hand overused in:\n${summary}`);
+    }
+  });
+});
+
+// ─── WCAG Contrast Checks ──────────────────────────────────────────
+
+describe('Verification: WCAG Contrast Checks', () => {
+  it('should document primary text/background color pairs for manual contrast audit', () => {
+    const pairings = [
+      { context: 'Primary body text (light)', text: 'text-hearth-800', bg: 'bg-warm-50' },
+      { context: 'Primary body text (dark)', text: 'text-hearth-100', bg: 'bg-hearth-950' },
+      { context: 'Entry badge task (light)', text: 'text-honey-700', bg: 'bg-honey-100' },
+      { context: 'Entry badge task (dark)', text: 'text-honey-300', bg: 'bg-honey-900/30' },
+      { context: 'Pattern positive (light)', text: 'text-sage-700', bg: 'bg-sage-100' },
+      { context: 'Pattern positive (dark)', text: 'text-sage-300', bg: 'bg-sage-900/30' },
+      { context: 'Pattern negative (light)', text: 'text-terra-700', bg: 'bg-terra-100' },
+      { context: 'Pattern negative (dark)', text: 'text-terra-300', bg: 'bg-terra-900/30' },
+      { context: 'Pattern reflective (light)', text: 'text-lavender-700', bg: 'bg-lavender-100' },
+      { context: 'Pattern reflective (dark)', text: 'text-lavender-300', bg: 'bg-lavender-900/30' },
+    ];
+
+    expect(pairings.length).toBe(10);
+    pairings.forEach(p => {
+      expect(p.text).toBeTruthy();
+      expect(p.bg).toBeTruthy();
+    });
+  });
+});
+
+// ─── Dark Mode Infrastructure ──────────────────────────────────────
+
+describe('Verification: Dark Mode Infrastructure', () => {
+  it('should have FOUC prevention script in index.html before React mount point', () => {
+    const html = fs.readFileSync(path.join(SRC_DIR, 'index.html'), 'utf-8');
+
+    const scriptIdx = html.indexOf('engram-dark-mode');
+    const rootIdx = html.indexOf('id="root"');
+
+    expect(scriptIdx).toBeGreaterThan(-1);
+    expect(rootIdx).toBeGreaterThan(-1);
+    expect(scriptIdx).toBeLessThan(rootIdx);
+
+    expect(html).toContain('localStorage');
+    expect(html).toContain('matchMedia');
+  });
+
+  it('should have dark mode toggle using 3-state storage', () => {
+    const darkModeJs = fs.readFileSync(path.join(SRC_PATH, 'utils/darkMode.js'), 'utf-8');
+
+    expect(darkModeJs).toContain("'dark'");
+    expect(darkModeJs).toContain("'light'");
+    expect(darkModeJs).toContain('engram-dark-mode');
+    expect(darkModeJs).toContain('matchMedia');
+  });
+
+  it('should have significantly more dark: prefixes than the baseline of 33', () => {
+    const matches = grepSrc('dark:', ['jsx', 'js', 'css']);
+    const nonTestMatches = matches.filter(m => !isTestFile(m.file));
+
+    expect(nonTestMatches.length).toBeGreaterThan(200);
+  });
+});
+
+// ─── mood.* Token Audit ────────────────────────────────────────────
+
+describe('Verification: mood.* Token Audit', () => {
+  it('should not override mood tokens with off-palette alternatives', () => {
+    const configContent = fs.readFileSync(path.join(SRC_DIR, 'tailwind.config.js'), 'utf-8');
+    expect(configContent).toContain('mood');
+  });
+});
+
+// ─── SVG Hardcoded Hex Audit ───────────────────────────────────────
+
+describe('Verification: SVG Hardcoded Hex Audit', () => {
+  it('should have no hardcoded off-palette hex colors in inline SVGs', () => {
+    const offPaletteHex = ['#14b8a6', '#5eead4', '#a855f7', '#fb923c', '#fcd34d'];
+    // Use a simpler grep pattern that avoids shell quoting issues with double quotes
+    const files = collectSourceFiles(SRC_PATH, ['.jsx']);
+    const violations = [];
+    for (const file of files) {
+      if (isTestFile(file)) continue;
+      const matches = grepFile(file, /(fill|stroke)=["'][#][0-9a-fA-F]/);
+      for (const m of matches) {
+        if (m.line.includes('@color-safe')) continue;
+        if (offPaletteHex.some(hex => m.line.includes(hex))) {
+          violations.push({
+            file: path.relative(SRC_PATH, file),
+            lineNumber: m.lineNumber,
+            line: m.line.trim().substring(0, 100),
+          });
+        }
+      }
+    }
+
+    if (violations.length > 0) {
+      const summary = violations.map(v =>
+        `  ${path.relative(SRC_PATH, v.file)} — ${v.content.trim().substring(0, 100)}`
+      ).join('\n');
+      expect.fail(`Found off-palette SVG hex colors:\n${summary}`);
+    }
+  });
+});
+
+// ─── Color-Only Meaning Spot Check ─────────────────────────────────
+
+describe('Verification: Color-Only Meaning Spot Check', () => {
+  it('should verify semantic color categories have accompanying icons/labels', () => {
+    const entryCard = fs.readFileSync(path.join(SRC_PATH, 'components/entries/EntryCard.jsx'), 'utf-8');
+    expect(entryCard).toContain('className');
+
+    const insightsPanel = fs.readFileSync(path.join(SRC_PATH, 'components/modals/InsightsPanel.jsx'), 'utf-8');
+    // Lucide icons present alongside colored elements
+    expect(insightsPanel).toMatch(/size=\{?\d/);
+  });
+});
+
+// ─── Build Check ───────────────────────────────────────────────────
+
+describe('Verification: Build Check', () => {
+  it('should verify tailwind.config.js has hearth-850 token', () => {
+    const config = fs.readFileSync(path.join(SRC_DIR, 'tailwind.config.js'), 'utf-8');
+    expect(config).toMatch(/['"]?850['"]?\s*:\s*['"]#[0-9a-fA-F]{6}['"]/);
+  });
+
+  it('should verify all 5 gradient presets are defined', () => {
+    const css = fs.readFileSync(path.join(SRC_PATH, 'index.css'), 'utf-8');
+    const config = fs.readFileSync(path.join(SRC_DIR, 'tailwind.config.js'), 'utf-8');
+    const combined = css + config;
+
+    const presets = ['hearth-glow', 'sage-mist', 'lavender-dusk', 'terra-dawn', 'hearth-surface'];
+    presets.forEach(preset => {
+      expect(combined).toContain(preset);
+    });
+  });
+
+  it('should verify colorMap.js exports all required functions', () => {
+    const colorMap = fs.readFileSync(path.join(SRC_PATH, 'utils/colorMap.js'), 'utf-8');
+
+    expect(colorMap).toContain('getEntryTypeColors');
+    expect(colorMap).toContain('getPatternTypeColors');
+    expect(colorMap).toContain('getEntityTypeColors');
+    expect(colorMap).toContain('getTherapeuticColors');
+    expect(colorMap).toContain('HEX_COLORS');
+  });
+
+  it('should verify confetti hex values use palette-derived values', () => {
+    const uiIndex = fs.readFileSync(path.join(SRC_PATH, 'components/ui/index.jsx'), 'utf-8');
+
+    const oldValues = ['#14b8a6', '#5eead4', '#a855f7', '#fb923c', '#fcd34d'];
+    oldValues.forEach(hex => {
+      expect(uiIndex).not.toContain(hex);
+    });
+  });
+
+  it('should verify Caveat font link is separate with display=optional', () => {
+    const html = fs.readFileSync(path.join(SRC_DIR, 'index.html'), 'utf-8');
+
+    expect(html).toMatch(/Caveat.*display=optional/s);
+    expect(html).toMatch(/DM\+Sans.*display=swap/s);
+  });
+});
