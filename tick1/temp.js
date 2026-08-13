const fs = require("fs");
const path = require("path");

const {
    scanSpotRangeContracts
} = require("../services/dynamicservices/contractsScanner");

const { startSocket, setPriceFetchConfig } = require("./securityprice");

const {
    activeTrades,
    hasActiveNonExpiredTrade,
    getExecutedSecuritiesSummary,
    delay,
    getTotalWinLossCounter,
    getTrades,
    takeTrade,
    createTradeId
} = require("./order");

const {
    scheduler_interval_start,
    scheduler_interval_min,
    scheduler_interval_end,
    max_executed_trades_daily,
    max_loss_trades_daily,
    instanceName,
    schedule,
    stopLossMultipler,
    targetMultipler
} = require("./config");

const log = require("./logger").log;
const priceEmitter = require("../services/dynamicservices/priceemitter");
const { resolve } = require("dns");

let latestPreferences = [];
let tickBuffer = {}; // Storage buffer indexed by security_id
let currentSpotPrices = {}; // Tracks current spot price per symbol
let currentExpiryDate = "UNKNOWN_EXPIRY"; // Dynamic Expiry Date tracking

const originalLog = console.log;
console.log = (...args) => {
    originalLog(`[${instanceName}]`, ...args);
};

const interval = Number(scheduler_interval_min) * 60 * 1000;
console.log("interval", interval);

function getCurrentHHMM() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const hh = parts.find(p => p.type === "hour").value;
    const mm = parts.find(p => p.type === "minute").value;

    return `${hh}:${mm}`;
}

// =========================================================================
// 1. FILE PATH HELPER (Azure Cloud vs. Local Workspace Compatibility)
// =========================================================================
// =========================================================================
// 1. FILE PATH HELPER (Prioritizes HOME, CWD/Project Root, or Custom Path)
// =========================================================================
function getStorageFilePath(expiryDate, customBaseDir = null) {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    
    // Resolve base folder hierarchy: Custom Override -> process.env.HOME -> Current Working Dir (Project Root)
    const baseDir = customBaseDir 
        || process.env.TICKS_DIR 
        || process.env.HOME 
        || process.cwd();

    const dirPath = path.join(baseDir, "ticks", expiryDate);

    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    const safeExpiry = (today || "DEFAULT_EXPIRY").replace(/[/\\?%*:|"<>]/g, "_");
    return path.join(dirPath, `${safeExpiry}.csv`);
}

// =========================================================================
// 2. BUFFER FLUSHER (Writes Tick Aggregates Every 5 Seconds)
// =========================================================================
function flushBufferToFile() {
    const activeSecurities = Object.keys(tickBuffer);
    if (activeSecurities.length === 0) return;

    const timestamp = new Date().toISOString();
    const filePath = getStorageFilePath(currentExpiryDate);
    
    // Create Header if file does not exist
    if (!fs.existsSync(filePath)) {
        const header = "symbol,timestamp,security_id,symbol_name,spot_price,volume,oi,ltp_ticks_array\n";
        fs.writeFileSync(filePath, header, "utf8");
    }

    const rowsToWrite = [];

    activeSecurities.forEach((secId) => {
        const item = tickBuffer[secId];
        if (!item || !item.ticks || item.ticks.length === 0) return;

        // 1. Snapshot the current count of ticks to process
        const countToFlush = item.ticks.length;

        // 2. Extract ONLY the ticks up to countToFlush
        const ticksToSave = item.ticks.slice(0, countToFlush);

        const symbol = item.symbol || "NIFTY";
        const spotPrice = currentSpotPrices[symbol] || 0;
        const ticksSerialized = JSON.stringify(ticksToSave);

        // CSV Format: symbol, timestamp, security_id, symbol_name, spot_price, volume, oi, data_array
        const csvRow = `"${symbol}","${timestamp}","${secId}","${item.pmlSymbol || ''}",${spotPrice},${item.lastVolume},${item.lastOI},"${ticksSerialized.replace(/"/g, '""')}"\n`;
        rowsToWrite.push(csvRow);

        // 3. Atomically remove ONLY the processed ticks from the front of the array.
        // Any new ticks appended to item.ticks while stringifying remain safely in the array!
        item.ticks.splice(0, countToFlush);
    });

    if (rowsToWrite.length > 0) {
        fs.appendFile(filePath, rowsToWrite.join(""), (err) => {
            if (err) {
                console.error("Error writing tick buffer to disk:", err.message);
            }
        });
    }
}

// Start 5-second recurring disk persistence job
setInterval(flushBufferToFile, 5000);

// =========================================================================
// 3. START FUNCTION: SCAN, SUBSCRIBE & MONITOR
// =========================================================================
let lastTradeExecution = null;

async function start() {
    const trading_symbols = ["NIFTY"];
    
    // Step A: Fetch spot range contracts (+-25 strikes)
    const result = await scanSpotRangeContracts();
    
    if (!result) {
        console.log("⚠️ No valid contracts returned from scanSpotRangeContracts. Retrying in 5s...");
        
        return new Promise((resolve) => {
            setTimeout(async () => {
                try {
                    await start();
                } catch (err) {
                    console.error("Retry attempt failed:", err.message);
                } finally {
                    resolve();
                }
            }, 5000); // 5-second backoff delay
        });
    }

    latestPreferences = [];

    trading_symbols.forEach((symbol) => {
        const symbolData = result[symbol];
        if (!symbolData || !symbolData.contracts) return;

        currentSpotPrices[symbol] = symbolData.commonSpotPrice || 0;
        if (symbolData.expiry) currentExpiryDate = symbolData.expiry;

        // Step B: Build socket subscription rules for all contracts
        symbolData.contracts.forEach((contract) => {
            if (!contract.securityId) return;

            const secIdStr = contract.securityId.toString();

            latestPreferences.push({
                actionType: "ADD",
                modeType: "QUOTE",
                scripType: "OPTION",
                exchangeType: "NSE",
                scripId: secIdStr,
                symbol: symbol
            });

            // Initialize memory buffer schema for this contract
            if (!tickBuffer[secIdStr]) {
                tickBuffer[secIdStr] = {
                    symbol: symbol,
                    pmlSymbol: contract.pmlSymbol || "",
                    lastVolume: contract.volume || 0,
                    lastOI: 0,
                    ticks: []
                };
            }
        });
    });

    if (latestPreferences.length > 0) {
        console.log(`Subscribing socket to ${latestPreferences.length} contracts across spot ranges...`);
        setPriceFetchConfig(latestPreferences);
        startSocket();
        await delay(3000, "socket start completed");
    } else {
        console.log("⚠️ No contracts found in target payload to subscribe.");
    }
}

// =========================================================================
// 4. TICK EVENT LISTENER: BUFFER INCOMING DATA
// =========================================================================
priceEmitter.on("GLOBAL_TICK", (tick) => {
    if (!tick || !tick.security_id) return;

    const secId = tick.security_id.toString();

    // If uninitialized, set up buffer container
    if (!tickBuffer[secId]) {
        tickBuffer[secId] = {
            symbol: tick.symbol || "NIFTY",
            pmlSymbol: tick.pml_symbol || "",
            lastVolume: 0,
            lastOI: 0,
            ticks: []
        };
    }

    // Append LTP tick entry to memory buffer array
    if (tick.ltp !== undefined) {
        tickBuffer[secId].ticks.push(Number(tick.ltp));
    }

    // Retain latest metrics
    if (tick.volume !== undefined) tickBuffer[secId].lastVolume = Number(tick.volume);
    if (tick.oi !== undefined) tickBuffer[secId].lastOI = Number(tick.oi);

    // Active trade logger context
    let securityIdMap = {};
    Object.values(activeTrades).forEach((trade) => {
        securityIdMap[trade.securityId] = trade;
    });

    if (securityIdMap[secId]) {
        console.log({
            security: tick.security_id,
            ltp: tick.ltp,
            activeTrades: Object.keys(activeTrades).length,
            entry_price: securityIdMap[secId]?.entryPrice,
            exit_price: securityIdMap[secId]?.targetPrice,
        });
    }
});

// =========================================================================
// 5. TRADING WINDOW CHECKER & SCHEDULER
// =========================================================================
function checker() {
    try {

        start();

    } catch (err) {
        console.log("EXECUTION ERROR:", err.message);
    }
}
//start script

checker();
