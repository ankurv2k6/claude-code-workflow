#!/usr/bin/env bash
# fleet: set up a Linux laptop as a lane worker.
# Ubuntu 24.04 or 26.04, Server or Desktop, x86_64. Idempotent: run it again after a failure or a rebuild.
#
# From the iMac (asks the laptop's password once, for sudo). It runs as a systemd job with no terminal, so
# keystrokes or a dropped SSH session cannot pause or kill it; follow it with `tail -f ~/fleet-setup/setup.log`.
#   scp ~/claudeworkflow/fleet/recipes/linux-worker.sh <worker>:fleet-setup/
#   ssh -t <worker> 'sudo systemd-run --unit=fleet-setup --collect --quiet \
#     -p StandardOutput=truncate:/home/<account>/fleet-setup/setup.log \
#     bash /home/<account>/fleet-setup/linux-worker.sh <worker> <account> "Your Name" you@example.com'
#
# Needs the iMac's fleet key in the account's ~/.ssh/authorized_keys first (ssh-copy-id), because it turns
# password logins off. Leaves for later: the Claude token (~/.config/fleet/env), the lane settings and the
# project clones, which `fleet add` / `fleet lane` push from the iMac. Workers never get GitHub or AWS credentials.
set -euo pipefail

WORKER=${1:?worker name, e.g. worker-01}
U=${2:?login account, e.g. dev}
GIT_NAME=${3:?git author name for lane commits}
GIT_EMAIL=${4:?git author email for lane commits}
NODE_MAJOR=22
PNPM_VERSION=10.18.0
PLAYWRIGHT_VERSION=1.63.0
BATTERY_LIMIT=80

[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
id "$U" >/dev/null 2>&1 || { echo "no such account: $U" >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo "x86_64 only" >&2; exit 1; }
# Read os-release in a subshell: sourcing it here would overwrite variables such as NAME.
OS_VERSION=$(. /etc/os-release && echo "$VERSION_ID")
OS_CODENAME=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
case "$OS_VERSION" in 24.04 | 26.04) ;; *) echo "Ubuntu 24.04 or 26.04 only (found $OS_VERSION)" >&2; exit 1 ;; esac
H=$(getent passwd "$U" | cut -d: -f6)
[ -s "$H/.ssh/authorized_keys" ] || { echo "$H/.ssh/authorized_keys is empty: run ssh-copy-id first" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
exec </dev/null # nothing below may wait on a keyboard

as_user() { runuser -u "$U" -- bash -lc "$1"; }
step() { printf '\n== %s\n' "$*"; }

step "Power: never sleep, ignore the lid"
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1
install -d /etc/systemd/logind.conf.d
cat >/etc/systemd/logind.conf.d/50-fleet.conf <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
EOF
BAT=/sys/class/power_supply/BAT0/charge_control_end_threshold
if [ -w "$BAT" ]; then
  cat >/etc/systemd/system/fleet-battery-limit.service <<EOF
[Unit]
Description=Hold the battery at ${BATTERY_LIMIT}% (the laptop stays plugged in)
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo ${BATTERY_LIMIT} > ${BAT}'

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now fleet-battery-limit.service >/dev/null 2>&1
  echo "battery held at $(cat "$BAT")%"
else
  echo "no battery charge limit on this laptop; set one in the BIOS if it has one"
fi

step "Name: $WORKER"
hostnamectl set-hostname "$WORKER"
if grep -q '^127\.0\.1\.1' /etc/hosts; then
  sed -i -E "s/^127\.0\.1\.1([[:space:]].*)?$/127.0.1.1\t$WORKER/" /etc/hosts
else
  printf '127.0.1.1\t%s\n' "$WORKER" >>/etc/hosts
fi

step "Package sources: switch off the installer's USB/CD entry"
# A USB or CD install leaves a source that fails every apt update once the stick is gone.
for f in /etc/apt/sources.list.d/*.sources; do
  [ -e "$f" ] || continue
  if grep -qE '^URIs:' "$f" && ! grep -E '^URIs:' "$f" | grep -vqE '(file:/+cdrom|cdrom:)'; then
    mv "$f" "$f.disabled" # apt skips *.disabled silently
    echo "switched off $f"
  fi
done
if [ -f /etc/apt/sources.list ]; then
  sed -i -E 's@^(deb[[:space:]].*(cdrom:|file:/+cdrom).*)$@# \1@' /etc/apt/sources.list
fi

step "Packages"
dpkg --configure -a # finishes any install an earlier, interrupted run left half done
apt-get update -q
apt-get install -y -q --no-install-recommends \
  ca-certificates curl git tmux jq build-essential python3 postgresql-client unzip zstd rsync \
  zram-tools earlyoom ripgrep fd-find tree python3-pip python3-venv socat imagemagick avahi-daemon xvfb fonts-liberation fonts-noto-core fonts-noto-color-emoji

step "Docker Engine (published ports bind to 127.0.0.1)"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${OS_CODENAME}
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update -q
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
install -d /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{
  "ip": "127.0.0.1",
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl enable docker.service containerd.service >/dev/null 2>&1
systemctl restart docker.service
usermod -aG docker "$U"

step "Memory: compressed swap in RAM (zram), earlyoom"
cat >/etc/default/zramswap <<'EOF'
ALGO=zstd
PERCENT=50
PRIORITY=100
EOF
systemctl restart zramswap.service
# earlyoom matches process names. Spare the databases, Docker, SSH and the agents; kill browsers and node first.
cat >/etc/default/earlyoom <<'EOF'
EARLYOOM_ARGS="-r 3600 -m 5 -s 10 --avoid ^(postgres|dockerd|containerd|sshd|claude|tmux)$ --prefer ^(node|chrome|headless_shell)$"
EOF
systemctl enable earlyoom.service >/dev/null 2>&1
systemctl restart earlyoom.service
cat >/etc/sysctl.d/60-fleet.conf <<'EOF'
fs.inotify.max_user_watches=524288
fs.inotify.max_user_instances=1024
EOF
sysctl --system >/dev/null

step "SSH: keys only; firewall"
cat >/etc/ssh/sshd_config.d/10-fleet.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
ClientAliveInterval 30
ClientAliveCountMax 3
EOF
sshd -t
systemctl reload ssh.service
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null
  ufw allow 5353/udp comment mDNS >/dev/null
fi
systemctl enable --now avahi-daemon.service >/dev/null 2>&1

step "Boot to text; the desktop stays installed (sudo systemctl isolate graphical.target brings it back)"
if [ "$(systemctl get-default)" = graphical.target ]; then systemctl set-default multi-user.target >/dev/null 2>&1; fi
for s in cups.service cups-browsed.service cups.socket cups.path; do systemctl disable --now "$s" >/dev/null 2>&1 || true; done

step "Toolchain for $U: mise, Node $NODE_MAJOR, pnpm $PNPM_VERSION, Claude Code"
install -d -o "$U" -g "$U" -m 700 "$H/.config/fleet"
cat >"$H/.config/fleet/profile.sh" <<'EOF'
# fleet: sourced by ~/.profile, so every login shell, and so every lane, gets the same tools.
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
export DISABLE_AUTOUPDATER=1 # the iMac decides the Claude Code version: fleet claude sync
[ -r "$HOME/.config/fleet/env" ] && . "$HOME/.config/fleet/env"
EOF
chown "$U:$U" "$H/.config/fleet/profile.sh"
if ! grep -q 'fleet/profile.sh' "$H/.profile" 2>/dev/null; then
  printf '\n# fleet\n[ -r "$HOME/.config/fleet/profile.sh" ] && . "$HOME/.config/fleet/profile.sh"\n' >>"$H/.profile"
  chown "$U:$U" "$H/.profile"
fi
as_user 'command -v mise >/dev/null || curl -fsSL https://mise.run | sh'
as_user "mise use -g node@$NODE_MAJOR pnpm@$PNPM_VERSION"
as_user 'command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash'
as_user "git config --global user.name $(printf %q "$GIT_NAME") && git config --global user.email $(printf %q "$GIT_EMAIL") && git config --global init.defaultBranch main"

step "Browser libraries and Chromium for Playwright $PLAYWRIGHT_VERSION (headless; xvfb-run for headed)"
NODE_BIN="$(as_user "mise where node@$NODE_MAJOR")/bin"
PATH="$NODE_BIN:$PATH" npx -y "playwright@$PLAYWRIGHT_VERSION" install-deps chromium
as_user "npx -y playwright@$PLAYWRIGHT_VERSION install chromium"

step "Checks"
fail=0
check() {
  if (eval "$2") >/dev/null 2>&1; then printf 'PASS  %s\n' "$1"; else printf 'FAIL  %s\n' "$1"; fail=1; fi
}
check "a login shell finds claude, node, pnpm, git and docker" \
  "as_user 'command -v claude && command -v node && command -v pnpm && command -v git && command -v docker'"
check "Docker runs a container" "docker run --rm hello-world"
check "published container ports bind to 127.0.0.1 only" \
  "docker run -d --rm --name fleet-portcheck -p 18080:8080 busybox sleep 20 && sleep 2 && ss -tlnH '( sport = :18080 )' | grep -q '127.0.0.1:18080' && ! ss -tlnH '( sport = :18080 )' | grep -qE '(0\.0\.0\.0|\[::\]):18080'; rc=\$?; docker rm -f fleet-portcheck; exit \$rc"
check "nothing but SSH listens on the network" \
  "[ -z \"\$(ss -tlnH | awk '{print \$4}' | grep -vE '^(127\.|\[::1\]|\[::ffff:127\.)' | grep -vE ':22$')\" ]"
check "SSH takes keys only" "sshd -T | grep -qx 'passwordauthentication no'"
check "the firewall lets SSH in" "! command -v ufw || ufw status | grep -q OpenSSH"
check "never sleeps" "[ \"\$(systemctl is-enabled suspend.target)\" = masked ]"
check "compressed swap is on" "swapon --show | grep -q zram"
check "earlyoom is running" "systemctl is-active --quiet earlyoom.service"
check "file watches raised" "[ \"\$(cat /proc/sys/fs/inotify/max_user_watches)\" -ge 524288 ]"
check "no AWS credentials or settings" "[ ! -e '$H/.aws' ] && ! as_user 'env | grep -q ^AWS_'"
check "no GitHub credentials" "[ ! -e '$H/.config/gh' ] && [ ! -e '$H/.git-credentials' ]"
check "at least 100 GB free" "[ \"\$(df --output=avail -BG / | tail -1 | tr -dc 0-9)\" -ge 100 ]"

if [ "$fail" -ne 0 ]; then
  echo
  echo "Some checks failed; nothing rebooted. Fix and run this script again."
  exit 1
fi
echo
echo "PASS: $WORKER is set up. Rebooting in 1 minute to start without the desktop (cancel: sudo shutdown -c)."
shutdown -r +1 >/dev/null 2>&1
