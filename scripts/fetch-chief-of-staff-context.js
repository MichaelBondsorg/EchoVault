#!/usr/bin/env node

/**
 * Fetch Chief of Staff Context
 *
 * Calls the getChiefOfStaffContext Cloud Function and saves the result
 * to ~/.chief-of-staff/state/michael/context.json
 *
 * Setup:
 *   Store your API key in ~/.chief-of-staff/.env:
 *   CHIEF_OF_STAFF_API_KEY=your-key-here
 *
 * Usage:
 *   node scripts/fetch-chief-of-staff-context.js [--days=30]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Configuration
const PROJECT_ID = 'echo-vault-app';
const FUNCTION_REGION = 'us-central1';
const FUNCTION_URL = `https://${FUNCTION_REGION}-${PROJECT_ID}.cloudfunctions.net/getChiefOfStaffContext`;

// Paths
const CHIEF_OF_STAFF_DIR = join(homedir(), '.chief-of-staff');
const ENV_PATH = join(CHIEF_OF_STAFF_DIR, '.env');
const OUTPUT_DIR = join(CHIEF_OF_STAFF_DIR, 'state', 'michael');
const OUTPUT_PATH = join(OUTPUT_DIR, 'context.json');

function loadEnv() {
  if (!existsSync(ENV_PATH)) {
    return {};
  }
  const content = readFileSync(ENV_PATH, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  }
  return env;
}

async function main() {
  console.log('🔄 Fetching Chief of Staff context...\n');

  // Parse arguments
  const args = process.argv.slice(2);
  const daysArg = args.find(a => a.startsWith('--days='));
  const sinceDays = daysArg ? parseInt(daysArg.split('=')[1]) : 30;

  // Load API key from .env
  const env = loadEnv();
  const apiKey = env.CHIEF_OF_STAFF_API_KEY;

  if (!apiKey) {
    console.error('❌ API key not found.\n');
    console.error('Setup:');
    console.error(`1. Create/edit: ${ENV_PATH}`);
    console.error('2. Add this line:');
    console.error('   CHIEF_OF_STAFF_API_KEY=your-key-here\n');
    process.exit(1);
  }

  try {
    console.log(`📅 Fetching last ${sinceDays} days of context...`);
    console.log('📡 Calling Cloud Function...');

    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: { apiKey, sinceDays }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Function call failed (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    const context = result.result;

    // Ensure output directory exists
    if (!existsSync(OUTPUT_DIR)) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Add metadata
    context.fetchedAt = new Date().toISOString();
    context.fetchedForDays = sinceDays;

    // Save to file
    writeFileSync(OUTPUT_PATH, JSON.stringify(context, null, 2));

    // Print summary
    console.log('\n✅ Context fetched successfully!\n');
    console.log('📊 Summary:');
    console.log(`   Entries: ${context.summary?.totalEntries || 0}`);
    console.log(`   Active Goals: ${context.summary?.activeGoals || 0}`);
    console.log(`   Active Insights: ${context.summary?.activeInsights || 0}`);
    console.log(`   Active Patterns: ${context.summary?.activePatterns || 0}`);
    console.log(`   Known People: ${context.summary?.knownPeople || 0}`);
    console.log(`   Active Threads: ${context.summary?.activeThreads || 0}`);

    if (context.moodTrend) {
      const avg = context.moodTrend.average;
      const dir = context.moodTrend.direction || '';
      console.log(`   Mood: ${avg ? (avg * 100).toFixed(0) + '%' : 'N/A'}${dir ? ` (${dir})` : ''}`);
    }

    console.log(`\n📁 Saved to: ${OUTPUT_PATH}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
