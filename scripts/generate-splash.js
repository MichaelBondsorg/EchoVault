/**
 * Splash Screen Generator for EchoVault
 * Generates all required splash screen sizes for iOS and Android
 *
 * Usage: node scripts/generate-splash.js
 */

import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// iOS splash screen sizes
const IOS_SPLASH = [
  { width: 2732, height: 2732, name: 'splash-2732x2732.png' },
  { width: 2732, height: 2732, name: 'splash-2732x2732-1.png' },
  { width: 2732, height: 2732, name: 'splash-2732x2732-2.png' },
];

// Android splash screen sizes (portrait and landscape)
const ANDROID_SPLASH_PORTRAIT = [
  { width: 480, height: 800, folder: 'drawable-port-mdpi' },
  { width: 720, height: 1280, folder: 'drawable-port-hdpi' },
  { width: 960, height: 1600, folder: 'drawable-port-xhdpi' },
  { width: 1440, height: 2560, folder: 'drawable-port-xxhdpi' },
  { width: 1920, height: 3200, folder: 'drawable-port-xxxhdpi' },
];

const ANDROID_SPLASH_LANDSCAPE = [
  { width: 800, height: 480, folder: 'drawable-land-mdpi' },
  { width: 1280, height: 720, folder: 'drawable-land-hdpi' },
  { width: 1600, height: 960, folder: 'drawable-land-xhdpi' },
  { width: 2560, height: 1440, folder: 'drawable-land-xxhdpi' },
  { width: 3200, height: 1920, folder: 'drawable-land-xxxhdpi' },
];

async function ensureDir(dir) {
  try {
    await mkdir(dir, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

async function generateSplash(svgBuffer, width, height, outputPath) {
  await sharp(svgBuffer)
    .resize(width, height, {
      fit: 'cover',
      position: 'center'
    })
    .png()
    .toFile(outputPath);
  console.log(`  ✓ Generated: ${outputPath} (${width}x${height})`);
}

async function main() {
  console.log('🎨 EchoVault Splash Screen Generator\n');

  const svgPath = join(__dirname, 'splash-source.svg');
  const svgBuffer = await readFile(svgPath);

  // Generate iOS splash screens
  console.log('📱 Generating iOS splash screens...');
  const iosSplashDir = join(ROOT, 'ios/App/App/Assets.xcassets/Splash.imageset');
  await ensureDir(iosSplashDir);

  for (const splash of IOS_SPLASH) {
    await generateSplash(svgBuffer, splash.width, splash.height, join(iosSplashDir, splash.name));
  }

  // Update iOS Contents.json for splash
  const iosContents = {
    images: [
      { idiom: "universal", filename: "splash-2732x2732.png", scale: "1x" },
      { idiom: "universal", filename: "splash-2732x2732-1.png", scale: "2x" },
      { idiom: "universal", filename: "splash-2732x2732-2.png", scale: "3x" }
    ],
    info: { version: 1, author: "EchoVault Splash Generator" }
  };

  await writeFile(join(iosSplashDir, 'Contents.json'), JSON.stringify(iosContents, null, 2));
  console.log('  ✓ Updated Contents.json');

  // Generate Android splash screens
  console.log('\n🤖 Generating Android splash screens...');
  const androidResDir = join(ROOT, 'android/app/src/main/res');

  // Portrait splashes
  for (const splash of ANDROID_SPLASH_PORTRAIT) {
    const folder = join(androidResDir, splash.folder);
    await ensureDir(folder);
    await generateSplash(svgBuffer, splash.width, splash.height, join(folder, 'splash.png'));
  }

  // Landscape splashes
  for (const splash of ANDROID_SPLASH_LANDSCAPE) {
    const folder = join(androidResDir, splash.folder);
    await ensureDir(folder);
    await generateSplash(svgBuffer, splash.width, splash.height, join(folder, 'splash.png'));
  }

  // Also generate a default splash.png in drawable folder
  const drawableDir = join(androidResDir, 'drawable');
  await ensureDir(drawableDir);
  await generateSplash(svgBuffer, 1920, 1920, join(drawableDir, 'splash.png'));

  console.log('\n✅ All splash screens generated successfully!');
}

main().catch(console.error);
