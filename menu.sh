#!/usr/bin/env bash

set -u

REPO="https://github.com/y4sh-x/Craftly.git"
INSTALL_DIR="${CRAFTLY_DIR:-${CRAFTLY_DIR:-$HOME/Craftly}}"

SRC="${BASH_SOURCE[0]:-}"

# Standalone bootstrap mode: when menu.sh is executed directly from GitHub
# with `bash <(curl -fsSL ...)`, fetch the complete Craftly repository first.
case "$SRC" in
    /dev/fd/*|/proc/*|/dev/stdin)
        if true; then
            echo "Craftly"
            echo "Standalone installer detected."
            echo "Installing to: $INSTALL_DIR"
            echo

            command -v git >/dev/null 2>&1 || {
                echo "Error: Git is required."
                exit 1
            }

            if [ -d "$INSTALL_DIR/.git" ]; then
                echo "Updating existing Craftly..."
                git -C "$INSTALL_DIR" pull --ff-only || exit 1
            elif [ -e "$INSTALL_DIR" ]; then
                echo "Error: $INSTALL_DIR exists but is not a Craftly Git repository."
                echo "Set CRAFTLY_DIR to another location or remove the directory."
                exit 1
            else
                echo "Downloading Craftly..."
                git clone "$REPO" "$INSTALL_DIR" || exit 1
            fi

            exec bash "$INSTALL_DIR/menu.sh" "$@"
        fi
        ;;
esac

ROOT="$(cd "$(dirname "$SRC")" && pwd)"
cd "$ROOT" || exit 1
PID_FILE="${CRAFTLY_PID_FILE:-$ROOT/.craftly.pid}"
LOG_FILE="${CRAFTLY_LOG_FILE:-$ROOT/logs/craftly.log}"
C='\033[96m'; G='\033[92m'; Y='\033[93m'; R='\033[91m'
M='\033[95m'; B='\033[94m'; W='\033[97m'; D='\033[90m'; X='\033[0m'

pause(){ echo; read -r -p "Press Enter to continue..."; }
ok(){ echo -e "${G}✓ $*${X}"; }
warn(){ echo -e "${Y}⚠ $*${X}"; }
fail(){ echo -e "${R}✗ $*${X}"; }
has(){ command -v "$1" >/dev/null 2>&1; }

is_running(){
    [ -s "$PID_FILE" ] || return 1
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    [[ "$pid" =~ ^[0-9]+$ ]] || { rm -f "$PID_FILE"; return 1; }
    if kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    rm -f "$PID_FILE"
    return 1
}

version(){
    if [ -f package.json ] && has node; then
        node -e 'try{console.log(require("./package.json").version||"unknown")}catch(e){console.log("unknown")}' 2>/dev/null
    else
        echo "unknown"
    fi
}

pkg(){
    if [ -f pnpm-lock.yaml ] && has pnpm; then
        echo pnpm
    elif [ -f package-lock.json ] && has npm; then
        echo npm
    elif has pnpm; then
        echo pnpm
    elif has npm; then
        echo npm
    else
        echo none
    fi
}

pm(){
    case "$(pkg)" in
        pnpm) pnpm "$@" ;;
        npm) npm "$@" ;;
        *) fail "npm/pnpm not found."; return 1 ;;
    esac
}

run(){
    echo -e "${C}▶ $1${X}"
    shift
    "$@"
    local s=$?
    [ "$s" -eq 0 ] && ok "Done" || fail "Failed ($s)"
    return "$s"
}

header(){
    if [ -t 1 ] && [ -n "${TERM:-}" ] && [ "${TERM}" != dumb ] && has clear; then clear; fi
    echo -e "${C}${W}"
    cat <<'EOF'
╔══════════════════════════════════════════════════════════════╗
║                       CRAFTLY                              ║
║             Minecraft Server Management Console             ║
╚══════════════════════════════════════════════════════════════╝
EOF
    echo -e "${X}${D}Version:${X} ${W}$(version)${X}"
    echo
}

section(){
    echo -e "${C}${W}── $* ─────────────────────────────────────────────${X}"
}

# ───────────────────────── INSTALL ──────────────────────────────

install(){
    header
    section "INSTALL / SETUP"

    has node && ok "Node.js $(node -v)" || warn "Node.js missing"
    has git && ok "Git available" || warn "Git missing"
    has docker && ok "Docker available" || warn "Docker unavailable (server lifecycle will remain unavailable)"
    has corepack && ok "Corepack available" || warn "Corepack unavailable"

    if ! has node; then fail "Node.js 24+ is required."; pause; return 1; fi
    node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || { fail "Node.js 24+ is required."; pause; return 1; }
    if ! has git; then fail "Git is required."; pause; return 1; fi
    if [ ! -f package.json ]; then fail "package.json not found."; pause; return 1; fi

    # Dependency installation must never look frozen with no diagnostics.
    # Corepack can lazily download the pinned pnpm version, so bootstrap it
    # explicitly and force CI/append-only output. A bounded timeout prevents
    # a dead registry/network from leaving the installer hanging forever.
    install_deps(){
        local timeout_cmd=""
        has timeout && timeout_cmd="timeout --foreground 15m"

        if has corepack; then
            COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack enable >/dev/null 2>&1 || true
            if [ -f pnpm-lock.yaml ]; then
                echo -e "${C}→ Preparing pinned pnpm package manager...${X}"
                COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --version || return 1
                echo -e "${C}→ Downloading/installing Node.js dependencies (live output):${X}"
                CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 $timeout_cmd corepack pnpm install --frozen-lockfile --reporter=append-only
            else
                echo -e "${C}→ Installing Node.js dependencies with npm (live output):${X}"
                CI=1 $timeout_cmd npm install --no-audit --fund=false
            fi
        elif [ -f pnpm-lock.yaml ] && has pnpm; then
            echo -e "${C}→ Installing Node.js dependencies with pnpm (live output):${X}"
            CI=1 $timeout_cmd pnpm install --frozen-lockfile --reporter=append-only
        elif has npm; then
            echo -e "${C}→ Installing Node.js dependencies with npm (live output):${X}"
            CI=1 $timeout_cmd npm install --no-audit --fund=false
        else
            fail "No supported package manager found."
            return 1
        fi
    }

    if ! run "Installing dependencies" install_deps; then
        fail "Dependency installation failed or timed out."
        echo -e "${Y}Check network access to the npm registry, then rerun Install / Setup.${X}"
        pause
        return 1
    fi

    if [ ! -f .env ] && [ -f .env.example ]; then
        cp .env.example .env
        chmod 600 .env 2>/dev/null || true
        ok ".env created"
    fi

    if grep -q '"db:migrate"' package.json 2>/dev/null; then
        run "Database migration" pm run db:migrate || { fail "Database migration failed."; pause; return 1; }
    fi

    if grep -q '"build"' package.json 2>/dev/null; then
        run "Production build" pm run build || { pause; return 1; }
    fi

    mkdir -p logs
    if start_background; then
        ok "Craftly panel started."
        ok "Web panel: http://127.0.0.1:${PANEL_PORT:-6060}"
        ok "SFTP: port ${SFTP_PORT:-2022}"
    else
        warn "Dependencies/build are ready, but the panel could not be started automatically."
    fi
    pause
}

start_background(){
    if is_running; then
        ok "Craftly is already running (PID $(cat "$PID_FILE"))."
        return 0
    fi
    mkdir -p "$(dirname "$LOG_FILE")"
    : >"$LOG_FILE" 2>/dev/null || true
    if has pm2; then
        if pm2 describe craftly >/dev/null 2>&1; then
            pm2 restart craftly >/dev/null && pm2 save >/dev/null 2>&1 || return 1
            return 0
        fi
        if grep -q '"start"' package.json 2>/dev/null; then
            pm2 start npm --name craftly -- start >/dev/null && pm2 save >/dev/null 2>&1 || return 1
            return 0
        fi
    fi
    case "$(pkg)" in
        pnpm) nohup pnpm run start >>"$LOG_FILE" 2>&1 & ;;
        npm) nohup npm run start >>"$LOG_FILE" 2>&1 & ;;
        *) return 1 ;;
    esac
    local pid=$!
    echo "$pid" >"$PID_FILE"

    # Do not report success merely because the launcher process exists. Wait for
    # the actual HTTP listener, and fail fast if the application exits.
    local port="${PANEL_PORT:-6060}"
    local i
    for i in $(seq 1 20); do
        if curl -fsS --max-time 1 "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
            return 0
        fi
        if ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$PID_FILE"
            return 1
        fi
        sleep 1
    done
    return 1
}


update(){
    header
    section "UPDATE"

    if [ -d .git ] && has git; then
        run "Updating repository" git pull --ff-only || {
            pause
            return 1
        }
    else
        warn "Git repository unavailable."
    fi

    if [ "$(pkg)" = "pnpm" ]; then
        pnpm install --frozen-lockfile
    elif [ "$(pkg)" = "npm" ]; then
        npm ci || npm install
    fi

    grep -q '"build"' package.json 2>/dev/null &&
        pm run build

    if has pm2 && pm2 describe craftly >/dev/null 2>&1; then
        pm2 restart craftly
        pm2 save
    fi

    ok "Update completed."
    pause
}

# ───────────────────────── PANEL ───────────────────────────────

start(){
    header
    section "START CRAFTLY"
    if ! [ -f package.json ]; then fail "package.json not found. Run Install / Setup first."; pause; return 1; fi
    if start_background; then ok "Craftly is running."; else fail "Craftly failed to start. Check $LOG_FILE"; fi
    pause
}

stop(){
    header
    section "STOP CRAFTLY"
    if has pm2 && pm2 describe craftly >/dev/null 2>&1; then
        pm2 stop craftly >/dev/null 2>&1 || true
        pm2 save >/dev/null 2>&1 || true
        ok "Craftly stopped."
    elif is_running; then
        kill "$(cat "$PID_FILE")" 2>/dev/null || true
        rm -f "$PID_FILE"
        ok "Craftly stopped."
    else
        warn "Craftly is not running."
    fi
    pause
}

restart(){
    header
    section "RESTART CRAFTLY"
    if has pm2 && pm2 describe craftly >/dev/null 2>&1; then
        pm2 restart craftly >/dev/null && pm2 save >/dev/null 2>&1 || { fail "Restart failed."; pause; return 1; }
    else
        if is_running; then kill "$(cat "$PID_FILE")" 2>/dev/null || true; rm -f "$PID_FILE"; sleep 1; fi
        start_background || { fail "Restart failed. Check $LOG_FILE"; pause; return 1; }
    fi
    ok "Craftly restarted."
    pause
}

logs(){
    header
    section "LOGS"
    if has pm2 && pm2 describe craftly >/dev/null 2>&1; then
        pm2 logs craftly
    elif [ -f "$LOG_FILE" ]; then
        tail -n 200 -f "$LOG_FILE"
    else
        warn "No Craftly logs found."
        pause
    fi
}

# ───────────────────────── DOCKER ──────────────────────────────

docker_menu(){
    while true; do
        header
        section "DOCKER"

        echo "1) Docker status"
        echo "2) Container list"
        echo "3) Container logs"
        echo "4) Compose up"
        echo "5) Compose down"
        echo "6) Compose restart"
        echo "7) Resource usage"
        echo "8) Cleanup unused resources"
        echo "0) Back"
        echo

        read -r -p "❯ Select: " n

        case "$n" in
            1)
                has docker && docker info ||
                    fail "Docker unavailable."
                pause
                ;;
            2)
                has docker && docker ps -a ||
                    fail "Docker unavailable."
                pause
                ;;
            3)
                if has docker; then
                    read -r -p "Container: " c
                    docker logs --tail 200 "$c"
                fi
                pause
                ;;
            4)
                has docker && docker compose up -d ||
                    fail "Docker Compose unavailable."
                pause
                ;;
            5)
                has docker && docker compose down ||
                    fail "Docker Compose unavailable."
                pause
                ;;
            6)
                has docker && docker compose restart ||
                    fail "Docker Compose unavailable."
                pause
                ;;
            7)
                has docker && docker stats --no-stream ||
                    fail "Docker unavailable."
                pause
                ;;
            8)
                has docker && docker system prune ||
                    fail "Docker unavailable."
                pause
                ;;
            0) return ;;
            *) warn "Invalid option."; sleep 1 ;;
        esac
    done
}

# ───────────────────────── CLOUDFLARE ──────────────────────────

cloudflare_menu(){
    while true; do
        header
        section "CLOUDFLARE"

        echo "1) Install cloudflared"
        echo "2) Cloudflare login"
        echo "3) List tunnels"
        echo "4) Create tunnel"
        echo "5) Tunnel info"
        echo "6) Run tunnel"
        echo "7) Stop tunnel"
        echo "8) Route DNS"
        echo "9) Uninstall cloudflared"
        echo "0) Back"
        echo

        read -r -p "❯ Select: " n

        case "$n" in
            1)
                if has cloudflared; then
                    ok "cloudflared already installed."
                elif has brew; then
                    brew install cloudflared
                elif has snap; then
                    sudo snap install cloudflared
                else
                    warn "Install cloudflared using your OS package manager."
                fi
                pause
                ;;
            2)
                if has cloudflared; then
                    cloudflared tunnel login
                else
                    fail "cloudflared is not installed."
                fi
                pause
                ;;
            3)
                if has cloudflared; then cloudflared tunnel list; else fail "cloudflared is not installed."; fi
                pause
                ;;
            4)
                if has cloudflared; then
                    read -r -p "Tunnel name: " name
                    [ -n "$name" ] && cloudflared tunnel create "$name"
                else
                    fail "cloudflared is not installed."
                fi
                pause
                ;;
            5)
                if has cloudflared; then
                    read -r -p "Tunnel name/ID: " id
                    cloudflared tunnel info "$id"
                else
                    fail "cloudflared is not installed."
                fi
                pause
                ;;
            6)
                if has cloudflared; then
                    read -r -p "Tunnel name/ID: " id
                    cloudflared tunnel run "$id"
                else
                    fail "cloudflared is not installed."
                fi
                ;;
            7)
                pkill -f "cloudflared tunnel" 2>/dev/null || true
                ok "Tunnel processes stopped."
                pause
                ;;
            8)
                if has cloudflared; then
                    read -r -p "Tunnel name/ID: " id
                    read -r -p "Hostname: " host
                    cloudflared tunnel route dns "$id" "$host"
                else
                    fail "cloudflared is not installed."
                fi
                pause
                ;;
            9)
                if has brew; then
                    brew uninstall cloudflared
                elif has snap; then
                    sudo snap remove cloudflared
                else
                    warn "Remove cloudflared using your package manager."
                fi
                pause
                ;;
            0) return ;;
            *) warn "Invalid option."; sleep 1 ;;
        esac
    done
}

# ───────────────────────── NETWORK ─────────────────────────────

network_menu(){
    while true; do
        header
        section "NETWORK"

        echo "1) Local IP"
        echo "2) Public IP"
        echo "3) Listening ports"
        echo "4) DNS lookup"
        echo "5) Internet test"
        echo "6) HTTP/HTTPS test"
        echo "0) Back"
        echo

        read -r -p "❯ Select: " n

        case "$n" in
            1)
                hostname -I 2>/dev/null || ip addr
                pause
                ;;
            2)
                if has curl; then
                    curl -fsS https://api.ipify.org
                    echo
                else
                    fail "curl unavailable."
                fi
                pause
                ;;
            3)
                if has ss; then
                    ss -lntup
                elif has netstat; then
                    netstat -lntup
                else
                    fail "No socket utility found."
                fi
                pause
                ;;
            4)
                read -r -p "Hostname: " h
                getent hosts "$h" 2>/dev/null ||
                    nslookup "$h" 2>/dev/null ||
                    fail "DNS lookup failed."
                pause
                ;;
            5)
                has curl &&
                    curl -fsSI --max-time 5 https://example.com ||
                    fail "Connectivity test failed."
                pause
                ;;
            6)
                read -r -p "URL: " u
                has curl &&
                    curl -I -L --max-time 10 "$u" ||
                    fail "HTTP test failed."
                pause
                ;;
            0) return ;;
            *) warn "Invalid option."; sleep 1 ;;
        esac
    done
}

# ───────────────────────── TESTING ─────────────────────────────

tests(){
    header
    section "AUTOMATED TESTS"

    failed=0
    skipped=0

    check(){
        local label="$1"
        shift
        if "$@" >/dev/null 2>&1; then ok "$label"; else fail "$label"; failed=$((failed+1)); fi
    }
    skip_check(){
        warn "SKIP $1${2:+ — $2}"
        skipped=$((skipped+1))
    }

    check "Node.js" has node
    check "Package manager" test "$(pkg)" != none
    check "package.json" test -f package.json
    check "Git" has git
    check "menu.sh syntax" bash -n menu.sh

    [ -f .env ] && ok ".env present" || skip_check ".env" "created automatically by Install / Setup"

    if [ "$(pkg)" != none ] && [ -d node_modules ]; then
        if has node && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
            grep -q '"build"' package.json 2>/dev/null && check "Build" pm run build
            grep -q '"lint"' package.json 2>/dev/null && check "Lint" pm run lint
            grep -q '"typecheck"' package.json 2>/dev/null && check "Typecheck" pm run typecheck
            grep -q '"test"' package.json 2>/dev/null && check "Tests" pm run test
            grep -q '"test:smoke"' package.json 2>/dev/null && check "Smoke tests" pm run test:smoke
        else
            skip_check "Build/Lint/Typecheck/Tests" "Node.js 24+ is required"
        fi
    else
        skip_check "Build/Lint/Typecheck/Tests" "install dependencies first"
    fi

    [ -f test/test.sh ] && check "test/test.sh syntax" bash -n test/test.sh || skip_check "test/test.sh" "file missing"

    echo
    if [ "$failed" -eq 0 ]; then
        ok "No detected blocker. $skipped environment check(s) skipped."
    else
        fail "$failed check(s) failed; $skipped skipped."
    fi

    pause
}

# ───────────────────────── DATABASE ────────────────────────────

database_menu(){
    header
    section "DATABASE"

    echo "1) Run migrations"
    echo "2) Database connection check"
    echo "3) Show database configuration"
    echo "0) Back"
    echo

    read -r -p "❯ Select: " n

    case "$n" in
        1)
            if grep -q '"db:migrate"' package.json 2>/dev/null; then
                pm run db:migrate
            else
                warn "No migration command detected."
            fi
            pause
            ;;
        2)
            if [ -n "${DATABASE_URL:-}" ]; then
                ok "DATABASE_URL is available."
            else
                warn "DATABASE_URL is not exported."
            fi
            pause
            ;;
        3)
            if [ -f .env ]; then
                echo ".env exists."
                echo "Secrets are intentionally not displayed."
            else
                warn ".env not found."
            fi
            pause
            ;;
        0) return ;;
        *) warn "Invalid option."; sleep 1 ;;
    esac
}

# ───────────────────────── SECURITY ────────────────────────────

security(){
    header
    section "SECURITY AUDIT"

    problems=0

    if [ -f .env ]; then
        warn ".env exists locally."
    else
        ok ".env not present."
    fi

    if [ -f .gitignore ] &&
       grep -qxF '.env' .gitignore; then
        ok ".env is ignored by Git."
    else
        warn ".env is not explicitly ignored."
        problems=$((problems+1))
    fi

    if [ -d .git ] &&
       git status --porcelain 2>/dev/null |
       grep -E '(^| )\.env($| )' >/dev/null; then
        fail ".env appears in Git changes."
        problems=$((problems+1))
    else
        ok "No .env in current Git changes."
    fi

    if has ss; then
        echo
        echo "Listening ports:"
        ss -lnt 2>/dev/null
    fi

    echo

    [ "$problems" -eq 0 ] &&
        ok "Basic security checks passed." ||
        warn "$problems security warning(s)."

    pause
}

# ───────────────────────── MONITORING ──────────────────────────

monitor(){
    header
    section "SYSTEM MONITOR"

    echo "Hostname: $(hostname)"
    echo "Uptime:   $(uptime -p 2>/dev/null || uptime)"
    echo

    has free && free -h
    echo
    has df && df -h "$ROOT"

    if has docker; then
        echo
        echo "Docker:"
        docker stats --no-stream 2>/dev/null || true
    fi

    if has pm2; then
        echo
        echo "PM2:"
        pm2 status 2>/dev/null || true
    fi

    pause
}

# ───────────────────────── BACKUP ──────────────────────────────

backup(){
    header
    section "BACKUP"

    mkdir -p backups

    stamp="$(date +%Y%m%d-%H%M%S)"
    file="backups/craftly-$stamp.tar.gz"

    tar \
        --exclude='./.git' \
        --exclude='./node_modules' \
        --exclude='./backups' \
        -czf "$file" . 2>/dev/null

    if [ "$?" -eq 0 ]; then
        ok "Backup created: $file"
    else
        fail "Backup failed."
    fi

    pause
}

# ───────────────────────── MAINTENANCE ─────────────────────────

maintenance(){
    while true; do
        header
        section "MAINTENANCE"

        echo "1) Reinstall dependencies"
        echo "2) Clear build cache"
        echo "3) Fix menu.sh permissions"
        echo "4) Git status"
        echo "5) Verify Git repository"
        echo "6) Generate diagnostics"
        echo "0) Back"
        echo

        read -r -p "❯ Select: " n

        case "$n" in
            1)
                install_deps=""
                case "$(pkg)" in
                    pnpm) pnpm install ;;
                    npm) npm install ;;
                    *) fail "No package manager."; ;;
                esac
                pause
                ;;
            2)
                rm -rf .next dist build .cache 2>/dev/null || true
                ok "Common build caches cleared."
                pause
                ;;
            3)
                chmod +x menu.sh
                ok "menu.sh is executable."
                pause
                ;;
            4)
                has git &&
                    git status --short ||
                    fail "Git unavailable."
                pause
                ;;
            5)
                has git &&
                    git fsck --no-progress ||
                    fail "Git unavailable."
                pause
                ;;
            6)
                file="craftly-diagnostics-$(date +%Y%m%d-%H%M%S).txt"

                {
                    echo "Craftly Diagnostics"
                    echo "Date: $(date)"
                    echo "Version: $(version)"
                    echo "OS: $(uname -a)"
                    echo "Node: $(node -v 2>/dev/null || echo missing)"
                    echo "npm: $(npm -v 2>/dev/null || echo missing)"
                    echo "pnpm: $(pnpm -v 2>/dev/null || echo missing)"
                    echo "Docker: $(docker --version 2>/dev/null || echo missing)"
                    echo "Git: $(git --version 2>/dev/null || echo missing)"
                    echo "Package manager: $(pkg)"
                } | tee "$file"

                ok "Diagnostics saved to $file"
                pause
                ;;
            0) return ;;
            *) warn "Invalid option."; sleep 1 ;;
        esac
    done
}

# ───────────────────────── MAIN ────────────────────────────────

main(){
    while true; do
        header

        echo -e "${C}${W}"
        echo "╭────────────────────────────────────────────────────╮"
        echo "│  1) 🚀 Installation & Updates                     │"
        echo "│  2) 🎮 Panel Control                              │"
        echo "│  3) 🐳 Docker                                     │"
        echo "│  4) ☁️  Cloudflare                                 │"
        echo "│  5) 🌐 Network                                    │"
        echo "│  6) 🧪 Testing & Diagnostics                      │"
        echo "│  7) 🗄️  Database                                   │"
        echo "│  8) 🛡️  Security Audit                            │"
        echo "│  9) 📊 Monitoring                                 │"
        echo "│ 10) 💾 Backup                                     │"
        echo "│ 11) 🔧 Maintenance                                │"
        echo "│ 12) 📜 Logs                                       │"
        echo "│  0) 🚪 Exit                                       │"
        echo "╰────────────────────────────────────────────────────╯"
        echo -e "${X}"

        read -r -p "❯ Select: " n

        case "$n" in
            1) install ;;
            2)
                while true; do
                    header
                    section "PANEL CONTROL"
                    echo "1) Start"
                    echo "2) Stop"
                    echo "3) Restart"
                    echo "4) Logs"
                    echo "0) Back"
                    echo

                    read -r -p "❯ Select: " x

                    case "$x" in
                        1) start ;;
                        2) stop ;;
                        3) restart ;;
                        4) logs ;;
                        0) break ;;
                        *) warn "Invalid option."; sleep 1 ;;
                    esac
                done
                ;;
            3) docker_menu ;;
            4) cloudflare_menu ;;
            5) network_menu ;;
            6) tests ;;
            7) database_menu ;;
            8) security ;;
            9) monitor ;;
            10) backup ;;
            11) maintenance ;;
            12) logs ;;
            0)
                [ -t 1 ] && [ -n "${TERM:-}" ] && [ "${TERM}" != dumb ] && has clear && clear || true
                exit 0
                ;;
            *)
                warn "Invalid option."
                sleep 1
                ;;
        esac
    done
}

case "${1:-}" in
    install|setup) install ;;
    start) start ;;
    stop) stop ;;
    restart) restart ;;
    update|upgrade) update ;;
    test|qa) tests ;;
    status|health) monitor ;;
    docker) docker_menu ;;
    cloudflare|cf) cloudflare_menu ;;
    network) network_menu ;;
    database|db) database_menu ;;
    security|audit) security ;;
    backup) backup ;;
    logs) logs ;;
    maintenance|repair) maintenance ;;
    *) main ;;
esac
