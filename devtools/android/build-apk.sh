#!/usr/bin/env bash
# Skyward Parkour – build the Android app (APK to install, AAB for Google Play) on an Ubuntu server.
#
#   sudo bash devtools/android/build-apk.sh            # build + sign the code in this folder
#   sudo bash devtools/android/build-apk.sh --bump     # the same, VERSION_CODE + 1 first (each new APK you hand out)
#   sudo bash devtools/android/build-apk.sh --pull     # git pull first (only when this folder is a git clone)
#   sudo bash devtools/android/build-apk.sh --setup    # only install / check the tools
#
# What belongs to this server stays outside the source folder, in $SKY_HOME (default /root/skyward-android):
#   app.properties       VERSION_CODE, VERSION_NAME, VITE_* build settings      (created on the first run)
#   keystore.properties  signing passwords, chmod 600                           (created on the first run)
#   skyward-release.jks  signing key – BACK IT UP outside the server             (created on the first run)
#   out/                 SkywardParkour-<version>-<code>.apk / .aab, SkywardParkour-latest.apk
#   logs/                one log per build
# The source folder can be an unzipped copy or a git clone; it is copied to $SKY_HOME/build and built there
# (node_modules, dist, .git and old Android build output are left out), so the folder itself is never changed.
# Tools installed on the first run: OpenJDK 21, Node.js 22, Android SDK in /opt/android-sdk.
# Needs Ubuntu 22.04 / 24.04 on x86-64, ~4 GB RAM (+swap) and ~6 GB disk.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [[ ${EUID:-$(id -u)} -eq 0 ]]; then DEFAULT_HOME=/root/skyward-android; else DEFAULT_HOME="$HOME/skyward-android"; fi
SKY_HOME="${SKY_HOME:-$DEFAULT_HOME}"
ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
CMDLINE_TOOLS_ZIP="commandlinetools-linux-13114758_latest.zip"
SDK_PACKAGES=("platform-tools" "platforms;android-36" "build-tools;35.0.0")
CONTENT_URL_DEFAULT="https://pub-7ae23beecc234f6db27b50f0de832e9e.r2.dev"
BUILD="$SKY_HOME/build"
OUT="$SKY_HOME/out"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }
need_root() { [[ ${EUID:-$(id -u)} -eq 0 ]] || die "$1 – run the script with sudo."; }

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

MODE=build PULL=0 BUMP=0
for a in "$@"; do
  case "$a" in
    --setup) MODE=setup ;;
    --pull) PULL=1 ;;
    --no-pull) PULL=0 ;;
    --bump) BUMP=1 ;;
    -h|--help) usage ;;
    *) die "Unknown option: $a (see --help)" ;;
  esac
done
[[ -f "$REPO/capacitor.config.json" && -d "$REPO/android" ]] || die "Run this from the skyward-parkour repository (devtools/android/build-apk.sh)."

# ---------------------------------------------------------------- properties files (KEY=VALUE, never executed)
prop() {
  local v
  v="$(grep -E "^[[:space:]]*$2[[:space:]]*=" "$1" 2>/dev/null | tail -n 1 | cut -d= -f2-)" || true
  v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}
set_prop() { sed -i -E "s|^([[:space:]]*$2[[:space:]]*=).*|\1$3|" "$1"; }

# ---------------------------------------------------------------- tools
java_major() { "$1/bin/javac" -version 2>&1 | sed -nE 's/^javac ([0-9]+).*/\1/p' | head -n 1; }
find_java21() {
  local d m
  for d in "${JAVA_HOME:-}" /usr/lib/jvm/java-21-openjdk-* /usr/lib/jvm/temurin-21-*; do
    [[ -n "$d" && -x "$d/bin/javac" ]] || continue
    m="$(java_major "$d")"
    if [[ "$m" =~ ^[0-9]+$ ]] && (( m >= 21 )); then JAVA_HOME="$d"; return 0; fi
  done
  return 1
}
node_ok() { command -v node >/dev/null 2>&1 && (( $(node -p 'process.versions.node.split(".")[0]') >= 22 )); }
sdkmanager_bin() { printf '%s' "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"; }
sdk_ready() {
  [[ -x "$(sdkmanager_bin)" && -d "$ANDROID_HOME/platform-tools" && -d "$ANDROID_HOME/platforms/android-36" \
     && -d "$ANDROID_HOME/build-tools/35.0.0" ]]
}

setup_tools() {
  local arch; arch="$(uname -m)"
  [[ "$arch" == x86_64 ]] || warn "CPU is $arch: Google's Android build tools (aapt2) only run on x86-64 Linux – the build will most likely fail."
  command -v apt-get >/dev/null 2>&1 || die "This script expects Ubuntu / Debian (apt-get)."

  local pkgs=() c
  find_java21 || pkgs+=(openjdk-21-jdk-headless)
  for c in curl unzip git; do command -v "$c" >/dev/null 2>&1 || pkgs+=("$c"); done
  if (( ${#pkgs[@]} )); then
    need_root "Installing ${pkgs[*]}"
    log "Installing ${pkgs[*]}"
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates "${pkgs[@]}"
  fi
  find_java21 || die "OpenJDK 21 not found (apt-get install openjdk-21-jdk-headless)."
  export JAVA_HOME

  if ! node_ok; then
    need_root "Installing Node.js 22"
    log "Installing Node.js 22 (NodeSource)"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - || die "Could not set up the Node.js 22 package source."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
    node_ok || die "Node.js 22+ is needed (found: $(node -v 2>/dev/null || echo none))."
  fi

  if ! sdk_ready; then
    [[ -w "$(dirname "$ANDROID_HOME")" || -w "$ANDROID_HOME" ]] || need_root "Installing the Android SDK into $ANDROID_HOME"
    if [[ ! -x "$(sdkmanager_bin)" ]]; then
      log "Installing the Android command-line tools → $ANDROID_HOME"
      local tmp; tmp="$(mktemp -d)"
      curl -fL --retry 3 -o "$tmp/clt.zip" "https://dl.google.com/android/repository/$CMDLINE_TOOLS_ZIP" \
        || die "Could not download the Android tools from dl.google.com (does the server have internet access?)"
      unzip -q "$tmp/clt.zip" -d "$tmp"
      mkdir -p "$ANDROID_HOME/cmdline-tools"
      rm -rf "$ANDROID_HOME/cmdline-tools/latest"
      mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
      rm -rf "$tmp"
    fi
    log "Android SDK packages: ${SDK_PACKAGES[*]}"
    yes 2>/dev/null | "$(sdkmanager_bin)" --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 || true
    "$(sdkmanager_bin)" --sdk_root="$ANDROID_HOME" "${SDK_PACKAGES[@]}" >"$SKY_HOME/logs/sdkmanager.log" 2>&1 \
      || { tail -n 30 "$SKY_HOME/logs/sdkmanager.log"; die "sdkmanager failed (log: $SKY_HOME/logs/sdkmanager.log)"; }
  fi
  # Gradle may add SDK pieces on its own; that only works if the licences are accepted
  yes 2>/dev/null | "$(sdkmanager_bin)" --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 || true

  printf '    Java  %s\n    Node  %s\n    SDK   %s\n' "$JAVA_HOME" "$(node -v)" "$ANDROID_HOME"
}

check_memory() {
  local mem swap
  mem=$(awk '/^MemTotal/{print int($2/1024)}' /proc/meminfo)
  swap=$(awk '/^SwapTotal/{print int($2/1024)}' /proc/meminfo)
  if (( mem + swap < 3500 )); then
    warn "Only ${mem} MB RAM + ${swap} MB swap: Gradle may be killed (out of memory). Add swap once, e.g.:"
    printf '      sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile\n' >&2
    printf "      echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab\n" >&2
  fi
}

# ---------------------------------------------------------------- server files (outside git)
user_home() { [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]] && getent passwd "$SUDO_USER" | cut -d: -f6; }

init_home() {
  mkdir -p "$SKY_HOME" "$OUT" "$SKY_HOME/logs"
  chmod 700 "$SKY_HOME"
  if [[ ! -f "$SKY_HOME/app.properties" ]]; then
    cat >"$SKY_HOME/app.properties" <<EOF
# Skyward Parkour – Android build settings of this server (not in git).
# Each APK / AAB you hand out needs a higher VERSION_CODE than the one before it (or build with --bump).
VERSION_CODE=1
# version players see; empty = "version" in package.json
VERSION_NAME=
# where Map 002+ are downloaded from (same as the website)
VITE_CONTENT_URL=$CONTENT_URL_DEFAULT
# online leaderboard API: the same value as VITE_API_URL on Vercel (empty = leaderboard off)
VITE_API_URL=
# optional, the same value as on Vercel (empty = built-in admin password)
VITE_ADMIN_HASH=
EOF
    log "Created $SKY_HOME/app.properties (fill in VITE_API_URL to get the online leaderboard)"
  fi
}

init_key() {
  local ks="$SKY_HOME/skyward-release.jks" kp="$SKY_HOME/keystore.properties"
  if [[ ! -f "$kp" ]]; then
    [[ -f "$ks" ]] && die "$ks exists but keystore.properties is missing – write it (storeFile, storePassword, keyAlias, keyPassword)."
    log "Creating the signing key (first run)"
    local pw; pw="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-28)"
    "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$ks" -storetype PKCS12 -alias skyward -keyalg RSA -keysize 2048 \
      -validity 10000 -dname "CN=Skyward Parkour, O=Skyward Parkour, C=VN" -storepass "$pw" -keypass "$pw" >/dev/null 2>&1 \
      || die "keytool could not create the key"
    ( umask 077; printf 'storeFile=skyward-release.jks\nstorePassword=%s\nkeyAlias=skyward\nkeyPassword=%s\n' "$pw" "$pw" >"$kp" )
    chmod 600 "$ks" "$kp"
    NEW_KEY=1
  fi
  KS_FILE="$(prop "$kp" storeFile)"; [[ "$KS_FILE" == /* ]] || KS_FILE="$SKY_HOME/$KS_FILE"
  KS_PASS="$(prop "$kp" storePassword)"; KEY_ALIAS="$(prop "$kp" keyAlias)"; KEY_PASS="$(prop "$kp" keyPassword)"
  [[ -f "$KS_FILE" ]] || die "Signing key $KS_FILE not found – restore it from your backup (a new key cannot update the installed app)."
  "$JAVA_HOME/bin/keytool" -list -keystore "$KS_FILE" -storepass "$KS_PASS" -alias "$KEY_ALIAS" >/dev/null 2>&1 \
    || die "keystore.properties does not open $KS_FILE (wrong password or alias)."
}

# a copy of a NEW key for the user who ran sudo, so it can be downloaded without root login
backup_key_for_user() {
  local h; h="$(user_home)" || true
  [[ -n "$h" ]] || return 0
  KEY_COPY="$h/skyward-android-key-backup"
  mkdir -p "$KEY_COPY"; cp "$SKY_HOME/keystore.properties" "$KS_FILE" "$KEY_COPY/"
  chown -R "$SUDO_USER": "$KEY_COPY"; chmod 700 "$KEY_COPY"; chmod 600 "$KEY_COPY"/*
}
remind_key() {
  warn "NEW signing key: $KS_FILE (+ keystore.properties). Every update of the app must be signed with it,"
  warn "otherwise phones refuse to install the update. Keep a copy OUTSIDE this server and never in git."
  if [[ -n "${KEY_COPY:-}" ]]; then
    warn "Download the copy:  scp -r ${SUDO_USER}@<server>:~/skyward-android-key-backup ."
    warn "then delete it on the server:  rm -r ~/skyward-android-key-backup"
  else
    warn "Download it:  scp root@<server>:$SKY_HOME/{skyward-release.jks,keystore.properties} ."
  fi
}

# ---------------------------------------------------------------- build
prepare_source() {
  if (( PULL )); then
    [[ -d "$REPO/.git" ]] || die "--pull: $REPO is not a git clone (upload the new zip instead)."
    log "git pull"
    if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]]; then
      sudo -u "$SUDO_USER" -H git -C "$REPO" pull --ff-only || die "git pull failed – fix it, or build without --pull."
    else
      git -c safe.directory="$REPO" -C "$REPO" pull --ff-only || die "git pull failed – fix it, or build without --pull."
    fi
  fi
  log "Copying the code $REPO → $BUILD"
  rm -rf "$BUILD"; mkdir -p "$BUILD"
  tar -C "$REPO" --exclude=node_modules --exclude=./dist --exclude=./content-dist --exclude=./.git \
    --exclude=./server/.wrangler --exclude=./devtools/out --exclude=./android/app/build --exclude=./android/build \
    --exclude=./android/.gradle --exclude=./android/app/src/main/assets/public \
    --exclude=./android/capacitor-cordova-android-plugins -cf - . | tar -x -C "$BUILD"
  # a zip made on Windows may carry CRLF line endings: Linux scripts need LF
  sed -i 's/\r$//' "$BUILD/android/gradlew"
  if [[ -d "$REPO/.git" ]] && command -v git >/dev/null 2>&1; then
    COMMIT="git $(git -c safe.directory="$REPO" -C "$REPO" log -1 --format='%h %s' 2>/dev/null || echo '?')"
  else
    COMMIT="folder $REPO ($(date -r "$REPO/package.json" '+package.json %F %H:%M'))"
  fi
  printf '    %s\n' "$COMMIT"
}

build_web() {
  cd "$BUILD"
  unset NODE_ENV
  local k v
  for k in VITE_CONTENT_URL VITE_API_URL VITE_ADMIN_HASH; do
    v="$(prop "$SKY_HOME/app.properties" "$k")"
    if [[ -n "$v" ]]; then export "$k=$v"; else unset "$k"; fi
  done
  [[ -n "${VITE_API_URL:-}" ]] || warn "VITE_API_URL is empty in app.properties: the app is built without the online leaderboard."
  log "npm ci"
  npm ci --no-audit --no-fund --loglevel=error
  log "npm run build"
  npm run build
  log "npx cap sync android"
  npx cap sync android
}

build_android() {
  cd "$BUILD/android"
  chmod +x gradlew
  export JAVA_HOME ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"
  log "Gradle: assembleRelease + bundleRelease  (versionCode $VC, versionName $VN – the first build downloads ~1 GB)"
  ANDROID_KEYSTORE_FILE="$KS_FILE" ANDROID_KEYSTORE_PASSWORD="$KS_PASS" ANDROID_KEY_ALIAS="$KEY_ALIAS" \
  ANDROID_KEY_PASSWORD="$KEY_PASS" \
    ./gradlew --no-daemon --console=plain assembleRelease bundleRelease -PversionCode="$VC" -PversionName="$VN"
}

collect() {
  local apk="$BUILD/android/app/build/outputs/apk/release/app-release.apk"
  local aab="$BUILD/android/app/build/outputs/bundle/release/app-release.aab"
  [[ -f "$apk" ]] || die "APK not found ($apk)"
  local name="SkywardParkour-$VN-$VC"
  cp "$apk" "$OUT/$name.apk"; cp "$apk" "$OUT/SkywardParkour-latest.apk"
  [[ -f "$aab" ]] && cp "$aab" "$OUT/$name.aab"
  local bt; bt="$(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | sort -V | tail -n 1)"
  if [[ -x "$bt/apksigner" ]]; then
    "$bt/apksigner" verify "$OUT/$name.apk" || die "apksigner: the APK signature is not valid"
  fi
  local h; h="$(user_home)" || true
  if [[ -n "$h" ]]; then
    mkdir -p "$h/skyward-apk"; cp "$OUT/$name.apk" "$OUT/SkywardParkour-latest.apk" "$h/skyward-apk/"
    chown -R "$SUDO_USER": "$h/skyward-apk"
  fi
  log "Done – $COMMIT"
  ls -lh "$OUT/$name".* | awk '{print "    " $5 "  " $9}'
  if [[ -n "$h" ]]; then
    printf '\n  Download the APK to your PC:\n    scp %s@<server>:~/skyward-apk/SkywardParkour-latest.apk .\n' "$SUDO_USER"
  else
    printf '\n  Download the APK to your PC:\n    scp root@<server>:%s/SkywardParkour-latest.apk .\n' "$OUT"
  fi
  printf '  Next build that you hand out: VERSION_CODE > %s (or run with --bump).\n' "$VC"
}

# ---------------------------------------------------------------- main
# lowest CPU / disk priority: the server may be running other services (FivePitch) while this builds
renice -n 19 -p $$ >/dev/null 2>&1 || true
ionice -c 3 -p $$ >/dev/null 2>&1 || true
init_home
LOG="$SKY_HOME/logs/build-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
printf 'Skyward Parkour Android build · %s · log %s\n' "$(date '+%F %T')" "$LOG"

# SKY_TEST_NO_SETUP / SKY_TEST_NO_GRADLE: only for testing this script on a machine without the Android SDK
if [[ -n "${SKY_TEST_NO_SETUP:-}" ]]; then find_java21 || die "JDK 21 needed"; export JAVA_HOME; else setup_tools; fi
check_memory
[[ "$MODE" == setup ]] && { log "Tools ready."; exit 0; }

NEW_KEY=0
init_key
(( NEW_KEY )) && backup_key_for_user
if (( BUMP )); then
  VC_OLD="$(prop "$SKY_HOME/app.properties" VERSION_CODE)"
  [[ "$VC_OLD" =~ ^[0-9]+$ ]] || die "VERSION_CODE in app.properties is not a number"
  set_prop "$SKY_HOME/app.properties" VERSION_CODE "$((VC_OLD + 1))"
fi
VC="$(prop "$SKY_HOME/app.properties" VERSION_CODE)"
[[ "$VC" =~ ^[0-9]+$ ]] && (( VC >= 1 )) || die "VERSION_CODE in $SKY_HOME/app.properties must be a whole number ≥ 1"

prepare_source
VN="$(prop "$SKY_HOME/app.properties" VERSION_NAME)"
[[ -n "$VN" ]] || VN="$(node -p "require('$BUILD/package.json').version")"
build_web
if [[ -n "${SKY_TEST_NO_GRADLE:-}" ]]; then log "SKY_TEST_NO_GRADLE: stopping before Gradle"; exit 0; fi
build_android
collect
(( NEW_KEY )) && remind_key
exit 0
