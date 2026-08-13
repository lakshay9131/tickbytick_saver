const fs = require("fs");
const path = require("path");

const TOKEN_FILE = path.join(__dirname, "tokens.json");

function saveTokens(data) {
    fs.writeFileSync(
        TOKEN_FILE,
        JSON.stringify(data, null, 2)
    );
}

function loadTokens() {
    try {
        const raw = fs.readFileSync(TOKEN_FILE);
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
}

module.exports = {
    saveTokens,
    loadTokens
};