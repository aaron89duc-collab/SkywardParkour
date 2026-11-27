#!/usr/bin/env bash
# Skyward Parkour – build a NEW APK and publish it, in one go (Ubuntu server).
#
#   sudo bash devtools/android/deploy-apk.sh             # VERSION_CODE + 1, build, sign, upload to R2
#   sudo bash devtools/android/deploy-apk.sh --pull      # git pull first (when this folder is a git clone)
#   sudo bash devtools/android/deploy-apk.sh --no-upload # build only (the APK stays in $SKY_HOME/out)
#   sudo bash devtools/android/deploy-apk.sh --upload-only  # upload the last APK built again (no build)
#
# Steps:
#   1. devtools/android/build-apk.sh --bump   (versionCode + 1; tools, signing key, logs: see that script)
#   2. upload to the R2 bucket of the download link (APK_URL in src/ui/UI.ts):
#        SkywardParkour-latest.apk          overwritten = what the website's "Get the Android app" button gives
#        SkywardParkour-<version>-<code>.apk kept, so an older build can be handed out again
#   3. check that the public link serves the new file (same size)
#
# Upload needs an R2 API token (once): Cloudflare dashboard → R2 → Manage R2 API Tokens → Create API token,
# permission "Object Read & Write", limited to the APK bucket. The first run writes $SKY_HOME/r2.properties
# (chmod 600, outside git) to fill in. Upload = S3 API signed with AWS SigV4 by python3 (built into Ubuntu).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ${EUID:-$(id -u)} -eq 0 ]]; then DEFAULT_HOME=/root/skyward-android; else DEFAULT_HOME="$HOME/skyward-android"; fi
SKY_HOME="${SKY_HOME:-$DEFAULT_HOME}"
OUT="$SKY_HOME/out"
R2_PROPS="$SKY_HOME/r2.properties"
PUBLIC_DEFAULT="https://pub-29e673b58966438a92f3f7d2d0c9ef6d.r2.dev"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }
usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

BUILD=1 UPLOAD=1 PULL=()
for a in "$@"; do
  case "$a" in
    --pull) PULL=(--pull) ;;
    --no-upload) UPLOAD=0 ;;
    --upload-only) BUILD=0 ;;
    -h|--help) usage ;;
    *) die "Unknown option: $a (see --help)" ;;
  esac
done
[[ ${EUID:-$(id -u)} -eq 0 ]] || die "Run with sudo (the build script installs tools and keeps its files in /root)."
command -v curl >/dev/null || die "curl is needed (apt install curl)"
command -v python3 >/dev/null || die "python3 is needed (apt install python3)"

prop() {
  local v
  v="$(grep -E "^[[:space:]]*$2[[:space:]]*=" "$1" 2>/dev/null | tail -n 1 | cut -d= -f2-)" || true
  v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}

# ---------------------------------------------------------------- R2 settings (first run: template)
r2_config() {
  if [[ ! -f "$R2_PROPS" ]]; then
    mkdir -p "$SKY_HOME"
    umask 077
    cat >"$R2_PROPS" <<EOF
# Skyward Parkour – where deploy-apk.sh uploads the APK (Cloudflare R2, S3 API). Not in git. chmod 600.
# Cloudflare dashboard → R2 → Manage R2 API Tokens → Create API token ("Object Read & Write", this bucket only).
# The page shows: Access Key ID, Secret Access Key and the S3 endpoint https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
# the bucket that has the public link below (R2 → the bucket → Settings → Public access)
R2_BUCKET=
# public link of that bucket (the APK_URL in src/ui/UI.ts without the file name)
R2_PUBLIC_URL=$PUBLIC_DEFAULT
EOF
    chmod 600 "$R2_PROPS"
    return 1
  fi
  R2_ACCOUNT_ID="$(prop "$R2_PROPS" R2_ACCOUNT_ID)"
  R2_ACCESS_KEY_ID="$(prop "$R2_PROPS" R2_ACCESS_KEY_ID)"
  R2_SECRET_ACCESS_KEY="$(prop "$R2_PROPS" R2_SECRET_ACCESS_KEY)"
  R2_BUCKET="$(prop "$R2_PROPS" R2_BUCKET)"
  R2_PUBLIC_URL="$(prop "$R2_PROPS" R2_PUBLIC_URL)"; R2_PUBLIC_URL="${R2_PUBLIC_URL%/}"
  [[ -n "$R2_ACCOUNT_ID" && -n "$R2_ACCESS_KEY_ID" && -n "$R2_SECRET_ACCESS_KEY" && -n "$R2_BUCKET" ]] || return 1
  chmod 600 "$R2_PROPS"
}

r2_missing() {
  warn "R2 upload settings missing: fill in $R2_PROPS"
  printf '    sudo nano %s\n' "$R2_PROPS"
  printf '  then upload this build without building again:\n    sudo bash devtools/android/deploy-apk.sh --upload-only\n'
}

# ---------------------------------------------------------------- upload (S3 PUT, AWS SigV4 in python3)
put() { # put <file> <object key> <cache-control>
  R2_ACCOUNT_ID="$R2_ACCOUNT_ID" R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  R2_BUCKET="$R2_BUCKET" python3 - "$1" "$2" "$3" <<'PY' || die "Upload of $2 failed. Check the token / bucket in $R2_PROPS."
import hashlib, hmac, os, sys, time, urllib.parse, urllib.request, urllib.error
path, key, cache = sys.argv[1:4]
acc, ak, sk, bucket = (os.environ[k] for k in ('R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'))
host = f'{acc}.r2.cloudflarestorage.com'
uri = '/' + urllib.parse.quote(f'{bucket}/{key}')
body = open(path, 'rb').read()
ph = hashlib.sha256(body).hexdigest()
ctype = 'application/vnd.android.package-archive'
for attempt in range(3):
    t = time.gmtime(); amz = time.strftime('%Y%m%dT%H%M%SZ', t); day = amz[:8]
    hdr = {'cache-control': cache, 'content-type': ctype, 'host': host, 'x-amz-content-sha256': ph, 'x-amz-date': amz}
    names = ';'.join(sorted(hdr))
    canon = '\n'.join(['PUT', uri, '', ''.join(f'{k}:{hdr[k]}\n' for k in sorted(hdr)), names, ph])
    scope = f'{day}/auto/s3/aws4_request'
    sts = '\n'.join(['AWS4-HMAC-SHA256', amz, scope, hashlib.sha256(canon.encode()).hexdigest()])
    k = ('AWS4' + sk).encode()
    for part in (day, 'auto', 's3', 'aws4_request'): k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(f'https://{host}{uri}', data=body, method='PUT')
    for h, v in hdr.items():
        if h != 'host': req.add_header(h, v)
    req.add_header('Authorization', f'AWS4-HMAC-SHA256 Credential={ak}/{scope}, SignedHeaders={names}, Signature={sig}')
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            if r.status == 200: print(f'    uploaded {key} ({len(body)} bytes)'); sys.exit(0)
    except urllib.error.HTTPError as e:
        print(f'    HTTP {e.code}: {e.read()[:300].decode(errors="replace")}', file=sys.stderr)
        if e.code in (400, 401, 403, 404): sys.exit(1)
    except Exception as e:
        print(f'    {e}', file=sys.stderr)
    time.sleep(3)
sys.exit(1)
PY
}

upload() {
  local latest="$OUT/SkywardParkour-latest.apk"
  [[ -f "$latest" ]] || die "No APK in $OUT – build first (run without --upload-only)."
  # the versioned file that is byte-identical to latest = the name of this build
  local named="" f
  for f in "$OUT"/SkywardParkour-*-*.apk; do [[ -f "$f" ]] && cmp -s "$f" "$latest" && { named="$f"; break; }; done
  log "Uploading to R2 (bucket $R2_BUCKET)"
  [[ -n "$named" ]] && put "$named" "$(basename "$named")" "public, max-age=31536000, immutable"
  put "$latest" "SkywardParkour-latest.apk" "no-cache"

  log "Checking the public link"
  local url="$R2_PUBLIC_URL/SkywardParkour-latest.apk" want got
  want="$(stat -c %s "$latest")"
  got="$(curl -sSIL -H 'Cache-Control: no-cache' "$url?v=$(date +%s)" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-length"{n=$2} END{print n}')"
  if [[ "$got" == "$want" ]]; then
    printf '    OK  %s  (%s bytes)\n' "$url" "$want"
  else
    warn "The public link answers $got bytes, the new APK has $want. If R2_PUBLIC_URL / R2_BUCKET are right, wait a minute (cache) and open the link again."
  fi
}

# ---------------------------------------------------------------- main
R2_OK=1
r2_config || R2_OK=0
if (( UPLOAD && !R2_OK && BUILD )); then
  warn "R2 upload settings are not filled in yet ($R2_PROPS): the APK will be built, upload skipped."
fi

if (( BUILD )); then
  log "Build (versionCode + 1)"
  bash "$SCRIPT_DIR/build-apk.sh" --bump "${PULL[@]}"
fi

if (( UPLOAD )); then
  if (( R2_OK )); then upload; else r2_missing; (( BUILD )) || exit 1; fi
fi

VC="$(prop "$SKY_HOME/app.properties" VERSION_CODE)"
log "Done – versionCode $VC"
printf '  Players get it from the website button (Android) or %s/SkywardParkour-latest.apk\n' "${R2_PUBLIC_URL:-$PUBLIC_DEFAULT}"
printf '  Installed apps update over it (same signing key, higher versionCode).\n'
