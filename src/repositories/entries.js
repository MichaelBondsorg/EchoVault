/**
 * Entries Repository
 *
 * Repository for journal entry CRUD operations.
 * Centralizes all Firestore access for entries.
 */

import { BaseRepository } from './base';
import { where, orderBy, Timestamp } from '../config/firebase';
import { sanitizeEntry } from '../utils/entries';

class EntriesRepository extends BaseRepository {
  constructor() {
    super('entries');
  }

  // ============================================
  // ENTRY-SPECIFIC QUERIES
  // ============================================

  /**
   * Find entries by category
   * @param {string} userId
   * @param {string} category
   * @param {Object} options - { limit, orderDirection }
   */
  async findByCategory(userId, category, options = {}) {
    const constraints = [where('category', '==', category)];

    if (options.orderByField !== false) {
      constraints.push(orderBy(options.orderByField || 'createdAt', options.orderDirection || 'desc'));
    }

    return this.findWhere(userId, constraints);
  }

  /**
   * Find entries for a specific date range
   * @param {string} userId
   * @param {Date} startDate
   * @param {Date} endDate
   */
  async findByDateRange(userId, startDate, endDate) {
    const constraints = [
      where('effectiveDate', '>=', Timestamp.fromDate(startDate)),
      where('effectiveDate', '<=', Timestamp.fromDate(endDate)),
      orderBy('effectiveDate', 'desc')
    ];

    return this.findWhere(userId, constraints);
  }

  /**
   * Find entries for a specific date (by effectiveDate or createdAt)
   * @param {string} userId
   * @param {string} dateString - YYYY-MM-DD format
   */
  async findByDate(userId, dateString) {
    // Get all entries and filter client-side since Firestore doesn't support date part queries
    const entries = await this.findAll(userId, { orderByField: 'createdAt', orderDirection: 'desc' });

    return entries.filter(entry => {
      const entryDate = entry.effectiveDate?.toDate?.() || entry.createdAt?.toDate?.() || new Date();
      return entryDate.toISOString().split('T')[0] === dateString;
    });
  }

  /**
   * Find recent entries
   * @param {string} userId
   * @param {number} count
   */
  async findRecent(userId, count = 10) {
    return this.findAll(userId, {
      orderByField: 'createdAt',
      orderDirection: 'desc',
      limitCount: count
    });
  }

  /**
   * Find entries with pending analysis
   * @param {string} userId
   */
  async findPendingAnalysis(userId) {
    return this.findByField(userId, 'analysisStatus', '==', 'pending');
  }

  /**
   * Find entries without embeddings
   * @param {string} userId
   */
  async findWithoutEmbeddings(userId) {
    const entries = await this.findAll(userId);
    return entries.filter(e => !e.embedding || !Array.isArray(e.embedding) || e.embedding.length === 0);
  }

  /**
   * Find safety-flagged entries
   * @param {string} userId
   */
  async findSafetyFlagged(userId) {
    return this.findByField(userId, 'safety_flagged', '==', true);
  }

  // ============================================
  // ENTRY-SPECIFIC OPERATIONS
  // ============================================

  /**
   * Create a new entry with proper initialization
   * @param {string} userId
   * @param {Object} entryData
   */
  async createEntry(userId, entryData) {
    const now = Timestamp.now();

    const entry = {
      text: entryData.text,
      category: entryData.category || 'personal',
      analysisStatus: 'pending',
      embedding: entryData.embedding || null,
      createdAt: now,
      effectiveDate: entryData.effectiveDate ? Timestamp.fromDate(new Date(entryData.effectiveDate)) : now,
      userId,
      signalExtractionVersion: entryData.signalExtractionVersion || 1,
      context_version: entryData.context_version || 1
    };

    // Optional fields
    if (entryData.safety_flagged) {
      entry.safety_flagged = true;
      if (entryData.safety_user_response) {
        entry.safety_user_response = entryData.safety_user_response;
      }
    }

    if (entryData.has_warning_indicators) {
      entry.has_warning_indicators = true;
    }

    if (entryData.healthContext) {
      entry.healthContext = entryData.healthContext;
    }

    if (entryData.environmentContext) {
      entry.environmentContext = entryData.environmentContext;
    }

    return this.create(userId, entry);
  }

  /**
   * Update entry analysis
   * @param {string} userId
   * @param {string} entryId
   * @param {Object} analysis
   */
  async updateAnalysis(userId, entryId, analysis) {
    return this.update(userId, entryId, {
      analysis,
      analysisStatus: 'complete',
      title: analysis.themes?.[0] || 'Untitled',
      tags: analysis.themes || []
    });
  }

  /**
   * Update entry embedding
   * @param {string} userId
   * @param {string} entryId
   * @param {number[]} embedding
   */
  async updateEmbedding(userId, entryId, embedding) {
    return this.update(userId, entryId, { embedding });
  }

  /**
   * Update entry text and trigger re-analysis
   * @param {string} userId
   * @param {string} entryId
   * @param {string} newText
   * @param {Object} options - { triggerReanalysis: boolean }
   */
  async updateText(userId, entryId, newText, options = {}) {
    const updates = { text: newText };

    if (options.triggerReanalysis) {
      updates.analysisStatus = 'pending';
      updates.signalExtractionVersion = (options.currentVersion || 0) + 1;
    }

    return this.update(userId, entryId, updates);
  }

  /**
   * Update entry date
   * @param {string} userId
   * @param {string} entryId
   * @param {Date} newDate
   */
  async updateEffectiveDate(userId, entryId, newDate) {
    return this.update(userId, entryId, {
      effectiveDate: Timestamp.fromDate(newDate)
    });
  }

  // ============================================
  // SANITIZATION
  // ============================================

  /**
   * Get sanitized entry by ID
   * @param {string} userId
   * @param {string} entryId
   */
  async findByIdSanitized(userId, entryId) {
    const entry = await this.findById(userId, entryId);
    if (!entry) return null;
    return sanitizeEntry(entry.id, entry);
  }

  /**
   * Get all entries sanitized
   * @param {string} userId
   * @param {Object} options
   */
  async findAllSanitized(userId, options = {}) {
    const entries = await this.findAll(userId, options);
    return entries.map(e => sanitizeEntry(e.id, e)).filter(Boolean);
  }
}

// Export singleton instance
export const entriesRepository = new EntriesRepository();

// Also export class for testing
export { EntriesRepository };
