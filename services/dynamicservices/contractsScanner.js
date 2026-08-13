const fs = require("fs");
const path = require("path");

const { getExpiries } = require("../expiries");
const { getOptionChain } = require("../optionchain");
const { getCachedResult, setCachedResult } = require("./memorycache");

const SYMBOLS = ["NIFTY", "BANKNIFTY"];

const STRUCTURAL_RULES = {
    NIFTY: { strikeGap: 50 },
    BANKNIFTY: { strikeGap: 100 }
};

const MOMENTUM_MATRIX_FOLDER = path.join(__dirname, "./temp_scanoi");

// ======================================
// HELPER: Extract Single Spot Price
// ======================================
function extractCommonSpotPrice(callChain, putChain) {
    if (callChain?.results) {
        for (const item of callChain.results) {
            if (item.spot_price && Number(item.spot_price) > 0) {
                return Number(item.spot_price);
            }
        }
    }
    if (putChain?.results) {
        for (const item of putChain.results) {
            if (item.spot_price && Number(item.spot_price) > 0) {
                return Number(item.spot_price);
            }
        }
    }
    return 0;
}

// ======================================
// HELPER: Generate 50 Strike Range Target
// (+25 strikes and -25 strikes around ATM)
// ======================================
function getStrikeBoundarySet(spotPrice, strikeGap) {
    // 1. Calculate nearest At-The-Money (ATM) strike
    const atmStrike = Math.round(spotPrice / strikeGap) * strikeGap;
    
    const targetStrikes = new Set();

    // 2. Add -25 strikes below ATM, ATM itself, and +25 strikes above ATM (Total 51 strikes / 50 steps around ATM)
    for (let i = -25; i <= 25; i++) {
        const calculatedStrike = atmStrike + (i * strikeGap);
        targetStrikes.add(calculatedStrike);
    }

    return targetStrikes;
}

// ======================================
// SAVE SNAPSHOT MATRIX
// ======================================
function saveSnapshot(symbol, payload) {
    if (!fs.existsSync(MOMENTUM_MATRIX_FOLDER)) {
        fs.mkdirSync(MOMENTUM_MATRIX_FOLDER, { recursive: true });
    }

    const snapshotFilePath = path.join(MOMENTUM_MATRIX_FOLDER, `${symbol.toLowerCase()}_spot_range_matrix.json`);
    fs.writeFileSync(snapshotFilePath, JSON.stringify(payload, null, 2));
}

// ======================================
// CORE ENGINE: SPOT +- 25 STRIKES SCANNER
// ======================================
async function scanSpotRangeContracts(instanceName = "Default") {
    const cachedResults = await getCachedResult("spot_range_contracts_results");
    if (cachedResults) {
        console.log(`[${instanceName}] Utilizing cached spot range results.`);
        return cachedResults;
    }

    const consolidatedPayload = {};

    for (const currentSymbol of SYMBOLS) {
        try {
            const assetRules = STRUCTURAL_RULES[currentSymbol] || { strikeGap: 50 };
            const latestExpiry = await getExpiries(currentSymbol);
            
            if (!latestExpiry) {
                console.log(`⚠️ No active expiry located for trading instrument: ${currentSymbol}`);
                continue;
            }

            console.log(`\nFetching ${currentSymbol} Option Chain (${latestExpiry})...`);

            const callChain = await getOptionChain(currentSymbol, latestExpiry, "CALL");
            const putChain = await getOptionChain(currentSymbol, latestExpiry, "PUT");

            // 1. Extract single common spot price
            const commonSpotPrice = extractCommonSpotPrice(callChain, putChain);
            if (!commonSpotPrice) {
                console.log(`⚠️ Unable to locate valid spot price for: ${currentSymbol}`);
                continue;
            }

            // 2. Generate target set of +-25 strikes around ATM
            const targetStrikeSet = getStrikeBoundarySet(commonSpotPrice, assetRules.strikeGap);

            const strikesMap = {};

            // Initialize structure for all target strikes
            targetStrikeSet.forEach(strike => {
                strikesMap[strike] = {
                    strike,
                    CE: null,
                    PE: null
                };
            });

            // 3. Populate CALL Contracts
            if (callChain?.results) {
                callChain.results.forEach(item => {
                    const strike = Number(item.stk_price);
                    if (targetStrikeSet.has(strike)) {
                        strikesMap[strike].CE = {
                            strike: strike,
                            optionType: "CE",
                            securityId: item.security_id || 0,
                            pmlSymbol: item.pml_symbol || "",
                            premium: Number(item.price || 0),
                            volume: Number(item.traded_vol || 0)
                        };
                    }
                });
            }

            // 4. Populate PUT Contracts
            if (putChain?.results) {
                putChain.results.forEach(item => {
                    const strike = Number(item.stk_price);
                    if (targetStrikeSet.has(strike)) {
                        strikesMap[strike].PE = {
                            strike: strike,
                            optionType: "PE",
                            securityId: item.security_id || 0,
                            pmlSymbol: item.pml_symbol || "",
                            premium: Number(item.price || 0),
                            volume: Number(item.traded_vol || 0)
                        };
                    }
                });
            }

            // 5. Flatten strikes map into 100 contracts list (2 contracts CE/PE per strike)
            const allContractsList = [];
            const sortedStrikes = Object.keys(strikesMap).map(Number).sort((a, b) => a - b);

            sortedStrikes.forEach(strike => {
                const strikeData = strikesMap[strike];
                if (strikeData.CE) allContractsList.push(strikeData.CE);
                if (strikeData.PE) allContractsList.push(strikeData.PE);
            });

            const symbolPayload = {
                symbol: currentSymbol,
                expiry: latestExpiry,
                commonSpotPrice,
                totalStrikes: sortedStrikes.length,
                totalContracts: allContractsList.length,
                contracts: allContractsList
            };

            // Save Snapshot
            saveSnapshot(currentSymbol, symbolPayload);

            console.log(`=================== ${currentSymbol} SCANNER RESULT ===================`);
            console.log(`Common Spot Price : ${commonSpotPrice}`);
            console.log(`Total Strikes      : ${sortedStrikes.length} (From ${sortedStrikes[0]} to ${sortedStrikes[sortedStrikes.length - 1]})`);
            console.log(`Total Contracts    : ${allContractsList.length} (CE + PE)`);
            console.log(`---------------------------------------------------------------------`);

            consolidatedPayload[currentSymbol] = symbolPayload;

        } catch (error) {
            console.error(`Error processing ${currentSymbol}:`, error.message);
        }
    }

    await setCachedResult("spot_range_contracts_results", consolidatedPayload);
    return consolidatedPayload;
}

module.exports = {
    scanSpotRangeContracts
};