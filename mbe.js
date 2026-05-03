const { EventEmitter } = require('events');
const SessionManager = require('./lib/SessionManager');
const APIClient = require('./lib/APIClient');
const { stripHtmlWithFormatting } = require('./utils/index');

/**
 * The Engine class acts as a facade, coordinating browser automation 
 * and API interactions.
 */
class Engine extends EventEmitter {
    /**
     * Static factory method for clean initialization.
     */
    static async create(options) {
        const engine = new Engine(options);
        await engine.initialized;
        return engine;
    }

    constructor({
        username,
        password,
        refreshInterval = 900000
    }) {
        super();

        this.currentTerm = this._getCurrentTerm();

        this.session = new SessionManager({
            username,
            password
        });

        this.api = new APIClient();
        this.isBusy = false;

        this._setupForwarding();

        this.initialized = this.session.initialize().then(() => {
            this.session.startSessionKeepAlive(refreshInterval);
            return true;
        });
    }

    /**
     * Determines the current academic term and year based on the Asia/Manila timezone.
     * Caches the result to avoid recalculating unnecessarily.
     */
    _getCurrentTerm() {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Manila',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric'
        });
        const parts = formatter.formatToParts(now);
        const dateParts = {};
        parts.forEach(p => dateParts[p.type] = p.value);

        const year = parseInt(dateParts.year, 10);
        const month = parseInt(dateParts.month, 10); // 1-12
        const day = parseInt(dateParts.day, 10);

        // Academic Year Logic: Starts Aug 18
        let ayStartYear = year;
        if (month < 8 || (month === 8 && day < 18)) {
            ayStartYear = year - 1;
        }
        const ayEndYear = ayStartYear + 1;
        const academicYear = `${ayStartYear.toString().substring(2, 4)}.${ayEndYear.toString().substring(2, 4)}`;

        const currentDate = new Date(year, month - 1, day);
        const firstTermStart = new Date(ayStartYear, 7, 18); // Aug is index 7
        const firstTermEnd = new Date(ayStartYear, 10, 28);  // Nov is index 10
        const secondTermStart = new Date(ayStartYear, 10, 29);
        const thirdTermStart = new Date(ayEndYear, 3, 20);   // Apr is index 3

        let term;
        if (currentDate >= firstTermStart && currentDate <= firstTermEnd) {
            term = "1T";
        } else if (currentDate >= secondTermStart && currentDate < thirdTermStart) {
            term = "2T";
        } else {
            term = "3T";
        }

        return {
            term,
            academicYear,
            full: `${term}.${academicYear}`
        };
    }

    _setupForwarding() {
        this._proxyEvents(this.session, ['log', 'error', 'userData:update', 'cookie:update']);
        this._proxyEvents(this.api, ['log', 'error', 'fetch:courses']);

        this.session.on('cookie:update', (cookie) => this.api.setSession({ cookie }));
        this.session.on('userData:update', (userData) => this.api.setSession({ userData }));
    }

    _proxyEvents(source, events) {
        events.forEach(event => {
            source.on(event, (...args) => this.emit(event, ...args));
        });
    }

    _log(level, message) {
        this.emit('log', { date: Date.now(), level, message });
    }

    /**
     * Fetches courses list directly.
     * Returns false if another operation is in progress.
     * @returns {Promise<object[]|boolean>}
     */
    async getCourses() {
        if (this.isBusy) {
            this._log('WARN', 'Engine is busy. Operation cancelled.');
            return false;
        }

        this.isBusy = true;
        try {
            return (await this.api.getCourses()).filter((data) => {
                return data.originalId.indexOf(this._getCurrentTerm().full) >= 0;
            });
        } finally {
            this.isBusy = false;
        }
    }

    /**
     * Fetches announcements. If no courseId is provided, fetches from all courses in the current term.
     * @param {string} [courseId] - The specific course id (_dddddd_) to fetch from.
     */
    async getAnnouncements(courseId = '') {
        if (courseId) {
            this._log('INFO', `Fetching announcements for course ${courseId}`);
            const response = await this.api._fetchWithBBLCookies(
                `https://mcl.blackboard.com/learn/api/v1/courses/${courseId}/announcements?limit=10&offset=0&sort=startDateRestriction%28desc%29`
            );
            const data = await response.json();
            return data.results || [];
        }

        this._log('INFO', 'No courseId provided. Fetching announcements for all current term courses.');
        const currentCourses = await this.getCourses();
        
        if (currentCourses.length === 0) {
            this._log('WARN', 'No courses found for the current term.');
            return [];
        }

        const announcementPromises = currentCourses.map(async (course) => {
            try {
                const response = await this.api._fetchWithBBLCookies(
                    `https://mcl.blackboard.com/learn/api/v1/courses/${course.id}/announcements?limit=10&offset=0&sort=startDateRestriction%28desc%29`
                );
                const data = await response.json();
                // Inject course info into each announcement for context
                return (data.results || []).map(ann => ({
                    ...ann,
                    courseCode: course.courseCode,
                    courseName: course.courseName
                }));
            } catch (err) {
                this._log('ERROR', `Failed to fetch announcements for ${course.courseCode}: ${err.message}`);
                return [];
            }
        });

        const allAnnouncements = await Promise.all(announcementPromises);
        // Flatten and sort by date descending
        return allAnnouncements
            .flat()
            .sort((a, b) => new Date(b.created || b.startDateRestriction) - new Date(a.created || a.startDateRestriction));
    }

    /**
     * Fetches calendar events within a specific time range.
     * @param {number} daysFromNow - How many days in the future to fetch.
     * @param {number} [daysToNow=0] - How many days in the past to fetch.
     */
    async getCalendar(daysFromNow, daysToNow = 0) {
        this._log('INFO', `Fetching calendar from ${daysToNow} days ago to ${daysFromNow} days ahead`);

        const now = new Date();
        
        // Calculate since date (past)
        const sinceDate = new Date(now.getTime() - (daysToNow * 24 * 60 * 60 * 1000));
        // Calculate until date (future)
        const untilDate = new Date(now.getTime() + (daysFromNow * 24 * 60 * 60 * 1000));

        const since = encodeURIComponent(sinceDate.toISOString());
        const until = encodeURIComponent(untilDate.toISOString());

        const response = await this.api._fetchWithBBLCookies(
            `https://mcl.blackboard.com/learn/api/v1/calendars/calendarItems?since=${since}&until=${until}`
        );
        const calendar = await response.json();

        return calendar.results || calendar;
    }

    /**
     * Closes the engine and cleans up resources.
     */
    async close() {
        this._log('INFO', 'Closing Engine.');
        await this.session.close();
    }
}

module.exports = Engine;