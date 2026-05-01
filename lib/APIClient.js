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
     * Fetches the user's courses.
     * @returns {Promise<object[]>} A promise that resolves to the courses array.
     */
    async getCourses() {
        await this.ready;
        this._log('INFO', 'Fetching courses via API.');
        
        const url = `${API_BASE}/users/${this.userData.id}/memberships?expand=course.effectiveAvailability,course.permissions,courseRole&includeCount=true&limit=10000`;

        const response = await this._fetchWithBBLCookies(url);
        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        
        const responseData = await response.json();
        const { courses } = parseCourses(responseData);
        
        this.emit('fetch:courses', courses);
        this._log('INFO', 'Successfully fetched and processed courses.');
        return courses;
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