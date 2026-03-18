#!/usr/bin/env node
/**
 * Antigravity skill — talk to AI models via Antigravity's gRPC API.
 * Uses gagaclaw/core.js for streaming, polling, and response handling.
 * Auth is injected from local process discovery + disk state.
 */

const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const GAGA = path.join(__dirname, 'lib', 'gagaclaw');
const CACHE_PATH = path.join(process.env.HOME || '', '.antigravity-skill.json');
const TLS = new https.Agent({ rejectUnauthorized: false });

// Ensure gagaclaw config exists (needed by core.js on require)
const GAGA_CONFIG = path.join(GAGA, 'gagaclaw.json');
if (!fs.existsSync(GAGA_CONFIG)) {
    fs.writeFileSync(GAGA_CONFIG, JSON.stringify({
        app: { name: 'Antigravity' },
        defaultInstance: 'cli',
        defaults: { cdpPorts: [9222], cdpHost: '127.0.0.1' },
        instances: { cli: { defaults: { cdpPorts: [9222] } } },
    }, null, 2));
}

// Save real args, suppress gagaclaw's process.argv parsing, then restore
const _realArgs = process.argv.slice();
process.argv = ['node', 'antigravity', '--config=' + GAGA_CONFIG, '--instance=cli'];
const { createExtraSession } = require(path.join(GAGA, 'core'));
process.argv = _realArgs;

// ── Auth ─────────────────────────────────────────────────────────────────────

function readApiKey() {
    const dbPath = path.join(process.env.HOME || '', 'Library/Application Support/Antigravity/User/globalStorage/state.vscdb');
    if (!fs.existsSync(dbPath)) return null;
    return fs.readFileSync(dbPath).toString('latin1').match(/"apiKey"\s*:\s*"(ya29\.[^"]+)"/)?.[1] || null;
}

function buildAuth(csrf, port) {
    const apiKey = readApiKey();
    if (!apiKey) throw new Error('No apiKey found. Is Antigravity logged in?');
    return {
        metadata: { apiKey, ideName: 'antigravity', extensionName: 'antigravity', locale: 'en', ideVersion: '1.0.0' },
        csrfToken: csrf,
        lsPort: String(port),
        cdpHost: '127.0.0.1',
    };
}

// ── Discovery ────────────────────────────────────────────────────────────────

function grpcProbe(port, csrf) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: '127.0.0.1', port, method: 'POST',
            path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
            headers: { 'Content-Type': 'application/json', 'connect-protocol-version': '1', 'x-codeium-csrf-token': csrf, 'Content-Length': 2 },
            agent: TLS,
        }, res => {
            let buf = '';
            res.on('data', c => buf += c);
            res.on('end', () => { try { const d = JSON.parse(buf); d?.userStatus ? resolve(port) : reject(); } catch { reject(); } });
        });
        req.on('error', reject);
        req.setTimeout(2000, () => { req.destroy(); reject(); });
        req.write('{}');
        req.end();
    });
}

function discoverWorkspaces() {
    return execSync('ps aux', { encoding: 'utf8' }).split('\n')
        .filter(l => l.includes('language_server_macos_arm'))
        .map(line => {
            const csrf = line.match(/csrf_token\s+([0-9a-f-]+)/)?.[1];
            const wsId = line.match(/workspace_id\s+(\S+)/)?.[1];
            const pid = line.trim().split(/\s+/)[1];
            if (!csrf) return null;
            return { csrf, pid, workspaceId: wsId || null,
                name: wsId ? wsId.replace(/^file_Users_\w+_/, '').replace(/_/g, '/') : 'agent-manager',
                grpcPort: null };
        }).filter(Boolean);
}

async function findGrpcPort(entry) {
    const cmd = entry.pid
        ? `lsof -i -P -n -p ${entry.pid} 2>/dev/null | grep LISTEN | awk '{print $9}' | cut -d: -f2 | sort -un`
        : `lsof -i -P -n 2>/dev/null | grep language_ | grep LISTEN | awk '{print $9}' | cut -d: -f2 | sort -un`;
    const ports = execSync(cmd, { encoding: 'utf8' }).trim().split('\n').map(Number).filter(Boolean);
    const results = await Promise.allSettled(ports.map(p => grpcProbe(p, entry.csrf)));
    entry.grpcPort = results.find(r => r.status === 'fulfilled')?.value || null;
    return entry;
}

function loadCache() {
    try { const { _ts, workspaces } = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        if (Date.now() - _ts < 3_600_000) return workspaces; } catch {} return null;
}
function saveCache(workspaces) {
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ _ts: Date.now(), workspaces }, null, 2));
}

async function resolveWorkspace(name) {
    const cached = loadCache();
    if (cached) {
        const entry = name
            ? cached.find(e => e.name.includes(name) || e.workspaceId?.includes(name))
            : cached.find(e => e.workspaceId);
        if (entry?.grpcPort) {
            try { await grpcProbe(entry.grpcPort, entry.csrf); return entry; } catch {}
        }
    }
    let all = discoverWorkspaces();
    if (!all.length) {
        try { execSync('pgrep -x Electron', { stdio: 'pipe' }); } catch {
            process.stderr.write('Antigravity not running. Launching...\n');
            execSync('open -a Antigravity', { shell: true });
            for (let i = 0; i < 20; i++) { execSync('sleep 1'); all = discoverWorkspaces(); if (all.length) break; }
        }
    }
    const entry = (name
        ? all.find(e => e.name.includes(name) || e.workspaceId?.includes(name))
        : all.find(e => e.workspaceId)) || all[0];
    if (!entry) throw new Error('No Antigravity language servers found.');
    await findGrpcPort(entry);
    if (!entry.grpcPort) throw new Error(`No gRPC port for workspace: ${entry.name}`);
    const merged = (cached || []).filter(e => e.name !== entry.name);
    merged.push(entry);
    saveCache(merged);
    return entry;
}

// ── Session helper ───────────────────────────────────────────────────────────

async function runPrompt(ws, prompt, { model, agentic = false } = {}) {
    const auth = buildAuth(ws.csrf, ws.grpcPort);
    if (model) {
        auth.cascadeConfig = { plannerConfig: {
            requestedModel: { model },
            conversational: { plannerMode: 'CONVERSATIONAL_PLANNER_MODE_DEFAULT', agenticMode: agentic },
        }};
    }
    const session = await createExtraSession(auth);
    if (agentic) session.setAgentic(true);

    return new Promise((resolve, reject) => {
        let response = '';
        session.on('error', (e) => {
            const msg = String(e);
            if (msg.includes('exhausted') || msg.includes('quota') || msg.includes('capacity')) {
                reject(new Error(`Model quota reached. Try another model with --model. Run 'models' to see available quota.`));
            } else {
                reject(new Error(msg));
            }
        });
        session.on('response', (delta, full) => { response = full; });
        session.on('turnDone', () => {
            if (!response) {
                reject(new Error('Empty response — model may have hit quota. Try another model with --model.'));
            } else {
                resolve(response);
            }
        });
        session.send(prompt).catch(reject);
        setTimeout(() => {
            if (response) resolve(response);
            else reject(new Error('Timeout — no response received.'));
        }, agentic ? 300_000 : 120_000);
    });
}

// ── Models ───────────────────────────────────────────────────────────────────

function labelToKey(label) {
    return label.toLowerCase()
        .replace(/\(thinking\)/g, '').replace(/\(medium\)/g, '')
        .replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function getModels(ws) {
    const auth = buildAuth(ws.csrf, ws.grpcPort);
    const data = await new Promise((res, rej) => {
        const d = '{}';
        const req = https.request({
            hostname: '127.0.0.1', port: ws.grpcPort, method: 'POST',
            path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
            headers: { 'Content-Type': 'application/json', 'connect-protocol-version': '1',
                'x-codeium-csrf-token': ws.csrf, 'Content-Length': 2 },
            agent: TLS,
        }, resp => { let b = ''; resp.on('data', c => b += c); resp.on('end', () => { try { res(JSON.parse(b)); } catch { rej(); } }); });
        req.on('error', rej); req.write(d); req.end();
    });
    const models = {};
    for (const m of data?.userStatus?.cascadeModelConfigData?.clientModelConfigs || []) {
        models[labelToKey(m.label)] = {
            id: m.modelOrAlias?.model, label: m.label,
            quota: m.quotaInfo?.remainingFraction ?? null,
            reset: m.quotaInfo?.resetTime ?? null,
        };
    }
    return { models, user: data?.userStatus };
}

function pickModel(models, key) {
    if (key && models[key]?.id) return models[key].id;
    return Object.values(models).find(m => m.quota > 0)?.id || Object.values(models)[0]?.id;
}

function fmtQuota(m) {
    return m.quota != null ? `${Math.round(m.quota * 100)}%` : '  0%';
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseFlags(args) {
    let model = null, workspace = null, agentic = false;
    const rest = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--model') { model = args[++i]; continue; }
        if (args[i] === '--workspace') { workspace = args[++i]; continue; }
        if (args[i] === '--agentic') { agentic = true; continue; }
        rest.push(args[i]);
    }
    return { model, workspace, agentic, prompt: rest.join(' ') };
}

const COMMANDS = {
    async ask(args) {
        const { model, workspace, agentic, prompt } = parseFlags(args);
        if (!prompt) { console.error('No prompt'); process.exit(1); }
        const ws = await resolveWorkspace(workspace);
        const { models } = await getModels(ws);
        console.log(await runPrompt(ws, prompt, { model: pickModel(models, model), agentic }));
    },

    async challenge(args) {
        const { model, workspace, prompt } = parseFlags(args);
        if (!prompt) { console.error('No text to challenge'); process.exit(1); }
        const wrapped = `Critically review this response. Point out errors, missing nuances, or improvements. Be concise.\n\n---\n${prompt}\n---`;
        const ws = await resolveWorkspace(workspace);
        const { models } = await getModels(ws);
        console.log(await runPrompt(ws, wrapped, { model: pickModel(models, model) }));
    },

    async models(args) {
        const { workspace } = parseFlags(args);
        const ws = await resolveWorkspace(workspace);
        const { models } = await getModels(ws);
        for (const [key, m] of Object.entries(models))
            console.log(`${key.padEnd(20)} ${m.label.padEnd(30)} ${fmtQuota(m).padStart(4)} remaining  ${m.reset ? new Date(m.reset).toLocaleString() : ''}`);
    },

    async workspaces() {
        for (const e of discoverWorkspaces())
            console.log(`${e.name.padEnd(40)} csrf=${e.csrf.substring(0, 8)}...`);
    },

    async init() {
        console.log('Discovering Antigravity workspaces...');
        const all = discoverWorkspaces();
        if (!all.length) { console.error('No language servers found. Is Antigravity running?'); process.exit(1); }
        await Promise.all(all.map(e => findGrpcPort(e)));
        for (const e of all) console.log(`  ${e.name.padEnd(35)} ${e.grpcPort ? `✓ port ${e.grpcPort}` : '✗ no gRPC port'}`);
        const valid = all.filter(e => e.grpcPort);
        if (!valid.length) { console.error('No accessible gRPC ports.'); process.exit(1); }
        saveCache(valid);
        try {
            const { models, user } = await getModels(valid[0]);
            if (user) console.log(`\nLogged in as: ${user.name} (${user.email})\nPlan: ${user.planStatus?.planInfo?.planName || 'unknown'}`);
            console.log('\nModels:');
            for (const [key, m] of Object.entries(models))
                console.log(`  ${key.padEnd(20)} ${m.label.padEnd(30)} ${fmtQuota(m).padStart(4)} remaining`);
        } catch {}
        console.log('\n✓ Ready!');
    },
};

const HELP = `Antigravity — talk to AI models via Antigravity's gRPC API

Commands:
  init                                  Discover workspaces, cache tokens
  ask [--model X] [--workspace X] "p"   Send prompt (auto-selects best model)
  challenge [--model X] "text"          Ask for critical review
  models                                List models + quotas
  workspaces                            List active workspaces

Flags:
  --model <key>       Model key from 'models' command
  --workspace <name>  Target workspace
  --agentic           Enable tool access (file read, etc.)`;

async function main() {
    const [cmd, ...args] = process.argv.slice(2);
    if (!cmd || cmd === '--help' || cmd === '-h') { console.log(HELP); return; }
    if (!COMMANDS[cmd]) { console.error(`Unknown command: ${cmd}\n`); console.log(HELP); process.exit(1); }
    await COMMANDS[cmd](args);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
