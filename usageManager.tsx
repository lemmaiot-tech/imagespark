/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Configuration for daily usage limit.
// Easy to update: just change the value of USAGE_LIMIT.
const USAGE_LIMIT = 5;

const STORAGE_KEY = 'imageSparkUsage';

interface UsageData {
  count: number;
  lastReset: number; // Date of the last reset as YYYYMMDD
}

/**
 * Gets a number representing today's date, e.g., 20250721.
 * This is used to check if the counter needs to be reset.
 * @returns {number} The date as a number.
 */
function getTodayDateKey(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return parseInt(`${year}${month}${day}`, 10);
}

/**
 * Retrieves usage data from localStorage and resets it if it's a new day.
 * @returns {UsageData} The current usage data.
 */
function getUsageData(): UsageData {
  const data = localStorage.getItem(STORAGE_KEY);
  const today = getTodayDateKey();

  if (data) {
    try {
        const parsed = JSON.parse(data) as UsageData;
        // Check if we need to reset the counter
        if (parsed.lastReset < today) {
          const freshData = { count: 0, lastReset: today };
          saveUsageData(freshData);
          return freshData;
        }
        return parsed;
    } catch (e) {
        // Data is corrupted, reset it
        console.error("Could not parse usage data, resetting.", e);
    }
  }

  // No data found or it was corrupted, create fresh data
  const initialData = { count: 0, lastReset: today };
  saveUsageData(initialData);
  return initialData;
}

/**
 * Saves usage data to localStorage.
 * @param {UsageData} data The usage data to save.
 */
function saveUsageData(data: UsageData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * A self-contained module to manage daily generation limits.
 */
export const usageManager = {
  /**
   * Checks if the user can perform another generation.
   * @returns {boolean} True if the user is within the daily limit, false otherwise.
   */
  canGenerate(): boolean {
    const data = getUsageData();
    return data.count < USAGE_LIMIT;
  },

  /**
   * Records one generation usage. Should be called after a successful generation.
   */
  recordGeneration() {
    let data = getUsageData();
    if (data.count < USAGE_LIMIT) {
      data.count++;
      saveUsageData(data);
    }
  },

  /**
   * Gets the number of generations remaining for today.
   * @returns {number} The number of remaining generations.
   */
  getRemainingGenerations(): number {
    const data = getUsageData();
    const remaining = USAGE_LIMIT - data.count;
    return remaining > 0 ? remaining : 0;
  },

  /**
   * Gets the total daily limit.
   * @returns {number} The total daily limit.
   */
  getDailyLimit(): number {
    return USAGE_LIMIT;
  }
};
