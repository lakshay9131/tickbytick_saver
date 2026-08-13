const path = require("path");
const schedule = [
    "10:17" ,
    "13:17"
]; 

const instanceName="instance17b1";
const tradebookpath=    path.join(
        __dirname,
        "../dynamic_data/paper_trades17b1"
    );
// const tradebookpath = path.join(process.env.HOME, 'data', "dynamic_data/paper_trades17b1");
const logpath= path.join(
        __dirname,
        "./logs"
    );
const socketlogpath= path.join(
        __dirname,
        "../dynamic_data/socket_logs"
    );
const order_expiry_minutes = 15 ; // in minutes //before



const scheduler_interval_min= "2";
const  scheduler_interval_start="09:30";
const  scheduler_interval_end="25:00";
const max_executed_trades_daily = 50;
const max_loss_trades_daily = 1;
const dropMin =4;
const dropMax = 14;
const dropTimeWindow = 10;
const stopLossMultipler = 0.50;
const targetMultipler= 1.051;
module.exports = {

    schedule,
    tradebookpath,
    instanceName,
    logpath,
    socketlogpath,
    order_expiry_minutes,
    scheduler_interval_min,
    scheduler_interval_start,
    scheduler_interval_end,
    max_executed_trades_daily,
    max_loss_trades_daily,
    dropMin,
    dropMax,
    dropTimeWindow,
    stopLossMultipler,
    targetMultipler
    
};  