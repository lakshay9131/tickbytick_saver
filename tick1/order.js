/*
==========================================================
COMBINED:
PERSISTENCE + PAPER TRADE ENGINE
==========================================================
*/

const fs =
    require("fs");

const path =
    require("path");

const priceEmitter =
    require("../services/dynamicservices/priceemitter");

const {
    getLivePrice,
    removeSecuritySubscription
} = require("./securityprice");
const {tradebookpath , order_expiry_minutes} = require("./config")
const log = require("./logger").log;
/*
==========================================================
DATE
==========================================================
*/

const currentDate =
    new Date()
    .toISOString()
    .split("T")[0];

/*
==========================================================
TRADE FOLDER
==========================================================
*/

const PAPER_TRADE_FOLDER =tradebookpath;

if (
    !fs.existsSync(
        PAPER_TRADE_FOLDER
    )
) {

    fs.mkdirSync(
        PAPER_TRADE_FOLDER,
        {
            recursive: true
        }
    );
}

/*
==========================================================
FILE PATH
==========================================================
*/

const PAPER_TRADE_FILE =
    path.join(

        PAPER_TRADE_FOLDER,

        `${currentDate}.json`
    );

/*
==========================================================
ACTIVE TRADES
==========================================================
*/

const activeTrades = {};

/*
==========================================================
DEFAULT TRADEBOOK
==========================================================
*/

let paperTradeBook = {

    date: currentDate,

    stats: {

        totalTrades: 0,

        wins: 0,

        losses: 0,

        expired: 0,

        interrupted: 0,

        openTrades: 0,

        enteredTrades: 0,

        waitingTrades: 0,

        winRate: 0,

        totalPnLPercent: 0
    },

    trades: []
};

/*
==========================================================
LOAD EXISTING
==========================================================
*/

try {

    if (
        fs.existsSync(
            PAPER_TRADE_FILE
        )
    ) {

        paperTradeBook =
            JSON.parse(

                fs.readFileSync(
                    PAPER_TRADE_FILE,
                    "utf8"
                )
            );

        log(
            "TRADEBOOK RESTORED"
        );
         // add this log in main log 
    }

} catch (err) {

    console.log(
        "RESTORE ERROR:",
        err.message
    );
}

/*
==========================================================
SAVE TRADEBOOK
==========================================================
*/

function saveTradeBook() {

    try {

        fs.writeFileSync(

            PAPER_TRADE_FILE,

            JSON.stringify(
                paperTradeBook,
                null,
                2
            )
        );

    } catch (err) {

        console.log(
            "SAVE ERROR:",
            err.message
        );
    }
}

/*
==========================================================
RECALCULATE STATS
==========================================================
*/

function recalculateStats() {

    const trades =
        paperTradeBook.trades;

    const stats =
        paperTradeBook.stats;

    stats.totalTrades =
        trades.length;

    stats.wins =
        trades.filter(
            x => x.status === "WIN"
        ).length;

    stats.losses =
        trades.filter(
            x => x.status === "LOSS"
        ).length;

    stats.expired =
        trades.filter(
            x => x.status === "EXPIRED"
        ).length;

    stats.interrupted =
        trades.filter(
            x => x.status === "INTERRUPTED"
        ).length;

    stats.openTrades =
        trades.filter(
            x =>
                x.status ===
                "ENTERED"
        ).length;

    stats.enteredTrades =
        trades.filter(
            x =>
                x.status ===
                "ENTERED"
        ).length;

    stats.waitingTrades =
        trades.filter(
            x =>
                x.status ===
                "WAITING_ENTRY"
        ).length;

    const closedTrades =

        stats.wins +
        stats.losses;

    stats.winRate =

        closedTrades > 0

        ? Number(
            (
                (
                    stats.wins /
                    closedTrades
                ) * 100
            ).toFixed(2)
        )

        : 0;

    stats.totalPnLPercent =

        Number(

            trades.reduce(

                (acc, trade) =>

                    acc +
                    (
                        trade.pnlPercent || 0
                    ),

                0

            ).toFixed(2)
        );
}

/*
==========================================================
CREATE ID
==========================================================
*/

function createTradeId() {

    return `PT_${
        Date.now()
    }_${
        Math.floor(
            Math.random() * 9999
        )
    }`;
}

/*
==========================================================
ATTACH TRADE LISTENER
==========================================================
*/

function attachTradeListener(
    trade
) {

    const listener =
        (tick) => {

        const ltp =
            tick.ltp;

        /*
        RANGE
        */

        trade.highestPrice =
            Math.max(
                trade.highestPrice,
                ltp
            );

        trade.lowestPrice =
            Math.min(
                trade.lowestPrice,
                ltp
            );
        if(ltp<trade.lowestPrice){
            trade.lowestPrice=ltp;
        }        

        /*
        ENTRY
        */

        if (
            trade.status ===
            "WAITING_ENTRY"
        ) {

            const ENTRY_BUFFER =
                0.2;

            if (

                Math.abs(
                    ltp -
                    trade.entryPrice
                )

                <= ENTRY_BUFFER

            ) {




                // add this log in main log
                const pairId=trade["pair_id"] || "";
                let removed_contract=false;
                 
                if(pairId)
                { 
                   
                    let cancel_trade= activeTrades[pairId];
                    let pair_status=cancel_trade.status;
                    if(pair_status === "WAITING_ENTRY")
                    {
                        // taking trade on order reverse
                        completeTrade(
                        trade,
                        "EXPIRED",
                        trade.entryPrice
                    );
                    removed_contract=true;

                    }
                    else{
                        completeTrade(
                        cancel_trade,
                        "EXPIRED",
                        cancel_trade.entryPrice
                    );
                    }

                }

                if(!removed_contract){


                    trade.status =
                        "ENTERED";

                    trade.entryTime =
                        new Date()
                        .toISOString();

                    trade.actualEntry =
                        ltp;

                    log(
                        "ENTRY HIT",
                        trade.tradeId
                    );


                }



                recalculateStats();

                saveTradeBook();
            }
        }

        /*
        ACTIVE
        */

        else if (
            trade.status ===
            "ENTERED"
        ) {

            /*
            TARGET
            */

            if (
                ltp >=
                trade.targetPrice
            ) {

                completeTrade(
                    trade,
                    "WIN",
                    ltp
                );
            }

            /*
            STOPLOSS
            */

            else if (
                ltp <=
                trade.stoplossPrice
            ) {

                completeTrade(
                    trade,
                    "LOSS",
                    ltp
                );
            }
        }
    };

    trade.listener =
        listener;

    priceEmitter.on(
        trade.securityId,
        listener
    );
}

/*
==========================================================
COMPLETE TRADE
==========================================================
*/

function completeTrade(
    trade,
    status,
    exitPrice
) {

    trade.status =
        status;

    trade.exitPrice =
        exitPrice;

    trade.exitTime =
        new Date()
        .toISOString();

    trade.pnlPercent =
        Number(
            (
                (
                    (
                        exitPrice -
                        trade.entryPrice
                    ) /
                    trade.entryPrice
                ) * 100
            ).toFixed(2)
        );

    /*
    REMOVE MEMORY
    */

    delete activeTrades[
        trade.tradeId
    ];

    /*
    REMOVE LISTENER
    */

    if (
        trade.listener
    ) {

        priceEmitter.removeListener(

            trade.securityId,

            trade.listener
        );
    }

    recalculateStats();

    saveTradeBook();
    
    // remove subscription to save resources since trade is closed
    // removeSecuritySubscription(
    //     trade.securityId
    // );

    log(
        "TRADE CLOSED:",
        trade.tradeId,
        status
    );
     // add this log in main log 

    if (status === "WIN") {
        startPostWinTracker(trade);
        setTimeout(() => removeSecuritySubscription(trade.securityId), 2*60 * 1000);
    } else {
        removeSecuritySubscription(trade.securityId);
    }
}

/*
==========================================================
RESTORE ACTIVE TRADES
==========================================================
*/

function restoreActiveTrades() {

    console.log(
        "\nRESTORING ACTIVE TRADES\n"
    );

    const now =
        Date.now();

    paperTradeBook.trades
    .forEach((trade) => {

        /*
        SKIP CLOSED
        */

        if (

            trade.status ===
            "WIN"

            ||

            trade.status ===
            "LOSS"

            ||

            trade.status ===
            "EXPIRED"

            ||

            trade.status ===
            "INTERRUPTED"

        ) {

            return;
        }

        /*
        EXPIRY CHECK
        */

        const createdAt =
            new Date(
                trade.createdAt
            ).getTime();

        const expiryMs =

            (
                trade.expiryMinutes
                || 10
            )

            * 60 * 1000;

        const expired =

            now >
            (
                createdAt +
                expiryMs
            );

        /*
        EXPIRE
        */

       if (expired && trade.status === "WAITING_ENTRY") {

            console.log(
                "RESTORE EXPIRED:",
                trade.tradeId
            );

            completeTrade(

                trade,

                "EXPIRED",

                trade.entryPrice
            );

            return;
        }

        /*
        RESTORE MEMORY
        */

        activeTrades[
            trade.tradeId
        ] = trade;

        /*
        REATTACH
        */

        attachTradeListener(
            trade
        );

        console.log(
            "RESTORED:",
            trade.tradeId
        );
    });

    recalculateStats();

    saveTradeBook();
}

/*
==========================================================
CHECK ACTIVE TRADE
==========================================================
*/

function hasActiveNonExpiredTrade() {

    return Object.values(
        activeTrades
    ).some((trade) =>

        trade.status ===
        "WAITING_ENTRY"

        ||

        trade.status ===
        "ENTERED"
    );
}





function getEntryOffsetAndTarget(ltp,target_multipler=1.047 , stoploss_multipler=0.40) {

    if (!ltp){
        console.log(" LTP INVALID GET TARGET")
        return;
    }

    const now =
        new Date();

    const hours =
        now.getHours();

    const minutes =
        now.getMinutes();

    const timeString =
        `${hours}${minutes}`;

    const ds = (timeString) => {
    const sum = timeString
        .split("")
        .reduce((acc, digit) => acc + Number(digit), 0);
    
    return sum >= 10 ? ds(String(sum)) : sum;
    };
    const digitSum = ds(timeString);  
    let entryminOffset= (3.4 *ltp /100);
    let entrymaxOffset= (6.8 *ltp /100);

    let entryOffset= Math.min(Math.max(digitSum / 2, entryminOffset),entrymaxOffset) - (0.002 * ltp);
    let entryValue= ltp-entryOffset;
 
    let targetValue =  (target_multipler * entryValue) + 0.40  ; //added 0.40 percentage random value to target price to increase the target and account for brokerage costs and slippage, since we are targeting 0.20 percentage move, this should give us a better chance of hitting the target after accounting for costs
    targetValue = Math.max( entryValue+1 , targetValue);

    let slValue = stoploss_multipler *entryValue; //60 percent sl 

    return {
        digitSum,
        entryOffset,
        entryValue,
        targetValue,
        slValue
    };
}
/*
==========================================================
TAKE TRADE
==========================================================
*/

async function takeTrade({

    symbol = "UNKNOWN",

    strategy =
        "OI_VOLUME_BREAKOUT",

    securityId,

    direction = "BUY",

    expiryMinutes = order_expiry_minutes,

    pair_id = null,
    order_type="limit",
    trade_id="",
    strike="",
    ltp_consider=-1,
    stoploss_multiplier=0.40,
    target_multiplier=1.047,

}) {
    const stoploss_percentage= 0.847;

    const liveData =
        getLivePrice(
            securityId.toString()
        );

    if (!liveData) {

        console.log(
            "NO LIVE DATA"
        );

        return null;
    }
    if(trade_id === ""){
        console.log("Invalid Trade id",trade_id);
        return;
    }
    let ltp =
        liveData.ltp;

    if(ltp_consider !=-1){
        ltp=ltp_consider;
    }


    
    await delay(200 ,"Waiting 0.2 sec before executing trade"); // wait for 0.2 seconds before executing the trade to get a better price
    const { digitSum, randomValue,entryValue,targetValue ,slValue } = getEntryOffsetAndTarget(ltp,target_multiplier,stoploss_multiplier);
    let entryPrice =
        Number(
            (
                entryValue
            ).toFixed(2)
        ); 


    const targetPrice =
        Number(
            (
                targetValue
            ).toFixed(2)
        );

    const stoplossPrice =
        Number(
            (
                slValue
            ).toFixed(2)
        );

    const trade = {

        tradeId:
            trade_id,

        symbol,

        strategy,

        securityId:
            securityId.toString(),

        direction,

        status:
            "WAITING_ENTRY",

        createdAt:
            new Date()
            .toISOString(),
        pair_id: pair_id || "",

        expiryMinutes,

        entryPrice,

        targetPrice,

        stoplossPrice,

        highestPrice:
            ltp,

        lowestPrice:
            ltp,

        maxFavorableMove: 0,

        maxAdverseMove: 0,
        strike
    };

    /*
    MEMORY
    */

    activeTrades[
        trade.tradeId
    ] = trade;

    /*
    TRADEBOOK
    */

    paperTradeBook.trades.push(
        trade
    );

    /*
    ATTACH
    */

    attachTradeListener(
        trade
    );

    /*
    SAVE
    */

    recalculateStats();

    saveTradeBook();

    log(
        "TRADE CREATED",
        trade.tradeId,
        trade.status
    );
     // add this log in main log 

    /*
    EXPIRY TIMER
    */

    setTimeout(() => {

        if (

            trade.status ===
            "WAITING_ENTRY"
        ) {

            completeTrade(
                trade,
                "EXPIRED",
                trade.entryPrice
            );
        }

    }, expiryMinutes * 60 * 1000);

    return trade;
}

/*
==========================================================
GETTERS
==========================================================
*/

function getTrades() {

    return paperTradeBook.trades;
}

function getTradeStats() {

    return paperTradeBook.stats;
}

/*
==========================================================
AUTO CLEANUP
==========================================================
*/

setInterval(() => {

    Object.keys(
        activeTrades
    ).forEach((tradeId) => {

        const trade =
            activeTrades[
                tradeId
            ];

        if (

            trade.status ===
            "WIN"

            ||

            trade.status ===
            "LOSS"

            ||

            trade.status ===
            "EXPIRED"

        ) {

            delete activeTrades[
                tradeId
            ];
        }
    });

}, 30000);

/*
==========================================================
RESTORE ON START
==========================================================
*/

restoreActiveTrades();

/*
==========================================================
INITIAL SAVE
==========================================================
*/

recalculateStats();

saveTradeBook();

function delay(ms ,msg="") {

    return new Promise(
        (resolve) => {

            setTimeout(
                resolve,
                ms
            );
            log(msg);
        }
    );
}


async function createPairTrades(symbol,targetContracts){
    const tradeID1=createTradeId();
    const tradeID2=createTradeId();
    const promise1= takeTrade({
            symbol,
            pair_id : tradeID2,
            order_type : "limit",
            trade_id : tradeID1,
            strike: targetContracts.ceStrike+"_CE",
            securityId: targetContracts.ceSecurityId,   
            ltp_consider: targetContracts.ceLtp,         
        });
    const promise2= takeTrade({
            symbol,
            pair_id : tradeID1,
            order_type : "limit",
            trade_id : tradeID2,
            strike: targetContracts.peStrike+"_PE",
            securityId: targetContracts.peSecurityId,
            ltp_consider: targetContracts.peLtp, 
        });   
    await Promise.all([promise1,promise2])    ;
    return true;
}


/*
==========================================================
GET LAST ORDER FROM BOOK
==========================================================
*/
/*
==========================================================
GET ACTIVE AND EXECUTED SECURITIES METRICS
==========================================================
*/
function getExecutedSecuritiesSummary() {
    const trades = paperTradeBook.trades;
    
    // CRITICAL UPDATE: Filter strictly for fills. 
    // "WAITING_ENTRY" is removed because those contracts haven't actually filled yet.
    const validExecutionStatuses = ["ENTERED", "WIN", "LOSS"];
    
    const executedTrades = trades.filter(trade => 
        validExecutionStatuses.includes(trade.status)
    );

    const securityCounts = {};
    let lastOrderSecurity = null;

    if (executedTrades.length > 0) {
        // 1. Process security frequencies for filled positions
        executedTrades.forEach(trade => {
            const secId = trade.securityId;
            if (secId) {
                securityCounts[secId] = (securityCounts[secId] || 0) + 1;
            }
        });

        // 2. Extract the last structural item that actually entered a position
        const lastTrade = executedTrades[executedTrades.length - 1];
        
        // Extracting symbol directly from the trade payload, or parsing the securityId string as a fallback
        const lastTradedSymbol = lastTrade.symbol || (lastTrade.securityId ? lastTrade.securityId.split("_")[2] : "UNKNOWN");

        lastOrderSecurity = {
            tradeId: lastTrade.tradeId,
            securityId: lastTrade.securityId,
            symbol: lastTradedSymbol, // <--- Added explicitly here
            status: lastTrade.status,
            createdAt: lastTrade.createdAt,
            entryPrice: lastTrade.entryPrice || "N/A" // Handy metadata for execution logs
        };
    }

    return {
        totalExecutedCount: executedTrades.length,
        securityCounts,         // Object containing { securityId: count }
        lastOrderSecurity,      // Metadata detailing the final valid transaction
        lastTradedSymbol: lastOrderSecurity ? lastOrderSecurity.symbol : null // <--- Top level access convenience
    };
}



function getTotalWinLossCounter() {
    const trades = paperTradeBook.trades || [];

    // Filter strictly for completed trades across the entire history
    const totalWins = trades.filter(t => t.status === "WIN").length;
    const totalLosses = trades.filter(t => t.status === "LOSS").length;
    const totalExpired = trades.filter(t => t.status === "EXPIRED").length;
    const totalActive = trades.filter(t => t.status === "ENTERED").length;

    const totalExecuted = totalWins + totalLosses;

    return {
        totalWins,
        totalLosses,
        totalExpired,
        totalActive,
        totalExecutedTrades: totalExecuted,
        allTimeWinRatePercent: totalExecuted > 0 
            ? Number(((totalWins / totalExecuted) * 100).toFixed(2)) 
            : 0
    };
}

/*
==========================================================
POST WIN TRACKER
==========================================================
*/

function startPostWinTracker(trade) {

    const trackingDuration = 1.7 * 60  * 1000; // 1.7 min 
    const startTime = Date.now();

    let peakPrice = trade.exitPrice;
    let peakTimestamp = new Date().toISOString();

    const postWinListener = (tick) => {

        const ltp = tick.ltp;

        if (ltp > peakPrice) {
            peakPrice = ltp;
            peakTimestamp = new Date().toISOString();
        }
    };

    // Attach listener to same security
    priceEmitter.on(trade.securityId, postWinListener);

    setTimeout(() => {

        // Remove listener after 40 sec
        priceEmitter.removeListener(trade.securityId, postWinListener);

        const additionalMove = Number(
            (peakPrice - trade.exitPrice).toFixed(2)
        );

        const additionalMovePercent = Number(
            (
                ((peakPrice - trade.exitPrice) / trade.exitPrice) * 100
            ).toFixed(2)
        );

        log(
            "TRADE_COMPLETED_SUMMARY",
            "\n  TradeId     :", trade.tradeId,
            "\n  Symbol      :", trade.symbol,
            "\n  Exit Price  :", trade.exitPrice,
            "\n  Exit Time   :", trade.exitTime,
            "\n  Peak After  :", peakPrice,
            "\n  Peak Time   :", peakTimestamp,
            "\n  Extra Move  :", `+${additionalMove} (${additionalMovePercent}%)`,
            "\n  Tracked For : 40 sec"
        );

        // Optional: persist into trade object
        trade.postWinPeak = {
            peakPrice,
            peakTimestamp,
            additionalMove,
            additionalMovePercent,
            trackedUntil: new Date().toISOString()
        };

        saveTradeBook();

    }, trackingDuration);
}
/*
==========================================================
EXPORTS
==========================================================
*/

module.exports = {

    createPairTrades,

    getTrades,

    getTradeStats,

    activeTrades,

    restoreActiveTrades,

    hasActiveNonExpiredTrade,
    delay,
    getExecutedSecuritiesSummary,
    getTotalWinLossCounter,
    createTradeId,
    takeTrade
};

