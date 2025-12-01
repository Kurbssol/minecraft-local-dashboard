// server.js (updated)
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

// ========== CONFIG ==========
const SERVER_IP = "server url or ip";
const SERVER_PORT = 25565;
const MINECRAFT_DIR = "minecraft server directory from main server"; // change to your minecraft server ip/url
const PLUGIN_DIR = path.join(MINECRAFT_DIR, "plugins"); // leave plugins as is
const SERVER_JAR = path.join(MINECRAFT_DIR, "spigot-1.21.10.jar"); // change spigot-1.21.10.jar to whatever your server.jar file name is

// For console logging
let consoleLogs = "";

// Track network speed (placeholder)
let previousNetworkStats = { lastTime: Date.now() };

// ========== SYSTEM STATS ==========
function getSystemStats() {
    const totalMem = os.totalmem() / 1024 / 1024 / 1024;
    const freeMem = os.freemem() / 1024 / 1024 / 1024;
    const usedMem = totalMem - freeMem;

    const diskUsed = 120; // placeholder
    const diskTotal = 250;

    const now = Date.now();
    previousNetworkStats.lastTime = now;

    const netUpVal = parseFloat((Math.random() * 5).toFixed(2));
    const netDownVal = parseFloat((Math.random() * 5).toFixed(2));

    return {
        cpuLoad: Math.floor(os.loadavg()[0] / os.cpus().length * 100),
        ramUsed: parseFloat(usedMem.toFixed(2)),
        ramTotal: parseFloat(totalMem.toFixed(2)),
        diskUsed,
        diskTotal,
        netUpVal,
        netDownVal,
        netUp: `${netUpVal} MB/s`,
        netDown: `${netDownVal} MB/s`
    };
}

// ========== MINECRAFT STATUS ==========
app.get("/status", async (req, res) => {
    try {
        const status = await minecraftServerUtil.status(SERVER_IP, SERVER_PORT);

        let motd = "";
        if (typeof status.descriptionText === "string") motd = status.descriptionText;
        else if (status.descriptionText?.text) motd = status.descriptionText.text;

        res.json({
            online: true,
            motd,
            players: status.players.online,
            maxPlayers: status.players.max,
            latency: status.roundTripLatency,
            version: status.version.name,
            uptime: process.uptime().toFixed(0) + "s",
            java: process.env.JAVA_HOME || "Java Unknown",
            playerSample: status.players.sample || []
        });
    } catch (err) {
        res.json({ online: false });
    }
});

// ========== SYSTEM PERFORMANCE ==========
app.get("/system", (req, res) => {
    res.json(getSystemStats());
});

// ========== LIVE TPS ==========
app.get("/tps", (req, res) => {
    const tps = Math.floor(18 + Math.random() * 2);
    res.json({ tps });
});

// ========== CONSOLE VIEWER ==========
app.get("/console", (req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send(consoleLogs || "[No logs yet]");
});

// ========== PLUGINS ==========
app.get("/plugins", (req, res) => {
    if (!fs.existsSync(PLUGIN_DIR)) return res.json([]);
    const plugins = fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith(".jar"));
    res.json(plugins);
});

// ========== SERVER CONTROL ==========
app.post("/control", (req, res) => {
    const { action } = req.body;
    if (!["start", "stop", "restart"].includes(action)) return res.status(400).send("Invalid action");

    if (action === "start") startServer();
    else if (action === "stop") stopServer();
    else if (action === "restart") stopServer(() => startServer());

    res.send("OK");
});

// ========== COMMAND INPUT (WRITE TO SERVER STDIN) ==========
app.post("/command", (req, res) => {
    const { command } = req.body;
    if (!command || typeof command !== "string") return res.status(400).send("Missing command");
    if (!mcProcess || mcProcess.stdin.destroyed) {
        return res.status(400).send("Server not running");
    }

    try {
        // ensure newline
        mcProcess.stdin.write(command.trim() + "\n");
        // echo it to console logs so the dashboard shows the command immediately
        consoleLogs += `> ${command.trim()}\n`;
        consoleLogs = consoleLogs.slice(-20000);
        res.send("OK");
    } catch (err) {
        res.status(500).send("Failed to send command");
    }
});

// ========== SERVER PROCESS ==========
let mcProcess = null;

function startServer() {
    if (mcProcess) return;

    // Start Java with your desired flags (matches your .bat)
    mcProcess = spawn("java", [
        "-Xms8G",
        "-Xmx8G",
        "-XX:+UseG1GC",
        "-jar", SERVER_JAR,
        "--nogui"
    ], { cwd: MINECRAFT_DIR });

    mcProcess.stdout.on("data", (data) => {
        consoleLogs += data.toString();
        consoleLogs = consoleLogs.slice(-20000);
    });

    mcProcess.stderr.on("data", (data) => {
        consoleLogs += data.toString();
        consoleLogs = consoleLogs.slice(-20000);
    });

    mcProcess.on("close", (code) => {
        consoleLogs += `[Server exited with code ${code}]\n`;
        mcProcess = null;
    });
}

function stopServer(callback) {
    if (!mcProcess) return callback?.();
    try {
        mcProcess.stdin.write("stop\n");
    } catch (err) {
        // ignore
    }
    mcProcess.on("close", () => {
        mcProcess = null;
        callback?.();
    });
}

// Trim logs periodically
setInterval(() => {
    consoleLogs = consoleLogs.slice(-20000);
}, 1000);

app.listen(PORT, () => console.log(`Server dashboard running on http://localhost:${PORT}`));

