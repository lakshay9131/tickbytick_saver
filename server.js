const { spawn } = require("child_process");
const express = require("express");
const fs = require("fs");
const path = require("path");
const date = new Date().toISOString().slice(0, 10);
const logPath = `D:\\home\\LogFiles\\Application\\app_${date}.log`;

function writeLog(...args) {
    const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
    fs.appendFileSync(logPath, line);
    process.stdout.write(line);
}

console.log = writeLog;
console.error = writeLog;



function spawnInstance(script) {
    const child = spawn("node", [script], { shell: true });

    child.stdout.on("data", (data) => {
        writeLog(data.toString().trim());
    });

    child.stderr.on("data", (data) => {
        writeLog("[ERR]", data.toString().trim());
    });

    child.on("exit", (code) => {
        writeLog(`[EXIT] ${script} exited with code ${code}`);
    });
}


spawnInstance("./tick1/temp.js");

const app = express();

app.get("/", (req, res) => {
    res.json({ status: "running", timestamp: new Date().toISOString() });
});

const port = process.env.PORT || 8080;
app.listen(port, () => writeLog("Gateway running on", port));