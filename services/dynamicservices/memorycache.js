/*
==========================================================
FILE CACHE STORE
==========================================================
*/

const fs =
    require("fs");

const path =
    require("path");

/*
==========================================================
CACHE DIRECTORY
==========================================================
*/

const CACHE_DIR =
    path.join(
        __dirname,
        "./temp_scanoi"
    );

/*
CREATE DIR
*/

if (
    !fs.existsSync(
        CACHE_DIR
    )
) {

    fs.mkdirSync(
        CACHE_DIR,
        {
            recursive: true
        }
    );
}

/*
==========================================================
DELAY HELPER
==========================================================
*/

function delay(ms) {

    return new Promise(
        (resolve) => {

            setTimeout(
                resolve,
                ms
            );
        }
    );
}

/*
==========================================================
RANDOM WAIT
5 TO 10 SEC
==========================================================
*/

async function randomWait() {

    const waitMs =

        Math.floor(

            Math.random() *

            (50000)

        ) + 5000;

    console.log(
        "WAIT",
        `Random wait ${waitMs} ms before execution`
    );

    await delay(
        waitMs
    );
}

/*
==========================================================
GET CACHE FILE PATH
==========================================================
*/

function getCacheFilePath(
    key
) {

    return path.join(

        CACHE_DIR,

        `${key}.json`
    );
}

/*
==========================================================
GET CACHED RESULT
==========================================================
*/

function getCachedResult(
    key,
    cacheMinutes = 4
) {

    try {

        const cacheFile =

            getCacheFilePath(
                key
            );

        /*
        FILE NOT FOUND
        */

        if (
            !fs.existsSync(
                cacheFile
            )
        ) {

            return null;
        }

        /*
        READ FILE
        */

        const raw =

            fs.readFileSync(
                cacheFile,
                "utf8"
            );

        const item =
            JSON.parse(raw);

        /*
        AGE CHECK
        */

        const now =
            Date.now();

        const age =
            now -
            item.timestamp;

        const maxAge =

            cacheMinutes *
            60 *
            1000;

        /*
        EXPIRED
        */

        if (
            age > maxAge
        ) {

            fs.unlinkSync(
                cacheFile
            );

            console.log(
                `CACHE EXPIRED ${key}`
            );

            return null;
        }

        console.log(
            `USING CACHE ${key}`
        );

        return item.data;

    } catch (err) {

        console.log(
            "GET CACHE ERROR",
            err.message
        );

        return null;
    }
}

/*
==========================================================
SET CACHED RESULT
==========================================================
*/

function setCachedResult(
    key,
    data
) {

    try {

        const cacheFile =

            getCacheFilePath(
                key
            );

        const payload = {

            timestamp:
                Date.now(),

            data
        };

        fs.writeFileSync(

            cacheFile,

            JSON.stringify(
                payload,
                null,
                2
            )
        );

        console.log(
            `CACHE SAVED ${key}`,
            cacheFile
        );

    } catch (err) {

        console.log(
            "SET CACHE ERROR",
            err.message
        );
    }
}

/*
==========================================================
CLEAR CACHE
==========================================================
*/

function clearCachedResult(
    key
) {

    try {

        const cacheFile =

            getCacheFilePath(
                key
            );

        if (
            fs.existsSync(
                cacheFile
            )
        ) {

            fs.unlinkSync(
                cacheFile
            );

            console.log(
                `CACHE REMOVED ${key}`
            );
        }

    } catch (err) {

        console.log(
            "CLEAR CACHE ERROR",
            err.message
        );
    }
}

/*
==========================================================
EXPORTS
==========================================================
*/

module.exports = {

    randomWait,

    getCachedResult,

    setCachedResult,

    clearCachedResult,

    delay
};
