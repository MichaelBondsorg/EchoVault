/**
 * Process and generate app icons from the new Engram logo
 * Cleans up black corners and generates all required sizes
 */

import sharp from 'sharp';
import { mkdir, copyFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Source image path
const SOURCE_IMAGE = '/Users/michaelbond/Downloads/Gemini_Generated_Image_pgda6pgda6pgda6p.png';

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

async function processAndGenerateIcons() {
  console.log('🎨 Engram Icon Generator\n');
  console.log('Source:', SOURCE_IMAGE);

  // Load the source image
  const image = sharp(SOURCE_IMAGE);
  const metadata = await image.metadata();
  console.log(`Original size: ${metadata.width}x${metadata.height}`);

  // Process the image to fix the corners
  // The logo has a white/light background with dark corners that need to be made white
  // We'll flatten to white background which will clean up any transparency issues
  const processedImage = await image
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toBuffer();

  console.log('✓ Image processed (flattened to white background)');

  // Generate iOS icons
  console.log('\n📱 Generating iOS icons...');
  const iosDir = join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
  await ensureDir(iosDir);

  for (const icon of IOS_ICONS) {
    const outputPath = join(iosDir, icon.name);
    await sharp(processedImage)
      .resize(icon.size, icon.size, {
        fit: 'cover',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .png()
      .toFile(outputPath);
    console.log(`  ✓ ${icon.name} (${icon.size}x${icon.size})`);
  }

  // Generate Android icons
  console.log('\n🤖 Generating Android icons...');
  const androidResDir = join(ROOT, 'android/app/src/main/res');

  for (const icon of ANDROID_ICONS) {
    const folder = join(androidResDir, icon.folder);
    await ensureDir(folder);

    // Standard launcher icon
    await sharp(processedImage)
      .resize(icon.size, icon.size, { fit: 'cover' })
      .png()
      .toFile(join(folder, 'ic_launcher.png'));

    // Round launcher icon (same for now - Android applies mask)
    await sharp(processedImage)
      .resize(icon.size, icon.size, { fit: 'cover' })
      .png()
      .toFile(join(folder, 'ic_launcher_round.png'));

    // Adaptive icon foreground (with padding for safe zone)
    const adaptiveSize = Math.round(icon.size * (432 / 192));
    const iconSize = Math.round(adaptiveSize * 0.66);
    const padding = Math.round((adaptiveSize - iconSize) / 2);

    await sharp(processedImage)
      .resize(iconSize, iconSize, { fit: 'cover' })
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .png()
      .toFile(join(folder, 'ic_launcher_foreground.png'));

    console.log(`  ✓ ${icon.folder} (${icon.size}px)`);
  }

  // Generate PWA icons
  console.log('\n🌐 Generating PWA icons...');
  const publicDir = join(ROOT, 'public');
  await ensureDir(publicDir);

  for (const icon of PWA_ICONS) {
    await sharp(processedImage)
      .resize(icon.size, icon.size, { fit: 'cover' })
      .png()
      .toFile(join(publicDir, icon.name));
    console.log(`  ✓ ${icon.name} (${icon.size}x${icon.size})`);
  }

  // Also save the processed 1024x1024 as a reference
  await sharp(processedImage)
    .resize(1024, 1024, { fit: 'cover' })
    .png()
    .toFile(join(ROOT, 'scripts/icon-source-1024.png'));
  console.log('\n✓ Saved 1024x1024 reference: scripts/icon-source-1024.png');

  console.log('\n✅ All icons generated successfully!');
  console.log('\nNext steps:');
  console.log('  1. Run `npm run cap:sync` to copy assets to native projects');
  console.log('  2. For iOS: Open Xcode and verify icons in Assets.xcassets');
  console.log('  3. For Android: Verify icons in android/app/src/main/res/mipmap-*');
}

processAndGenerateIcons().catch(console.error);
