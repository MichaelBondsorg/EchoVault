/**
 * App Icon Generator for EchoVault
 * Generates all required icon sizes for iOS and Android from source SVG
 *
 * Usage: node scripts/generate-icons.js
 */

import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// iOS icon sizes (for App Store and device)
const IOS_ICONS = [
  { size: 1024, name: 'AppIcon-512@2x.png' }, // App Store (required)
  { size: 180, name: 'AppIcon-60@3x.png' },   // iPhone @3x
  { size: 120, name: 'AppIcon-60@2x.png' },   // iPhone @2x
  { size: 167, name: 'AppIcon-83.5@2x.png' }, // iPad Pro @2x
  { size: 152, name: 'AppIcon-76@2x.png' },   // iPad @2x
  { size: 80, name: 'AppIcon-40@2x.png' },    // Spotlight @2x
  { size: 120, name: 'AppIcon-40@3x.png' },   // Spotlight @3x
  { size: 58, name: 'AppIcon-29@2x.png' },    // Settings @2x
  { size: 87, name: 'AppIcon-29@3x.png' },    // Settings @3x
  { size: 40, name: 'AppIcon-20@2x.png' },    // Notification @2x
  { size: 60, name: 'AppIcon-20@3x.png' },    // Notification @3x
];

// Android icon sizes (mipmap folders)
const ANDROID_ICONS = [
  { size: 48, folder: 'mipmap-mdpi' },
  { size: 72, folder: 'mipmap-hdpi' },
  { size: 96, folder: 'mipmap-xhdpi' },
  { size: 144, folder: 'mipmap-xxhdpi' },
  { size: 192, folder: 'mipmap-xxxhdpi' },
];

// Android adaptive icon foreground (with padding for safe zone)
const ANDROID_ADAPTIVE_SIZE = 432; // 108dp * 4 for xxxhdpi

// PWA icons
const PWA_ICONS = [
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
];

async function ensureDir(dir) {
  try {
    await mkdir(dir, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

async function generateIcon(svgBuffer, size, outputPath) {
  await sharp(svgBuffer)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toFile(outputPath);
  console.log(`  ✓ Generated: ${outputPath} (${size}x${size})`);
}

async function generateAdaptiveForeground(svgBuffer, size, outputPath) {
  // Adaptive icons need ~66% of the canvas for the actual icon (safe zone)
  const iconSize = Math.round(size * 0.66);
  const padding = Math.round((size - iconSize) / 2);

  await sharp(svgBuffer)
    .resize(iconSize, iconSize)
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toFile(outputPath);
  console.log(`  ✓ Generated adaptive foreground: ${outputPath}`);
}

async function main() {
  console.log('🎨 EchoVault Icon Generator\n');

  const svgPath = join(__dirname, 'icon-source.svg');
  const svgBuffer = await readFile(svgPath);

  // Generate iOS icons
  console.log('📱 Generating iOS icons...');
  const iosDir = join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
  await ensureDir(iosDir);

  for (const icon of IOS_ICONS) {
    await generateIcon(svgBuffer, icon.size, join(iosDir, icon.name));
  }

  // Update iOS Contents.json
  const iosContents = {
    images: [
      { size: "20x20", idiom: "iphone", scale: "2x", filename: "AppIcon-20@2x.png" },
      { size: "20x20", idiom: "iphone", scale: "3x", filename: "AppIcon-20@3x.png" },
      { size: "29x29", idiom: "iphone", scale: "2x", filename: "AppIcon-29@2x.png" },
      { size: "29x29", idiom: "iphone", scale: "3x", filename: "AppIcon-29@3x.png" },
      { size: "40x40", idiom: "iphone", scale: "2x", filename: "AppIcon-40@2x.png" },
      { size: "40x40", idiom: "iphone", scale: "3x", filename: "AppIcon-40@3x.png" },
      { size: "60x60", idiom: "iphone", scale: "2x", filename: "AppIcon-60@2x.png" },
      { size: "60x60", idiom: "iphone", scale: "3x", filename: "AppIcon-60@3x.png" },
      { size: "20x20", idiom: "ipad", scale: "1x", filename: "AppIcon-20@2x.png" },
      { size: "20x20", idiom: "ipad", scale: "2x", filename: "AppIcon-20@2x.png" },
      { size: "29x29", idiom: "ipad", scale: "1x", filename: "AppIcon-29@2x.png" },
      { size: "29x29", idiom: "ipad", scale: "2x", filename: "AppIcon-29@2x.png" },
      { size: "40x40", idiom: "ipad", scale: "1x", filename: "AppIcon-40@2x.png" },
      { size: "40x40", idiom: "ipad", scale: "2x", filename: "AppIcon-40@2x.png" },
      { size: "76x76", idiom: "ipad", scale: "1x", filename: "AppIcon-76@2x.png" },
      { size: "76x76", idiom: "ipad", scale: "2x", filename: "AppIcon-76@2x.png" },
      { size: "83.5x83.5", idiom: "ipad", scale: "2x", filename: "AppIcon-83.5@2x.png" },
      { size: "1024x1024", idiom: "ios-marketing", scale: "1x", filename: "AppIcon-512@2x.png" }
    ],
    info: { version: 1, author: "EchoVault Icon Generator" }
  };

  await writeFile(join(iosDir, 'Contents.json'), JSON.stringify(iosContents, null, 2));
  console.log('  ✓ Updated Contents.json');

  // Generate Android icons
  console.log('\n🤖 Generating Android icons...');
  const androidResDir = join(ROOT, 'android/app/src/main/res');

  for (const icon of ANDROID_ICONS) {
    const folder = join(androidResDir, icon.folder);
    await ensureDir(folder);

    // Standard launcher icon
    await generateIcon(svgBuffer, icon.size, join(folder, 'ic_launcher.png'));

    // Round launcher icon
    await generateIcon(svgBuffer, icon.size, join(folder, 'ic_launcher_round.png'));

    // Adaptive icon foreground
    const adaptiveSize = Math.round(icon.size * (432 / 192)); // Scale based on xxxhdpi
    await generateAdaptiveForeground(svgBuffer, adaptiveSize, join(folder, 'ic_launcher_foreground.png'));
  }

  // Generate PWA icons
  console.log('\n🌐 Generating PWA icons...');
  const publicDir = join(ROOT, 'public');
  await ensureDir(publicDir);

  for (const icon of PWA_ICONS) {
    await generateIcon(svgBuffer, icon.size, join(publicDir, icon.name));
  }

  console.log('\n✅ All icons generated successfully!');
  console.log('\nNext steps:');
  console.log('  1. Run `npm run cap:sync` to copy assets to native projects');
  console.log('  2. For iOS: Open Xcode and verify icons in Assets.xcassets');
  console.log('  3. For Android: Verify icons in android/app/src/main/res/mipmap-*');
}

main().catch(console.error);
