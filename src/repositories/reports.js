/**
 * Reports Repository
 *
 * Data access for report documents and report preferences.
 */

import { BaseRepository } from './base';

class ReportsRepository extends BaseRepository {
  constructor() {
    super('reports');
  }

  async findAllReports(userId) {
    return this.findAll(userId, { orderByField: 'generatedAt', orderDirection: 'desc' });
  }

  async findByStatus(userId, status) {
    return this.findByField(userId, 'status', '==', status);
  }

  async findByCadence(userId, cadence) {
    return this.findByField(userId, 'cadence', '==', cadence);
  }

  async getReport(userId, reportId) {
    return this.findById(userId, reportId);
  }
}

class ReportPreferencesRepository extends BaseRepository {
  constructor() {
    super('report_preferences');
  }

  async getPreferences(userId, reportId) {
    return this.findById(userId, reportId);
  }

  async savePreferences(userId, reportId, prefs) {
    return this.createWithId(userId, reportId, prefs, { merge: true });
  }
}

export const reportsRepository = new ReportsRepository();
export const reportPreferencesRepository = new ReportPreferencesRepository();
export { ReportsRepository, ReportPreferencesRepository };
