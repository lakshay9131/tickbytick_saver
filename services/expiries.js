const axios = require("axios");

const {
    loadTokens
} = require("../dynamic_data/tokensave");

const JWT_TOKEN =
    loadTokens()?.access_token ||
    process.env.JWT_TOKEN;

// ======================================
// STATIC EXPIRY CONFIG
// ======================================

const EXPIRY_CONFIG = {

    NIFTY: [

            "19-05-2026",
            "26-05-2026",
            "02-06-2026",
            "09-06-2026",
            "16-06-2026",
            "30-06-2026",
            "28-07-2026",
            "04-08-2026",
            "11-08-2026",
            "18-08-2026",
            "25-08-2026",
            "01-09-2026",
            "29-09-2026",
            "27-10-2026",                        
        ],

    BANKNIFTY: [

        "26-05-2026",
        "30-06-2026",
        "28-07-2026",
    	"25-08-2026",
    ],

    FINNIFTY: [

        "26-05-2026",
        "30-06-2026",
        "28-07-2026",
    ],

    MIDCPNIFTY: [

        "26-05-2026",
        "30-06-2026",
        "28-07-2026"
    ]
};

// ======================================
// KEEPING SAME FUNCTION
// ======================================
function parseExpiryDate(dateStr) {

    const [day, month, year] =
        dateStr.split("-");

    return new Date(
        year,
        month - 1,
        day,
        23,
        59,
        59
    );
}

// ======================================
// KEEPING SAME FUNCTION
// RETURNS ONLY LATEST VALID EXPIRY
// ======================================

async function getExpiries(symbol = "NIFTY") {

    try {

        const expiries =
            EXPIRY_CONFIG[symbol] || [];

        const now = new Date();
        now.setHours(23, 59, 59, 999); // Set to end of toda

        for (const expiry of expiries) {

            const expiryDate =
                parseExpiryDate(expiry); //19-05-2026'
            let condition =    expiryDate >  now             ;

            if (condition) {

                return expiry;
            }
        }

        return null;

    } catch (err) {

        console.log(
            "Expiry Service Error:",
            err.message
        );

        return null;
    }
}

module.exports = {
    getExpiries
};
module.exports = {
    getExpiries
};