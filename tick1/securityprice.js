const fs = require("fs");
const path = require("path");

const LivePriceWebSocket =
    require("../jsPMClient-master/livePriceWebSocket");

const {
    loadTokens
} = require("../dynamic_data/tokensave");

const priceEmitter =
    require("../services/dynamicservices/priceemitter");
const log = require("./logger").log;
const socketlogpath= require("./config").socketlogpath;

// ======================================
// TOKEN
// ======================================

const PUBLIC_ACCESS_TOKEN =
    loadTokens()?.public_access_token ||
    process.env.PUBLIC_ACCESS_TOKEN;

// ======================================
// SOCKET INSTANCE
// ======================================

const livePriceWebSocket =
    new LivePriceWebSocket();

// ======================================
// LIVE STORE
// ======================================

const securityPriceList = {};

// ======================================
// CURRENT PREFERENCES
// ======================================

let subscribedPreferences = [];

// ======================================
// CLEANUP INTERVAL
// ======================================

let cleanupInterval = null;

// ======================================
// SOCKET STATE
// ======================================

let socketStarted = false;

let socketConnecting = false;

let reconnectTimeout = null;

// ======================================
// LOG FILE
// ======================================

const LOG_FOLDER =socketlogpath;

if (!fs.existsSync(LOG_FOLDER)) {

    fs.mkdirSync(LOG_FOLDER, {
        recursive: true
    });
}

const LOG_FILE =
    path.join(

        LOG_FOLDER,

        `${new Date()
            .toISOString()
            .split("T")[0]}.log`
    );

// ======================================
// LOGGER
// ======================================

function writeLog(
    type,
    message,
    extra = {}
) {

    const payload = {

        timestamp:
            new Date().toISOString(),

        type,

        message,

        ...extra
    };

    const line =
        JSON.stringify(payload) + "\n";

    fs.appendFileSync(
        LOG_FILE,
        line
    );

    console.log(
        `[${type}]`,
        message,
        extra
    );
}

// ======================================
// SET SUBSCRIPTIONS
// ======================================

function setPriceFetchConfig(
    preferences = []
) {

    try {

        writeLog(
            "PREFERENCE_UPDATE",
            "Updating websocket subscriptions",
            {
                newPreferences:
                    preferences
            }
        );

        // =========================
        // SOCKET NOT ACTIVE
        // =========================

        if (!socketStarted) {

            subscribedPreferences =
                preferences;

            writeLog(
                "PENDING_SUBSCRIPTIONS",
                "Socket inactive, preferences stored locally",
                {
                    preferences
                }
            );

            return;
        }

   

        // =========================
        // SAVE NEW
        // =========================

        subscribedPreferences =
            preferences;

        // =========================
        // ADD NEW SUBSCRIPTIONS
        // =========================

        if (
            subscribedPreferences.length
        ) {

            const addPrefs =

                subscribedPreferences.map(
                    (x) => ({

                        actionType:
                            "ADD",

                        modeType:
                            x.modeType,

                        scripType:
                            x.scripType,

                        exchangeType:
                            x.exchangeType,

                        scripId:
                            x.scripId
                    })
                );

            livePriceWebSocket.subscribe(
                addPrefs
            );

            writeLog(
                "SUBSCRIBED",
                "Subscribed to new securities",
                {
                    addPrefs
                }
            );
        }

        // =========================
        // CURRENT ACTIVE
        // =========================

        writeLog(
            "ACTIVE_SUBSCRIPTIONS",
            "Current active subscriptions",
            {
                subscribedPreferences
            }
        );

    } catch (err) {

        writeLog(
            "SUBSCRIPTION_ERROR",
            err.message,
            {
                stack: err.stack
            }
        );
    }
}

// ======================================
// UPDATE LOW TRACKING
// ======================================

function updateLowTracking(
    securityKey,
    ltp
) {

    const now =
        Date.now();

    if (
        !securityPriceList[
            securityKey
        ].priceHistory
    ) {

        securityPriceList[
            securityKey
        ].priceHistory = [];
    }

    // =========================
    // PUSH PRICE
    // =========================

    securityPriceList[
        securityKey
    ].priceHistory.push({

        timestamp: now,

        price: ltp
    });

    // =========================
    // KEEP LAST 15 SEC
    // =========================

    securityPriceList[
        securityKey
    ].priceHistory =

        securityPriceList[
            securityKey
        ].priceHistory.filter(
            (x) =>
                now -
                x.timestamp <=
                15000
        );

    // =========================
    // LAST 5 SEC
    // =========================

    const last5 =

        securityPriceList[
            securityKey
        ].priceHistory.filter(
            (x) =>
                now -
                x.timestamp <=
                5000
        );

    // =========================
    // LAST 10 SEC
    // =========================

    const last10 =

        securityPriceList[
            securityKey
        ].priceHistory.filter(
            (x) =>
                now -
                x.timestamp <=
                10000
        );

    securityPriceList[
        securityKey
    ].last5SecLow =

        last5.length

        ? Math.min(
            ...last5.map(
                (x) => x.price
            )
        )

        : ltp;

    securityPriceList[
        securityKey
    ].last10SecLow =

        last10.length

        ? Math.min(
            ...last10.map(
                (x) => x.price
            )
        )

        : ltp;
}

// ======================================
// START SOCKET
// ======================================

function startSocket() {

    // =========================
    // PREVENT DUPLICATES
    // =========================

    if (
        socketStarted ||
        socketConnecting
    ) {

        writeLog(
            "INFO",
            "Socket already active"
        );

        return;
    }

    socketConnecting = true;

    writeLog(
        "START",
        "Starting Paytm socket"
    );

    // ==================================
    // OPEN
    // ==================================

    livePriceWebSocket
    .setOnOpenListener(() => {

        socketConnecting = false;

        socketStarted = true;

        writeLog(
            "CONNECTED",
            "Paytm WebSocket Connected"
        );

        // =========================
        // SUBSCRIBE
        // =========================

        if (
            subscribedPreferences.length
        ) {

            livePriceWebSocket.subscribe(
                subscribedPreferences
            );

            writeLog(
                "SUBSCRIBED",
                "Subscribed to securities",
                {
                    preferences:
                        subscribedPreferences
                }
            );
        }
    });

    // ==================================
    // MESSAGE
    // ==================================

    livePriceWebSocket
    .setOnMessageListener((arr) => {

        try {

            arr.forEach((feed) => {

                const securityKey =

                    feed.security_id
                    .toString();

                const ltp =

                    Number(
                        feed.last_price || 0
                    );

                // =====================
                // INIT
                // =====================

                if (
                    !securityPriceList[
                        securityKey
                    ]
                ) {

                    securityPriceList[
                        securityKey
                    ] = {};
                }

                // =====================
                // LOW
                // =====================

                const fiveSecondsLow =

                    securityPriceList[
                        securityKey
                    ]?.last5SecLow

                    ? Math.min(

                        securityPriceList[
                            securityKey
                        ].last5SecLow,

                        ltp

                    )

                    : ltp;

                // =====================
                // UPDATE STORE
                // =====================

                securityPriceList[
                    securityKey
                ] = {

                    ...securityPriceList[
                        securityKey
                    ],

                    timestamp:
                        Date.now(),

                    ltp,

                    security_id:
                        feed.security_id,

                    raw: feed,

                    fiveSecondsLow
                };

                // =====================
                // UPDATE LOWS
                // =====================

                updateLowTracking(
                    securityKey,
                    ltp
                );

                // =====================
                // GLOBAL EMIT
                // =====================

                priceEmitter.emit(

                    "GLOBAL_TICK",

                    {

                        security_id:
                            feed.security_id,

                        ltp,

                        data:
                            securityPriceList[
                                securityKey
                            ],
                        Symbol: feed.symbol
                    }
                );

                // =====================
                // SECURITY EMIT
                // =====================

                priceEmitter.emit(

                    securityKey,

                    {

                        security_id:
                            feed.security_id,

                        ltp,

                        data:
                            securityPriceList[
                                securityKey
                            ]
                    }
                );
            });

        } catch (err) {

            writeLog(
                "PARSE_ERROR",
                err.message
            );
        }
    });

    // ==================================
    // ERROR
    // ==================================

    livePriceWebSocket
    .setOnErrorListener((err) => {

        writeLog(
            "SOCKET_ERROR",
            err?.message || err
        );
    });

    // ==================================
    // CLOSE
    // ==================================

    livePriceWebSocket
    .setOnCloseListener(
        (code, reason) => {

        writeLog(
            "SOCKET_CLOSED",
            "Socket closed",
            {
                code,
                reason
            }
        );

        socketStarted = false;

        socketConnecting = false;

        // =========================
        // SAFE RECONNECT
        // =========================

        if (!reconnectTimeout) {

            reconnectTimeout =

                setTimeout(() => {

                    reconnectTimeout =
                        null;

                    writeLog(
                        "RECONNECT",
                        "Attempting reconnect"
                    );

                    startSocket();

                }, 15000);
        }
    });

    // ==================================
    // DISABLE INTERNAL RECONNECT
    // ==================================

    livePriceWebSocket
    .setReconnectConfig(
        false,
        0
    );

    // ==================================
    // CONNECT
    // ==================================

    try {

        livePriceWebSocket.connect(
            PUBLIC_ACCESS_TOKEN
        );

    } catch (err) {

        writeLog(
            "CONNECT_ERROR",
            err.message
        );

        socketStarted = false;

        socketConnecting = false;
    }

    // ==================================
    // CLEANUP
    // ==================================

    if (cleanupInterval) {

        clearInterval(
            cleanupInterval
        );
    }

    cleanupInterval =

        setInterval(() => {

            const now =
                Date.now();

            Object.keys(
                securityPriceList
            ).forEach((key) => {

                const item =
                    securityPriceList[key];

                if (
                    item.priceHistory
                ) {

                    item.priceHistory =

                        item.priceHistory.filter(
                            (x) =>
                                now -
                                x.timestamp <=
                                15000
                        );
                }
            });

        }, 3000);
}

// ======================================
// STOP SOCKET
// ======================================

function stopSocket() {

    try {

        livePriceWebSocket.disconnect();

    } catch (err) {

        writeLog(
            "STOP_ERROR",
            err.message
        );
    }

    socketStarted = false;

    socketConnecting = false;

    if (cleanupInterval) {

        clearInterval(
            cleanupInterval
        );
    }

    if (reconnectTimeout) {

        clearTimeout(
            reconnectTimeout
        );
    }

    writeLog(
        "STOP",
        "Socket stopped"
    );
}

// ======================================
// GET LIVE PRICE
// ======================================

function getLivePrice(
    securityId
) {

    const key =
        securityId.toString();

    const data =
        securityPriceList[key];

    if (!data) {

        writeLog(
            "NO_LIVE_DATA",
            "No live data yet",
            {
                securityId: key
            }
        );

        return null;
    }

    return data;
}

// ======================================
// GET ALL
// ======================================

function getAllLivePrices() {

    return securityPriceList;
}

// ======================================
// PROCESS EXIT LOGGING
// ======================================

process.on("SIGINT", () => {

    writeLog(
        "EXIT",
        "Process exiting via SIGINT"
    );

    stopSocket();

    process.exit(0);
});

process.on("uncaughtException", (err) => {

    writeLog(
        "UNCAUGHT_EXCEPTION",
        err.message,
        {
            stack: err.stack
        }
    );
});

process.on(
    "unhandledRejection",
    (reason) => {

    writeLog(
        "UNHANDLED_REJECTION",
        reason?.message || reason
    );
});

function removeSecuritySubscription(
    securityId
) {

    try {

        if (!securityId) {
            return;
        }

        const stillSubscribed =

            subscribedPreferences.some(

                (x) =>

                    x.scripId
                        .toString()

                    ===

                    securityId
                        .toString()
            );

        if (stillSubscribed) {

             writeLog(
            "stillSubscribed",
            "Security NOT removed",
            {
                securityId
            }
        );
        log("Security NOT removed: stillSubscribed ", securityId)

        return;
        }



        livePriceWebSocket.subscribe([
            {
                actionType: "REMOVE",

                modeType: "QUOTE",

                scripType: "OPTION",

                exchangeType: "NSE",

                scripId:
                    securityId.toString()
            }
        ]);

        writeLog(
            "UNSUBSCRIBED",
            "Security removed",
            {
                securityId
            }
        );
        log("Security removed:", securityId)
        
        // add this log in main log

        

    } catch (err) {

        writeLog(
            "REMOVE_SUB_ERROR",
            err.message
        );
    }
}
// ======================================
// EXPORTS
// ======================================

module.exports = {

    startSocket,

    stopSocket,

    setPriceFetchConfig,

    getLivePrice,

    getAllLivePrices,

    securityPriceList,
    
    removeSecuritySubscription
};

