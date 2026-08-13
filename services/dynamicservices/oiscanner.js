const fs = require("fs");
const path = require("path");

const {
    getExpiries
} = require("../expiries");

const {
    getOptionChain
} = require("../optionchain");

const SYMBOLS = [
    "NIFTY",
    "BANKNIFTY",
    "FINNIFTY",
    "MIDCPNIFTY"
];

const {randomWait,getCachedResult,setCachedResult }=require("./memorycache")
// ======================================
// SAVE JSONL LOGS
// ======================================

function saveScan(symbol, data) {

    const date =
        new Date()
        .toISOString()
        .split("T")[0];

    const folder =
        path.join(
            __dirname,
            "../dynamic_data/scanner",
            date
        );

    if (!fs.existsSync(folder)) {

        fs.mkdirSync(folder, {
            recursive: true
        });
    }

    const filePath =
        path.join(
            folder,
            `${symbol}.jsonl`
        );

    fs.appendFileSync(
        filePath,
        JSON.stringify(data) + "\n"
    );
}

// ======================================
// FILTER NEARBY STRIKES
// ======================================

function isStrikeNearSpot(
    symbol,
    strike,
    spotPrice
) {

    let gap = 50;

    // =========================
    // STRIKE GAP RULES
    // =========================

    if (symbol === "BANKNIFTY") {

        gap = 100;

    } else if (symbol === "MIDCPNIFTY") {

        gap = 25;

    } else {

        gap = 50;
    }

    // =========================
    // ATM STRIKE
    // =========================

    const atmStrike =
        Math.round(spotPrice / gap) * gap;

    // =========================
    // KEEP ONLY +-6 STRIKES
    // =========================

    const lower =
        atmStrike - (gap * 5);

    const upper =
        atmStrike + (gap * 5);

    return (
        strike >= lower &&
        strike <= upper
    );
}

// ======================================
// MERGE OPTION CHAINS
// ======================================

function mergeOptionChains(
    callChain,
    putChain
) {

    const mergedMap = {};

    // ==========================
    // PROCESS CALLS
    // ==========================

    if (callChain?.results) {

        callChain.results.forEach((item) => {

            const strike =
                item.stk_price;

            const spotPrice =
                Number(item.spot_price || 0);

            // FILTER FAR STRIKES
            if (
                !isStrikeNearSpot(
                    item.symbol,
                    strike,
                    spotPrice
                )
            ) {

                return;
            }

            if (!mergedMap[strike]) {

                mergedMap[strike] = {
                    strikePrice: strike
                };
            }

            mergedMap[strike].CE = {

                ...item,

                openInterest:
                    Number(item.oi || 0),

                changeinOpenInterest:
                    Number(item.oi_net_chg || 0),

                lastPrice:
                    Number(item.price || 0),

                impliedVolatility:
                    Number(item.iv || 0),

                totalTradedVolume:
                    Number(item.traded_vol || 0)
            };
        });
    }

    // ==========================
    // PROCESS PUTS
    // ==========================

    if (putChain?.results) {

        putChain.results.forEach((item) => {

            const strike =
                item.stk_price;

            const spotPrice =
                Number(item.spot_price || 0);

            // FILTER FAR STRIKES
            if (
                !isStrikeNearSpot(
                    item.symbol,
                    strike,
                    spotPrice
                )
            ) {

                return;
            }

            if (!mergedMap[strike]) {

                mergedMap[strike] = {
                    strikePrice: strike
                };
            }

            mergedMap[strike].PE = {

                ...item,

                openInterest:
                    Number(item.oi || 0),

                changeinOpenInterest:
                    Number(item.oi_net_chg || 0),

                lastPrice:
                    Number(item.price || 0),

                impliedVolatility:
                    Number(item.iv || 0),

                totalTradedVolume:
                    Number(item.traded_vol || 0)
            };
        });
    }

    return Object.values(mergedMap);
}

// ======================================
// MAIN SCANNER
// ======================================

async function scanOI(instanceName="Default") {

    await randomWait();

    const cachedResults = await getCachedResult("oi_scan_results");

    if (cachedResults) {
        console.log("Using cached OI scan results", cachedResults);
            saveScan(
         "SCAN_RESULT_FROM_CACHE_"+instanceName,
             {

            timestamp:
                new Date().toISOString(),

            winnerSymbol:
                cachedResults.symbol,

            strongestDiff:
                cachedResults.strongestDiff,

            strongestStrike:
                cachedResults.strongestStrike,

            fifthVolumeStrike:
                cachedResults.fifthVolumeStrike
        }
    );
        return cachedResults;
    }



    const finalResults = [];

    for (const symbol of SYMBOLS) {

        try {

            // =========================
            // GET LATEST EXPIRY
            // =========================

            const latestExpiry =
                await getExpiries(symbol);

            if (!latestExpiry)
                continue;

            console.log(
                "\n===================="
            );

            console.log(
                "SYMBOL:",
                symbol
            );

            console.log(
                "EXPIRY:",
                latestExpiry
            );

            // =========================
            // FETCH CHAINS
            // =========================

            const callChain =
                await getOptionChain(
                    symbol,
                    latestExpiry,
                    "CALL"
                );

            const putChain =
                await getOptionChain(
                    symbol,
                    latestExpiry,
                    "PUT"
                );

            console.log(
                "Option chains fetched"
            );

            // =========================
            // MERGE CHAINS
            // =========================

            const mergedOptionChain =
                mergeOptionChains(
                    callChain,
                    putChain
                );

            if (!mergedOptionChain.length)
                continue;

            console.log(
                "Option chains merged"
            );

            const processed = [];

            // =========================
            // PROCESS STRIKES
            // =========================

            mergedOptionChain.forEach((item) => {

                const ceOI =
                    item.CE?.openInterest || 0;

                const peOI =
                    item.PE?.openInterest || 0;

                const ceChangeOI =
                    item.CE?.changeinOpenInterest || 0;

                const peChangeOI =
                    item.PE?.changeinOpenInterest || 0;

                const diff =
                    Math.abs(peOI - ceOI);

                let dominantSide =
                    "NEUTRAL";

                if (peOI > ceOI)
                    dominantSide =
                    "PUT_HEAVY";

                if (ceOI > peOI)
                    dominantSide =
                    "CALL_HEAVY";

                const ceVolume =
                    item.CE?.totalTradedVolume || 0;

                const peVolume =
                    item.PE?.totalTradedVolume || 0;

                const volumeDiff =
                    Math.abs(
                        peVolume - ceVolume
                    );

                processed.push({

                    strike:
                        item.strikePrice,

                    spotPrice:
                        Number(
                            item.CE?.spot_price ||
                            item.PE?.spot_price ||
                            0
                        ),

                    ceOI,
                    peOI,

                    ceChangeOI,
                    peChangeOI,

                    diff,

                    volumeDiff,

                    dominantSide,

                    ceLTP:
                        item.CE?.lastPrice || 0,

                    peLTP:
                        item.PE?.lastPrice || 0,

                    ceVolume,

                    peVolume,

                    ceIV:
                        item.CE?.impliedVolatility || 0,

                    peIV:
                        item.PE?.impliedVolatility || 0,

                    // =====================
                    // METADATA
                    // =====================

                    segment:
                        item.CE?.segment ||
                        item.PE?.segment ||
                        "D",

                    ceSecurityId:
                        item.CE?.security_id || "",

                    peSecurityId:
                        item.PE?.security_id || "",

                    ceSymbol:
                        item.CE?.pml_symbol || "",

                    peSymbol:
                        item.PE?.pml_symbol || "",

                    ceLotSize:
                        item.CE?.lot_size || 0,

                    peLotSize:
                        item.PE?.lot_size || 0
                });

            });

            // =========================
            // SORT BY OI DIFF
            // =========================

            processed.sort(
                (a, b) =>
                    b.diff - a.diff
            );

            // =========================
            // TAKE TOP 10 OI STRIKES
            // =========================

            const top10OI =
                processed.slice(0, 10);

            console.log(
                "\nTOP 10 OI DIFF STRIKES"
            );

            // console.table(top10OI);

            // =========================
            // STRONGEST OI STRIKE
            // =========================

            const strongestStrike =
                top10OI[0];

            // =========================
            // VOLUME ANALYSIS ONLY
            // INSIDE OI WINNERS
            // =========================

            const volumeRanked =
                [...top10OI];

            volumeRanked.sort(
                (a, b) =>
                    b.volumeDiff -
                    a.volumeDiff
            );

            // =========================
            // TOP VOLUME STRIKES
            // ONLY INSIDE OI WINNERS
            // =========================

            const top10Volume =
                volumeRanked;

            console.log(
                "\nTOP VOLUME DIFF STRIKES INSIDE OI WINNERS"
            );

            // console.table(top10Volume);

            // =========================
            // 5TH VOLUME STRIKE
            // =========================

            const fifthVolumeStrike =
                top10Volume[4] || null;

            // =========================
            // SYMBOL RESULT
            // =========================

            const symbolResult = {

                timestamp:
                    new Date().toISOString(),

                symbol,

                expiry:
                    latestExpiry,

                // =====================
                // SYMBOL COMPARISON
                // =====================

                strongestDiff:
                    strongestStrike?.diff || 0,

                strongestStrike,

                // =====================
                // OI ANALYSIS
                // =====================

                top10OI,

                // =====================
                // VOLUME ANALYSIS
                // INSIDE OI WINNERS
                // =====================

                top10Volume,

                // =====================
                // FINAL OUTPUT STRIKE
                // =====================

                fifthVolumeStrike
            };

            // =========================
            // SAVE LOG
            // =========================

            saveScan(
                symbol,
                symbolResult
            );

            finalResults.push(
                symbolResult
            );
            

            // return symbolResult;

        } catch (err) {

            console.log(
                symbol,
                err.message
            );
        }
    }

    // =========================
    // COMPARE SYMBOLS
    // =========================

    if (!finalResults.length)
        return null;

    finalResults.sort(
        (a, b) =>
            b.strongestDiff -
            a.strongestDiff
    );

    const winner =
        finalResults[0];

    console.log(
        "\n========================"
    );

    console.log(
        "WINNER SYMBOL:",
        winner.symbol
    );

    console.log(
        "STRONGEST OI DIFF:",
        winner.strongestDiff
    );

    console.log(
        "5TH VOLUME DIFF STRIKE INSIDE OI WINNERS:"
    );

    console.table(
        winner.fifthVolumeStrike
    );

    // =========================
    // SAVE WINNER LOG
    // =========================

    saveScan(
        "WINNER",
        {

            timestamp:
                new Date().toISOString(),

            winnerSymbol:
                winner.symbol,

            strongestDiff:
                winner.strongestDiff,

            strongestStrike:
                winner.strongestStrike,

            fifthVolumeStrike:
                winner.fifthVolumeStrike
        }
    );

    await setCachedResult(
        "oi_scan_results",
        winner
    );

    return winner;
}

module.exports = {
    scanOI
};