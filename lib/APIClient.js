const axios = require('axios');
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
        this.xsrfToken = null;
        
        this.client = axios.create({
            baseURL: BASE_URL,
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
                'Origin': BASE_URL,
                'Referer': `${BASE_URL}/ultra`,
                'Accept': 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        // Synchronization
        this.ready = new Promise((resolve) => {
            this._resolveReady = resolve;
        });
        this._isReadyResolved = false;
    }

    _log(level, message) {
        this.emit('log', { date: Date.now(), level, message });
    }

    setSession({ cookie, userData, xsrfToken }) {
        if (cookie) this.cookie = cookie;
        if (userData) this.userData = userData;
        if (xsrfToken) this.xsrfToken = xsrfToken;

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
        
        const url = `/learn/api/v1/users/${this.userData.id}/memberships?expand=course.effectiveAvailability,course.permissions,courseRole&includeCount=true&limit=10000`;

        const response = await this._fetchWithBBLCookies(url);
        const { courses } = parseCourses(response.data);
        
        this.emit('fetch:courses', courses);
        this._log('INFO', 'Successfully fetched and processed courses.');
        return courses;
    }

    async _fetchWithBBLCookies(url, options = {}) {
        if (!this.cookie) {
            throw new Error('Cannot fetch: Session cookie is not available.');
        }

        const method = (options.method || 'GET').toUpperCase();
        const headers = {
            ...options.headers,
            'Cookie': this.cookie
        };

        if (['PUT', 'POST', 'PATCH', 'DELETE'].includes(method)) {
            if (!this.xsrfToken) {
                console.error(`ERROR: State-changing request (${method}) made without xsrfToken!`);
            } else {
                headers['X-Blackboard-Xsrf'] = this.xsrfToken;
            }
        }

        const config = {
            url,
            method,
            headers,
            data: options.body,
        };

        const response = await this.client(config);

        // Check for new cookies
        if (response.headers['set-cookie']) {
             this.emit('cookie:update', response.headers['set-cookie']);
        }

        return response;
    }
}

module.exports = APIClient;