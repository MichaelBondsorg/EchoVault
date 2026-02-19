/**
 * Conversation-Ready Insight Injection for Voice Sessions
 *
 * Manages the lifecycle of insight delivery during a voice session:
 * 1. Fetches pre-computed conversation queue from Firestore
 * 2. Builds system prompt fragment for AI insight surfacing
 * 3. Tracks session delivery state (max 2 per session)
 * 4. Gates delivery based on voice tone mood analysis
 * 5. Collects engagement data for post-session write-back
 */

import { firestore, APP_COLLECTION_ID } from '../auth/firebase.js';

const MAX_INSIGHTS_PER_SESSION = 2;

/**
 * A single insight from the conversation_queue document.
 * Matches the Firestore schema from section-08 insight precomputation.
 */
export interface ConversationReadyInsight {
  insightId: string;
  summary: string;
  fullContext: string;
  confidence: number;
  emotionalTone: 'encouraging' | 'reflective' | 'challenging';
  relatedEntryIds: string[];
  suggestedTiming: 'session_start' | 'natural_pause' | 'session_end';
  moodGateThreshold: number;
}

/**
 * Engagement record for a single insight delivery attempt.
 */
export interface InsightEngagementRecord {
  insightId: string;
  sessionId: string;
  deliveryTiming: string;
  userResponse: 'explored' | 'dismissed' | 'deferred';
  explorationDepth: number;
  moodBefore: number | null;
  moodAfter: number | null;
  timestamp: number;
}

/**
 * Manages insight state for a single voice session.
 * Instantiated once per session — NOT a singleton.
 */
export class InsightInjector {
  private userId: string;
  private sessionId: string;
  private insights: ConversationReadyInsight[] = [];
  private engagementRecords: Map<string, InsightEngagementRecord> = new Map();
  private surfacedCount = 0;
  private dismissedIds: Set<string> = new Set();

  constructor(userId: string, sessionId: string) {
    this.userId = userId;
    this.sessionId = sessionId;
  }

  /**
   * Fetch the conversation_queue document from Firestore.
   * Sets internal insights list. Gracefully handles missing docs and errors.
   */
  async initialize(): Promise<void> {
    try {
      const queuePath = `artifacts/${APP_COLLECTION_ID}/users/${this.userId}/nexus/conversation_queue`;
      const snap = await firestore.doc(queuePath).get();

      if (!snap.exists) {
        this.insights = [];
        return;
      }

      const data = snap.data();
      const raw = data?.insights;
      if (!Array.isArray(raw)) {
        this.insights = [];
        return;
      }
      this.insights = raw.filter(
        (item: any) =>
          item &&
          typeof item.insightId === 'string' &&
          typeof item.summary === 'string' &&
          typeof item.confidence === 'number'
      ) as ConversationReadyInsight[];
    } catch (error) {
      console.error(`[insightInjector] Failed to fetch conversation queue for user ${this.userId}:`, error);
      this.insights = [];
    }
  }

  /**
   * Build the system prompt fragment for insight injection.
   * Returns empty string if no insights are available.
   */
  buildInsightSystemPrompt(): string {
    if (this.insights.length === 0) return '';

    const insightList = this.insights
      .map((insight, i) => `${i + 1}. ${insight.summary}`)
      .join('\n');

    return `
## Insights About This User

You have access to these insights about the user's recent patterns.
Surface AT MOST 1-2 of these during the conversation, but ONLY when
it feels natural and contextually relevant. Never force an insight.
If the user seems distressed (low mood), do not surface insights.

Available insights:
${insightList}

When surfacing an insight, use phrases like:
- "I noticed something interesting about your past few weeks..."
- "This connects to something I've been observing..."
- "Would you like to explore a pattern I've noticed?"

If the user says "not now" or deflects, respect that immediately
and move on. Do not bring up the same insight again.
`;
  }

  /**
   * Whether another insight can be surfaced this session.
   */
  canSurfaceInsight(): boolean {
    return this.surfacedCount < MAX_INSIGHTS_PER_SESSION;
  }

  /**
   * Check if the current mood allows surfacing this insight.
   *
   * When moodScore is null (no voice tone data):
   * - Encouraging/reflective: allowed (benefit of the doubt)
   * - Challenging: blocked (err on side of caution)
   */
  checkMoodGate(insight: ConversationReadyInsight, currentMoodScore: number | null): boolean {
    if (currentMoodScore === null) {
      return insight.emotionalTone !== 'challenging';
    }
    return currentMoodScore >= insight.moodGateThreshold;
  }

  /**
   * Record that an insight was shown to the user.
   * Creates an engagement record with initial response 'deferred'.
   */
  markInsightSurfaced(insightId: string, timing: string, moodScore: number | null): void {
    this.surfacedCount++;
    this.engagementRecords.set(insightId, {
      insightId,
      sessionId: this.sessionId,
      deliveryTiming: timing,
      userResponse: 'deferred',
      explorationDepth: 0,
      moodBefore: moodScore,
      moodAfter: null,
      timestamp: Date.now(),
    });
  }

  /**
   * Update engagement record: user explored the insight.
   */
  markInsightExplored(insightId: string, explorationDepth: number): void {
    const record = this.engagementRecords.get(insightId);
    if (record) {
      record.userResponse = 'explored';
      record.explorationDepth = explorationDepth;
    }
  }

  /**
   * Update engagement record: user dismissed the insight.
   */
  markInsightDismissed(insightId: string): void {
    const record = this.engagementRecords.get(insightId);
    if (record) {
      record.userResponse = 'dismissed';
    }
    this.dismissedIds.add(insightId);
  }

  /**
   * Write all engagement records to Firestore.
   * Called at session end. Best-effort — errors are logged but do not block cleanup.
   * Idempotent: clears records after successful commit so double-flush is safe.
   */
  async flushEngagement(): Promise<void> {
    if (this.engagementRecords.size === 0) return;

    try {
      const batch = firestore.batch();
      const basePath = `artifacts/${APP_COLLECTION_ID}/users/${this.userId}/nexus/insight_engagement`;

      for (const record of this.engagementRecords.values()) {
        const docRef = firestore.doc(`${basePath}/${record.insightId}_${this.sessionId}`);
        batch.set(docRef, record);
      }

      await batch.commit();
      this.engagementRecords.clear();
    } catch (error) {
      console.error(`[insightInjector] Failed to flush engagement for session ${this.sessionId}:`, error);
    }
  }

  /**
   * Get the full list of loaded insights.
   */
  getInsights(): ConversationReadyInsight[] {
    return this.insights;
  }

  /**
   * Get the number of insights surfaced this session.
   */
  getSurfacedCount(): number {
    return this.surfacedCount;
  }
}
