const { EventEmitter } = require('events');
const { parseCourses } = require('../utils');

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
        
        // Synchronization
        this.lock = Promise.resolve();
        this.ready = new Promise((resolve) => {
            this._resolveReady = resolve;
        });
        this._isReadyResolved = false;
    }

    _log(level, message) {
        this.emit('log', { date: Date.now(), level, message });
    }

    setSession({ cookie, userData }) {
        if (cookie) this.cookie = cookie;
        if (userData) this.userData = userData;

        if (this.cookie && this.userData && !this._isReadyResolved) {
            this._resolveReady();
            this._isReadyResolved = true;
        }
    }

    /**
     * Executes a task sequentially using a promise-based mutex.
     * @private
     */
    async _enqueue(task) {
        await this.ready;
        const result = this.lock.then(task);
        this.lock = result.catch(() => {}); // Maintain chain even on error
        return result;
    }

    async getCourses() {
        return this._enqueue(async () => {
            this._log('INFO', 'Fetching courses via API.');
            const url = `${API_BASE}/users/${this.userData.id}/memberships?expand=course.effectiveAvailability,course.permissions,courseRole&includeCount=true&limit=10000`;

            const response = await this._fetchWithBBLCookies(url);
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            
            const responseData = await response.json();
            const result = parseCourses(responseData);
            this.emit('fetch:courses', result);
            this._log('INFO', 'Successfully fetched and processed courses.');
            return result;
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
}

module.exports = APIClient;