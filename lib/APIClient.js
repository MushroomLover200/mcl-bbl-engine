const { EventEmitter } = require('events');
const getCourses = require('../utils/getCourses');

const BASE_URL = 'https://mcl.blackboard.com';
const API_BASE = `${BASE_URL}/learn/api/v1`;

/**
 * Handles interactions with Blackboard APIs.
 */
class APIClient extends EventEmitter {
    constructor() {
        super();
        this.cookie = null;
        this.userData = null;
        this.apiActionQueue = [];
        this.isProcessingApiQueue = false;
    }

    /**
     * Emits a standardized log event.
     * @param {'INFO'|'DEBUG'|'WARN'|'ERROR'} level - The severity level of the log.
     * @param {string} message - The log message.
     * @private
     */
    _log(level, message) {
        this.emit('log', { date: Date.now(), level, message });
    }

    setSession({ cookie, userData }) {
        if (cookie) this.cookie = cookie;
        if (userData) this.userData = userData;
        this._tryProcessApiQueue();
    }

    async getCourses() {
        const action = async () => {
            this._log('INFO', 'Fetching courses via API.');
            if (!this.userData?.id) throw new Error('User data not available for getCourses.');
            const url = `${API_BASE}/users/${this.userData.id}/memberships?expand=course.effectiveAvailability,course.permissions,courseRole&includeCount=true&limit=10000`;

            const response = await this._fetchWithBBLCookies(url);
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            const responseData = await response.json();
            const result = getCourses(responseData);
            this._log('INFO', 'Successfully fetched and processed courses.');
            return result;
        };

        return new Promise((resolve, reject) => {
            this.apiActionQueue.push(async () => {
                try {
                    const result = await action();
                    this.emit('fetch:courses', result);
                    resolve(result);
                } catch (error) {
                    this._log('ERROR', `Failed to fetch courses: ${error.message}`);
                    reject(error);
                }
            });
            this._tryProcessApiQueue();
        });
    }

    async _fetchWithBBLCookies(url, options = {}) {
        if (!this.cookie) {
            throw new Error('Cannot fetch: Session cookie is not available.');
        }

        const headers = new Headers(options.headers || {});
        headers.set('cookie', this.cookie);

        return fetch(url, {
            ...options,
            headers: headers
        });
    }

    async _tryProcessApiQueue() {
        if (!this.cookie || !this.userData || this.isProcessingApiQueue) {
            return;
        }

        this.isProcessingApiQueue = true;
        while (this.apiActionQueue.length > 0) {
            const action = this.apiActionQueue.shift();
            try {
                await action();
            } catch (error) {
                // Handled in individual actions
            }
        }
        this.isProcessingApiQueue = false;
    }
}

module.exports = APIClient;