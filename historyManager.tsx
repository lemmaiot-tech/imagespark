/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Represents an item in the download history gallery.
 */
export interface GalleryItem {
  src: string;
  prompt: string;
}

const STORAGE_KEY_HISTORY = 'imageSparkHistory';
const HISTORY_LIMIT = 20;

/**
 * A self-contained module to manage download history in localStorage.
 */
const historyManager = {
    /**
     * Retrieves the download history from localStorage.
     * @returns {GalleryItem[]} An array of history items.
     */
    getHistory(): GalleryItem[] {
        try {
            const data = localStorage.getItem(STORAGE_KEY_HISTORY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error("Failed to parse history, clearing.", e);
            localStorage.removeItem(STORAGE_KEY_HISTORY);
            return [];
        }
    },

    /**
     * Saves the entire history array to localStorage.
     * @param {GalleryItem[]} history The history array to save.
     */
    saveHistory(history: GalleryItem[]) {
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
    },

    /**
     * Adds a new item to the download history.
     * @param {GalleryItem} item The item to add.
     */
    addDownload(item: GalleryItem) {
        let history = this.getHistory();
        history.unshift(item); // Add to the beginning
        if (history.length > HISTORY_LIMIT) {
            history = history.slice(0, HISTORY_LIMIT); // Keep only the latest items
        }
        this.saveHistory(history);
    },

    /**
     * Clears the entire download history from localStorage.
     */
    clearHistory() {
        localStorage.removeItem(STORAGE_KEY_HISTORY);
    }
};

export default historyManager;
