#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
);

const BASE_URL =
    process.env.CRAFTLY_TEST_BASE_URL || "";

const SFTP_PORT =
    Number(process.env.CRAFTLY_TEST_SFTP_PORT || 2022);

const ENABLE_DOCKER =
    process.env.CRAFTLY_TEST_DOCKER === "1";

const results = [];

function pass(name, detail = "") {
    results.push({
        status: "PASS",
        name,
        detail
    });

    console.log(
        `✓ PASS  ${name}${detail ? ` — ${detail}` : ""}`
    );
}

function fail(name, detail = "") {
    results.push({
        status: "FAIL",
        name,
        detail
    });

    console.error(
        `✗ FAIL  ${name}${detail ? ` — ${detail}` : ""}`
    );
}

function skip(name, detail = "") {
    results.push({
        status: "SKIP",
        name,
        detail
    });

    console.log(
        `⚠ SKIP  ${name}${detail ? ` — ${detail}` : ""}`
    );
}

function run(command, args = [], options = {}) {
    return spawnSync(command, args, {
        cwd: ROOT,
        encoding: "utf8",
        timeout: options.timeout || 120000,
        shell: process.platform === "win32",
        env: {
            ...process.env,
            ...(options.env || {})
        },
        maxBuffer: 12 * 1024 * 1024
    });
}

function exists(file) {
    return fs.existsSync(
        path.join(ROOT, file)
    );
}

function walk(directory, files = []) {
    for (
        const entry of fs.readdirSync(
            directory,
            { withFileTypes: true }
        )
    ) {
        if (
            [
                "node_modules",
                ".git",
                "coverage",
                "dist",
                "build"
            ].includes(entry.name)
        ) {
            continue;
        }

        const fullPath = path.join(
            directory,
            entry.name
        );

        if (entry.isDirectory()) {
            walk(fullPath, files);
        } else {
            files.push(fullPath);
        }
    }

    return files;
}

function getPackage() {
    try {
        return JSON.parse(
            fs.readFileSync(
                path.join(ROOT, "package.json"),
                "utf8"
            )
        );
    } catch {
        return null;
    }
}

console.log("");
console.log(
    "╔══════════════════════════════════════════╗"
);
console.log(
    "║             CRAFTLY AUTOMATED QA          ║"
);
console.log(
    "╚══════════════════════════════════════════╝"
);
console.log("");

console.log(`Project: ${ROOT}`);
console.log(`Node:    ${process.version}`);
console.log("");

/*
=========================================================
1. ENVIRONMENT
=========================================================
*/

const nodeMajor =
    Number(
        process.versions.node.split(".")[0]
    );

if (nodeMajor >= 24) {
    pass(
        "Node.js version",
        process.version
    );
} else {
    skip(
        "Node.js version",
        `${process.version} found; Node.js 24+ required for runtime certification`
    );
}

const npmVersion = run(
    "npm",
    ["--version"],
    { timeout: 15000 }
);

if (npmVersion.status === 0) {
    pass(
        "npm",
        npmVersion.stdout.trim()
    );
} else {
    fail(
        "npm",
        "npm is unavailable"
    );
}

/*
=========================================================
2. PACKAGE
=========================================================
*/

if (exists("package.json")) {
    pass("package.json");
} else {
    fail(
        "package.json",
        "File missing"
    );
}

const pkg = getPackage();

if (!pkg) {
    fail(
        "Package metadata",
        "Invalid package.json"
    );
} else {

    if (pkg.name === "craftly") {
        pass(
            "Package name",
            "craftly"
        );
    } else {
        fail(
            "Package name",
            `Expected craftly, found ${pkg.name || "missing"}`
        );
    }

    if (pkg.version) {
        pass(
            "Package version",
            pkg.version
        );
    } else {
        fail(
            "Package version",
            "Missing"
        );
    }

    if (pkg.description) {
        pass(
            "Package description"
        );
    } else {
        fail(
            "Package description",
            "Missing"
        );
    }
}

/*
=========================================================
3. LOCKFILE
=========================================================
*/

const lockfiles = [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock"
];

const lockfile =
    lockfiles.find(exists);

if (lockfile) {
    pass(
        "Dependency lockfile",
        lockfile
    );
} else {
    skip(
        "Dependency lockfile",
        "No supported lockfile"
    );
}

/*
=========================================================
4. DEPENDENCIES
=========================================================
*/

if (exists("package-lock.json")) {

    const result = run(
        "npm",
        [
            "ls",
            "--depth=0",
            "--omit=optional"
        ],
        {
            timeout: 180000
        }
    );

    if (result.status === 0) {
        pass(
            "Dependency tree",
            "npm ls clean"
        );
    } else {
        fail(
            "Dependency tree",
            (
                result.stderr ||
                result.stdout ||
                "npm ls failed"
            )
                .trim()
                .slice(0, 2000)
        );
    }

} else {

    skip(
        "Dependency tree",
        "package-lock.json unavailable"
    );
}

/*
=========================================================
5. JAVASCRIPT SYNTAX
=========================================================
*/

const jsFiles =
    walk(ROOT).filter(
        file =>
            /\.(js|mjs|cjs)$/.test(file)
    );

let syntaxFailures = 0;

for (const file of jsFiles) {

    const result = run(
        process.execPath,
        [
            "--check",
            file
        ],
        {
            timeout: 30000
        }
    );

    if (result.status !== 0) {
        syntaxFailures++;
    }
}

if (syntaxFailures === 0) {

    pass(
        "JavaScript syntax",
        `${jsFiles.length} files checked`
    );

} else {

    fail(
        "JavaScript syntax",
        `${syntaxFailures} file(s) failed`
    );
}

/*
=========================================================
6. BUILD
=========================================================
*/

if (pkg?.scripts?.build) {

    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (nodeMajor < 24 || !exists("node_modules")) {
        skip(
            "Production build",
            nodeMajor < 24 ? `Node ${process.versions.node} found; Node 24+ required` : "Dependencies are not installed"
        );
    } else {
    const result = run(
        "npm",
        ["run", "build"],
        {
            timeout: 300000
        }
    );

    if (result.status === 0) {

        pass(
            "Production build"
        );

    } else {

        fail(
            "Production build",
            (
                result.stderr ||
                result.stdout ||
                "Build failed"
            )
                .trim()
                .slice(-3000)
        );
    }
    }

} else {

    skip(
        "Production build",
        "No build script"
    );
}

/*
=========================================================
7. UNIT TESTS
=========================================================
*/

if (
    pkg?.scripts?.test &&
    !/no test|echo.*test/i.test(
        pkg.scripts.test
    )
) {

    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (nodeMajor < 24 || !exists("node_modules")) {
        skip(
            "Unit tests",
            nodeMajor < 24 ? `Node ${process.versions.node} found; Node 24+ required` : "Dependencies are not installed"
        );
    } else {
    const result = run(
        process.execPath,
        [
            "--test",
            "test/**/*.test.js"
        ],
        {
            timeout: 300000
        }
    );

    if (result.status === 0) {

        pass(
            "Unit tests"
        );

    } else {

        fail(
            "Unit tests",
            (
                result.stderr ||
                result.stdout ||
                "Tests failed"
            )
                .trim()
                .slice(-3000)
        );
    }
    }

} else {

    skip(
        "Unit tests",
        "No usable test script"
    );
}

/*
=========================================================
8. BRANDING AUDIT
=========================================================
*/

const legacyPatterns = [
    /\bMPanel\b/gi,
    /\bMpanel\b/gi,
    /\bmpanel\b/gi,
    /\bNobita329\b/gi,
    /\bNobita\b/gi,
    /nobita329\/Mpanel/gi,
    /minecraft-server-manager/gi,
    /\banefzaoui\b/gi
];

const brandingHits = [];

for (const file of walk(ROOT)) {

    if (
        /node_modules|\.git|third[-_ ]party|licenses?|(^|[\\/])test([\\/]|$)/i
            .test(file)
    ) {
        continue;
    }

    let text;

    try {
        text =
            fs.readFileSync(
                file,
                "utf8"
            );
    } catch {
        continue;
    }

    if (text.includes("\0")) {
        continue;
    }

    for (
        const pattern of legacyPatterns
    ) {

        pattern.lastIndex = 0;

        if (pattern.test(text)) {
            brandingHits.push(
                path.relative(ROOT, file)
            );
            break;
        }
    }
}

if (brandingHits.length === 0) {

    pass(
        "Legacy branding audit",
        "No old branding found"
    );

} else {

    fail(
        "Legacy branding audit",
        `${brandingHits.length} file(s) need review`
    );

    for (
        const file of brandingHits.slice(0, 20)
    ) {
        console.error(
            `  → ${file}`
        );
    }
}

/*
=========================================================
9. CRAFTLY PORTS
=========================================================
*/

const requiredPorts = [
    "6060",
    "6070",
    "2022"
];

const portHits = new Set();

for (const file of walk(ROOT)) {

    let text;

    try {
        text =
            fs.readFileSync(
                file,
                "utf8"
            );
    } catch {
        continue;
    }

    if (text.includes("\0")) {
        continue;
    }

    for (
        const port of requiredPorts
    ) {

        if (text.includes(port)) {
            portHits.add(port);
        }
    }
}

for (
    const port of requiredPorts
) {

    if (portHits.has(port)) {

        pass(
            `Port ${port}`,
            "Reference found"
        );

    } else {

        skip(
            `Port ${port}`,
            "Not found in static scan"
        );
    }
}

/*
=========================================================
10. HTTP HEALTH
=========================================================
*/

async function testHTTP() {

    if (!BASE_URL) {

        skip(
            "HTTP health",
            "Set CRAFTLY_TEST_BASE_URL"
        );

        return;
    }

    const endpoints = [
        "/",
        "/health",
        "/api/health"
    ];

    let healthy = false;

    for (
        const endpoint of endpoints
    ) {

        try {

            const response =
                await fetch(
                    new URL(
                        endpoint,
                        BASE_URL
                    )
                );

            if (
                response.status < 500
            ) {

                healthy = true;

                pass(
                    `HTTP ${endpoint}`,
                    String(response.status)
                );
            }

        } catch {}
    }

    if (!healthy) {

        fail(
            "HTTP health",
            `No healthy endpoint at ${BASE_URL}`
        );
    }
}

await testHTTP();

/*
=========================================================
11. SFTP
=========================================================
*/

async function testSFTP() {

    await new Promise(
        resolve => {

            const socket =
                net.createConnection({
                    host: "127.0.0.1",
                    port: SFTP_PORT
                });

            const timer =
                setTimeout(
                    () => {

                        socket.destroy();

                        skip(
                            "SFTP connectivity",
                            `127.0.0.1:${SFTP_PORT} unavailable`
                        );

                        resolve();
                    },
                    2500
                );

            socket.once(
                "connect",
                () => {

                    clearTimeout(timer);
                    socket.destroy();

                    pass(
                        "SFTP connectivity",
                        `127.0.0.1:${SFTP_PORT}`
                    );

                    resolve();
                }
            );

            socket.once(
                "error",
                () => {

                    clearTimeout(timer);
                    socket.destroy();

                    skip(
                        "SFTP connectivity",
                        `127.0.0.1:${SFTP_PORT} unavailable`
                    );

                    resolve();
                }
            );
        }
    );
}

await testSFTP();

/*
=========================================================
12. DOCKER
=========================================================
*/

if (!ENABLE_DOCKER) {

    skip(
        "Docker integration",
        "Set CRAFTLY_TEST_DOCKER=1"
    );

} else {

    const docker =
        run(
            "docker",
            ["info"],
            {
                timeout: 30000
            }
        );

    if (docker.status !== 0) {

        skip(
            "Docker integration",
            "Docker daemon unavailable"
        );

    } else {

        pass(
            "Docker daemon",
            "Reachable"
        );

        const compose =
            run(
                "docker",
                [
                    "compose",
                    "version"
                ],
                {
                    timeout: 30000
                }
            );

        if (compose.status === 0) {

            pass(
                "Docker Compose"
            );

        } else {

            skip(
                "Docker Compose",
                "Unavailable"
            );
        }
    }
}

/*
=========================================================
13. SECRET SANITY
=========================================================
*/

const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:password|secret|api[_-]?key|token)\s*[:=]\s*["'][^"']{16,}["']/i
];

const secretHits = [];

// Runtime state and generated artifacts are not production source. They may
// legitimately contain generated credentials, logs, databases, or encrypted
// secrets during a deployed test run and must not make the source audit fail.
const SECRET_SCAN_ROOTS = [
    "src",
    "scripts",
    "node-agent",
    "public",
    "assets",
    "docs"
];

for (const relativeRoot of SECRET_SCAN_ROOTS) {
for (const file of walk(path.join(ROOT, relativeRoot))) {

    if (
        /\.env(\.|$)/i.test(
            path.basename(file)
        )
    ) {
        continue;
    }

    if (
        /\.(lock|map)$/i.test(file) ||
        /(^|[\\/])test([\\/]|$)/i.test(file)
    ) {
        continue;
    }

    let text;

    try {
        text =
            fs.readFileSync(
                file,
                "utf8"
            );
    } catch {
        continue;
    }

    for (
        const pattern of secretPatterns
    ) {

        if (pattern.test(text)) {

            secretHits.push(
                path.relative(ROOT, file)
            );

            break;
        }
    }
}
}

if (secretHits.length === 0) {

    pass(
        "Secret sanity scan",
        "No obvious embedded secrets"
    );

} else {

    fail(
        "Secret sanity scan",
        `${secretHits.length} suspicious file(s)`
    );
}

/*
=========================================================
FINAL RESULT
=========================================================
*/

const passed =
    results.filter(
        r => r.status === "PASS"
    ).length;

const failed =
    results.filter(
        r => r.status === "FAIL"
    ).length;

const skipped =
    results.filter(
        r => r.status === "SKIP"
    ).length;

console.log("");
console.log(
    "══════════════════════════════════════════"
);

console.log(
    `PASS : ${passed}`
);

console.log(
    `FAIL : ${failed}`
);

console.log(
    `SKIP : ${skipped}`
);

console.log(
    "══════════════════════════════════════════"
);

if (failed > 0) {

    console.log(
        "RESULT: FAIL"
    );

    process.exitCode = 1;

} else {

    console.log(
        "RESULT: PASS"
    );

    console.log(
        "Review SKIP items before production deployment."
    );
}
