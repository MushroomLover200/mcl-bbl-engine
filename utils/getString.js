/**
 * Extracts a substring between two delimiters.
 * @param {string} string - The source string.
 * @param {string} left - The left delimiter.
 * @param {string} right - The right delimiter.
 * @returns {string|null} The extracted string or null if not found.
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

module.exports = getString;