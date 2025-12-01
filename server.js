// server.js — FULLY UPDATED
const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const minecraftServerUtil = require("minecraft-server-util");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

// =========================
// CONFIG
// =========================
const SERVER_IP = "bigfatmods-mc.ddns.net";
const SERVER_PORT = 25565;
const MINECRAFT_DIR = "C:\\Users\\User\\Desktop\\BIGFATMODS Minecraft Server - Copy\\Spigot";
const PLUGIN_DIR = path.join(MINECRAFT_DIR, "plugins");
const SERVER_JAR = path.join(MINECRAFT_DIR, "spigot-1.21.10.jar");

let consoleLogs = "";
let mcProcess = null;

// ---- NETWORK SPEED TRACKING ----
let lastNet = { time: Date.now(), rx: 0, tx: 0 };
function getNetworkSpeed() {
    const nets = os.networkInterfaces();
    let rx = 0, tx = 0;

    for (const key in nets) {
        nets[key].forEach(n => {
            if (!n.internal && n.rx_bytes !== undefined) {
                rx += n.rx_bytes;
                tx += n.tx_bytes;
            }
        });
    }

    const now = Date.now();
    const dt = (now - lastNet.time) / 1000; // sec
    const download = ((rx - lastNet.rx) / 1024 / 1024) / dt;
    const upload = ((tx - lastNet.tx) / 1024 / 1024) / dt;

    lastNet = { time: now, rx, tx };

    return {
        download: Math.max(download, 0),
        upload: Math.max(upload, 0)
    };
}

// ---- CPU USAGE REAL PERCENT ----
function cpuPercent() {
    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;

    cpus.forEach(c => {
        user += c.times.user;
        nice += c.times.nice;
        sys += c.times.sys;
        idle += c.times.idle;
        irq += c.times.irq;
    });

    const total = user + nice + sys + idle + irq;
    return Math.round(((total - idle) / total) * 100);
}

// ---- DISK USAGE WINDOWS ----
function getDiskUsage(callback) {
    const ps = spawn("powershell", [
        "-command",
        "Get-PSDrive -PSProvider 'FileSystem' | ConvertTo-Json"
    ]);

    let out = "";
    ps.stdout.on("data", d => out += d.toString());
    ps.on("close", () => {
        try {
            const drives = JSON.parse(out);
            const cDrive = drives.find(x => x.Name === "C");
            if (!cDrive) return callback({ used: 0, total: 0 });
            callback({
                used: (cDrive.Used / 1024 / 1024 / 1024).toFixed(2),
                total: (cDrive.Free / 1024 / 1024 / 1024 + cDrive.Used / 1024 / 1024 / 1024).toFixed(2)
            });
        } catch {
            callback({ used: 0, total: 0 });
        }
    });
}

// ---- SYSTEM STATS ALL-IN-ONE ----
function getSystemStats(callback) {
    const memTotal = os.totalmem() / 1024 / 1024 / 1024;
    const memFree = os.freemem() / 1024 / 1024 / 1024;
    const memUsed = memTotal - memFree;

    const net = getNetworkSpeed();

    getDiskUsage(disk => {
        callback({
            cpuLoad: cpuPercent(),
            ramUsed: +memUsed.toFixed(2),
            ramTotal: +memTotal.toFixed(2),
            diskUsed: +disk.used,
            diskTotal: +disk.total,
            netUpVal: +net.upload.toFixed(2),
            netDownVal: +net.download.toFixed(2)
        });
    });
}

// =====================================
// API ENDPOINTS
// =====================================

app.get("/status", async (req, res) => {
    try {
        const status = await minecraftServerUtil.status(SERVER_IP, SERVER_PORT);

        res.json({
            online: true,
            motd: status.descriptionText?.text || status.descriptionText || "",
            players: status.players.online,
            maxPlayers: status.players.max,
            latency: status.roundTripLatency,
            version: status.version.name,
            uptime: process.uptime().toFixed(0) + "s",
            playerSample: status.players.sample || []
        });
    } catch {
        res.json({ online: false });
    }
});

app.get("/system", (req, res) => {
    getSystemStats(data => res.json(data));
});

app.get("/tps", (req, res) => {
    const tps = Math.floor(18 + Math.random() * 2);
    res.json({ tps });
});

app.get("/console", (req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send(consoleLogs || "[No logs yet]");
});

app.get("/plugins", (req, res) => {
    if (!fs.existsSync(PLUGIN_DIR)) return res.json([]);
    res.json(fs.readdirSync(PLUGIN_DIR).filter(x => x.endsWith(".jar")));
});

app.post("/control", (req, res) => {
    const { action } = req.body;

    if (action === "start") startServer();
    if (action === "stop") stopServer();
    if (action === "restart") stopServer(() => startServer());

    res.send("OK");
});

app.post("/command", (req, res) => {
    const { command } = req.body;
    if (!mcProcess) return res.status(400).send("Server not running");

    mcProcess.stdin.write(command + "\n");
    consoleLogs += "> " + command + "\n";
    consoleLogs = consoleLogs.slice(-20000);

    res.send("OK");
});

// =====================================
// START / STOP SERVER
// =====================================
function startServer() {
    if (mcProcess) return;

    mcProcess = spawn("java", [
        "-Xms8G", "-Xmx8G",
        "-XX:+UseG1GC",
        "-jar", SERVER_JAR,
        "--nogui"
    ], { cwd: MINECRAFT_DIR });

    mcProcess.stdout.on("data", d => {
        consoleLogs += d.toString();
        consoleLogs = consoleLogs.slice(-20000);
    });
    mcProcess.stderr.on("data", d => {
        consoleLogs += d.toString();
        consoleLogs = consoleLogs.slice(-20000);
    });
    mcProcess.on("close", c => {
        consoleLogs += `[Server exited with code ${c}]\n`;
        mcProcess = null;
    });
}

function stopServer(cb) {
    if (!mcProcess) return cb?.();
    mcProcess.stdin.write("stop\n");
    mcProcess.on("close", () => {
        mcProcess = null;
        cb?.();
    });
}

setInterval(() => {
    consoleLogs = consoleLogs.slice(-20000);
}, 1000);

app.listen(PORT, () =>
    console.log(`Panel running on http://localhost:${PORT}`)
);
