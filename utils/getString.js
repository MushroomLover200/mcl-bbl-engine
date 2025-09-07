/**
 * 
 * @param {string} string 
 * @param {string} left 
 * @param {string} right 
 * @returns {string|boolean}
 */
function getString(string, left, right) {
    try {
        return string.split(left)[1].split(right)[0];
    }catch{
        return false;
    }
}

module.exports = getString;