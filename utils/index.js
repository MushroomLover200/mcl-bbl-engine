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
                courseId: courseDetails?.courseId,
                courseName: courseDetails?.name,
                id: courseDetails?.id,
            };
        });
    return { courses };
}

module.exports = {
    getString,
    parseCourses
};