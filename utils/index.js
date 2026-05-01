/**
 * Extracts a substring between two delimiters.
 */
function getString(string, left, right) {
    if (!string || typeof string !== 'string') return null;
    const leftIndex = string.indexOf(left);
    if (leftIndex === -1) return null;
    const start = leftIndex + left.length;
    const rightIndex = string.indexOf(right, start);
    if (rightIndex === -1) return null;
    return string.substring(start, rightIndex);
}

/**
 * Processes a raw LMS course enrollment object.
 */
function parseCourses(coursesDataObject) {
    if (!coursesDataObject || !Array.isArray(coursesDataObject.results)) {
        return { courses: [] };
    }
    const courses = coursesDataObject.results
        .filter(enrollment => enrollment.course && !enrollment.course.isOrganization)
        .map(enrollment => {
            const courseDetails = enrollment.course;
            return {
                ...parseCourseDetails(courseDetails?.courseId),
                courseName: courseDetails?.name,
                id: courseDetails?.id,
            };
        });
    return { courses };
}

/**
 * Parses courseId to extract course code, term, and school year.
 * @param {string} courseId 
 */
function parseCourseDetails(courseId) {
    const parts = courseId.split('.');
    
    // 1. Actual Course ID is usually the first segment
    const courseCode = parts[0];

    // 2. Extract Term using Regex (Looking for patterns like 1T, 2T, 3T)
    const termMatch = courseId.match(/(\d+T)/);
    const term = termMatch ? termMatch[1] : "N/A";

    // 3. Extract School Year using Regex (Looking for YY.YY pattern)
    // We look for two digits, a dot, and two digits (e.g., 25.26 or 25.02)
    const yearMatch = courseId.match(/(\d{2})\.(\d{2})/);
    const schoolYear = yearMatch ? `${yearMatch[1]}.${yearMatch[2]}` : "N/A";

    return {
        originalId: courseId,
        courseCode,
        term,
        schoolYear
    };
}

/**
 * Strips HTML tags but preserves layout for paragraphs and line breaks.
 * @param {string} html 
 * @param {string} indentStr - The string to use for indentation (default 2 spaces)
 */
function stripHtmlWithFormatting(html, indentStr = ' ') {
    if (!html) return "";

    let text = html;

    // 1. Remove script and style tags entirely
    text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");

    // 2. Handle <br> tags (replace with a newline)
    text = text.replace(/<br\s*\/?>/gi, "\n");

    // 3. Handle <p> tags
    // Replace opening <p> with a newline + indent
    text = text.replace(/<p[^>]*>/gi, `\n${indentStr}`);
    // Replace closing </p> with a newline
    text = text.replace(/<\/p>/gi, "\n");

    // 4. Handle <div> tags (often used for blocks)
    // Just ensure they start on a new line
    text = text.replace(/<div[^>]*>/gi, "\n");
    text = text.replace(/<\/div>/gi, "\n");

    // 5. Remove all remaining HTML tags
    text = text.replace(/<[^>]*>/g, "");

    // 6. Decode HTML Entities
    const entities = {
        '&nbsp;': ' ',
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
        '&copy;': '©'
    };
    text = text.replace(/&[a-z0-9]+;/gi, (match) => entities[match] || match);
    return text
        .replace(/\n\s*\n\s*\n/g, "\n\n") 
        .trim();
}

module.exports = {
    getString,
    parseCourses,
    stripHtmlWithFormatting
};