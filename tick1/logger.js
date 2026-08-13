/*
==========================================================
GLOBAL LOGGER SERVICE
IMPORTABLE IN ANY FILE
==========================================================
*/

const fs =
    require("fs");

const path =
    require("path");
const instanceName = require("./config").instanceName;
const logpath = require("./config").logpath;
/*
==========================================================
LOG DIRECTORY
==========================================================
*/

const LOG_DIR =logpath;

if (
    !fs.existsSync(LOG_DIR)
) {

    fs.mkdirSync(
        LOG_DIR,
        {
            recursive: true
        }
    );
}

/*
==========================================================
MEMORY CACHE
==========================================================
*/

let logBuffer = [];

/*
==========================================================
CURRENT FILE
==========================================================
*/

let currentDate =
    getDateString();

let currentLogFile =
    getLogFilePath();

/*
==========================================================
HELPERS
==========================================================
*/

function getDateString() {

    return new Date()
        .toISOString()
        .split("T")[0];
}

function getTimeString() {

    const now =
        new Date();

    const hh =
        String(
            now.getHours()
        ).padStart(2, "0");

    const mm =
        String(
            now.getMinutes()
        ).padStart(2, "0");

    const ss =
        String(
            now.getSeconds()
        ).padStart(2, "0");

    return `${hh}:${mm}:${ss}`;
}

function getLogFilePath() {

    const date =
        getDateString();

    return path.join(

        LOG_DIR,

        `${date}.log`
    );
}

/*
==========================================================
START NEW DAY HEADER
==========================================================
*/

function writeNewDayHeader() {

    const line =

`\n==========================================================
STARTED DATE ${new Date().toString()}
==========================================================\n\n`;

    fs.appendFileSync(
        currentLogFile,
        line
    );
}

/*
==========================================================
CHECK DAY CHANGE
==========================================================
*/

function checkDayChange() {

    const today =
        getDateString();

    if (
        today !== currentDate
    ) {

        currentDate =
            today;

        currentLogFile =
            getLogFilePath();

        writeNewDayHeader();
    }
}

/*
==========================================================
MAIN LOGGER
==========================================================
*/

function log(
    tags = "INFO",
    message = "",
    extra = null
) {

    try {

        checkDayChange();

        const timestamp =
            getTimeString();

        let line =

`${instanceName} --- ${timestamp} --- ${tags} --- ${message}`;

        /*
        EXTRA JSON
        */

        if (
            extra !== null
        ) {

            try {

                line +=
`\n${JSON.stringify(
    extra,
    null,
    2
)}`;

            } catch {}
        }

        line += "\n";

        /*
        MEMORY BUFFER
        */

        logBuffer.push(
            line
        );

        /*
        OPTIONAL CONSOLE
        */

        console.log(
            line
        );

    } catch (err) {

        console.log(
            "LOGGER ERROR",
            err.message
        );
    }
}

/*
==========================================================
FLUSH TO FILE
EVERY 5 SEC
==========================================================
*/

function flushLogs() {

    try {

        if (
            !logBuffer.length
        ) {

            return;
        }

        checkDayChange();

        /*
        FILE NOT EXIST
        */

        if (
            !fs.existsSync(
                currentLogFile
            )
        ) {

            writeNewDayHeader();
        }

        /*
        JOIN BUFFER
        */

        const finalLogs =
            logBuffer.join("\n");

        /*
        WRITE
        */

        fs.appendFileSync(

            currentLogFile,

            finalLogs + "\n"
        );

        /*
        CLEAR MEMORY
        */

        logBuffer = [];

    } catch (err) {

        console.log(
            "FLUSH ERROR",
            err.message
        );
    }
}

/*
==========================================================
AUTO FLUSH
==========================================================
*/

setInterval(() => {

    flushLogs();

}, 5000);

/*
==========================================================
PROCESS EXIT SAFETY
==========================================================
*/

process.on(
    "exit",
    flushLogs
);

process.on(
    "SIGINT",
    () => {

        flushLogs();

        process.exit();
    }
);

process.on(
    "SIGTERM",
    () => {

        flushLogs();

        process.exit();
    }
);

/*
==========================================================
INIT HEADER
==========================================================
*/

if (
    !fs.existsSync(
        currentLogFile
    )
) {

    writeNewDayHeader();
}

/*
==========================================================
EXPORTS
==========================================================
*/

module.exports = {

    log,

    flushLogs
};