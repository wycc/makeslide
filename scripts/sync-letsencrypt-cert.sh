#!/usr/bin/env bash
#
# 從簽發 Let's Encrypt 憑證的那台機器把憑證同步過來，換掉 makeslide 目前用的自簽憑證。
#
# 為什麼是用 scp 抄，而不是在這台跑 ACME：`download.homescenario.com` 的 80 port 被路由器
# 轉到另一台機器（跑 Apache 的那台），HTTP-01 的驗證請求永遠落在那裡而不是這裡；DNS 託管在
# 戰國策（coowo）也沒有可用的 API 做 DNS-01。那台機器本來就有一份為同一個網域簽好的憑證，
# 抄過來是最省事、也最不會動到現有服務的做法。憑證綁的是主機名而不是 port，所以同一張憑證
# 給 7701 上的 makeslide 用完全有效。
#
# 這個腳本設計成可以放進 cron 反覆跑：沒變化就什麼都不做（不重啟服務），有變化才安裝並重啟。
#
# 用法：
#   scripts/sync-letsencrypt-cert.sh            # 有變更才安裝並重啟
#   scripts/sync-letsencrypt-cert.sh --dry-run  # 只比對，不寫入、不重啟
#   scripts/sync-letsencrypt-cert.sh --force    # 即使沒變更也重新安裝並重啟
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── 可用環境變數覆寫的設定 ─────────────────────────────────────────────────────
REMOTE="${CERT_SYNC_REMOTE:-root@download.homescenario.com}"
REMOTE_DIR="${CERT_SYNC_REMOTE_DIR:-/etc/letsencrypt/live/download.homescenario.com}"
SSH_KEY="${CERT_SYNC_SSH_KEY:-$HOME/.ssh/id_rsa}"
DEST_DIR="${CERT_SYNC_DEST_DIR:-$SCRIPT_DIR/.certs}"
# 刻意與 start.sh 預設的 localhost-*.pem 分開放：自簽那組留著不動，本機開發（連
# https://localhost 時憑證的 CN 才對得上）還是要用它。要讓服務改用這裡的憑證，
# 是在 .env 設 START_HTTPS_KEY_PATH／START_HTTPS_CERT_PATH 指過來。
DEST_CERT="$DEST_DIR/letsencrypt-cert.pem"
DEST_KEY="$DEST_DIR/letsencrypt-key.pem"
RESTART_CMD="${CERT_SYNC_RESTART_CMD:-}"

DRY_RUN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force)   FORCE=1 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知參數：$arg" >&2; exit 2 ;;
  esac
done

log() { printf '[cert-sync] %s\n' "$*"; }
err() { printf '[cert-sync] 錯誤：%s\n' "$*" >&2; }

if [[ ! -f "$SSH_KEY" ]]; then
  err "找不到 SSH 金鑰 $SSH_KEY。請先產生金鑰，並把公鑰加到 $REMOTE 的 authorized_keys。"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)

log "從 $REMOTE:$REMOTE_DIR 取得憑證…"
# fullchain 而不是 cert：少了中介憑證，多數用戶端（含 ChatGPT 的伺服器）會驗不過鏈。
if ! scp "${SSH_OPTS[@]}" \
      "$REMOTE:$REMOTE_DIR/fullchain.pem" "$REMOTE:$REMOTE_DIR/privkey.pem" \
      "$TMP_DIR/" 2>"$TMP_DIR/scp.err"; then
  err "取得憑證失敗：$(tr -d '\r' < "$TMP_DIR/scp.err" | tail -3)"
  exit 1
fi

# ── 先驗證再安裝 ──────────────────────────────────────────────────────────────
# 抄過來的東西壞掉卻照樣裝上去再重啟，服務會起不來；寧可在這裡停下，讓舊憑證繼續服務。
if ! openssl x509 -in "$TMP_DIR/fullchain.pem" -noout >/dev/null 2>&1; then
  err "取得的 fullchain.pem 不是有效的憑證，中止。"
  exit 1
fi
if ! openssl pkey -in "$TMP_DIR/privkey.pem" -noout >/dev/null 2>&1; then
  err "取得的 privkey.pem 不是有效的私鑰，中止。"
  exit 1
fi
# 憑證與私鑰必須是同一對，否則 TLS 交握會失敗。比對公鑰指紋是最直接的檢查。
cert_pub="$(openssl x509 -in "$TMP_DIR/fullchain.pem" -noout -pubkey 2>/dev/null | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256)"
key_pub="$(openssl pkey -in "$TMP_DIR/privkey.pem" -pubout -outform DER 2>/dev/null | openssl dgst -sha256)"
if [[ "$cert_pub" != "$key_pub" ]]; then
  err "憑證與私鑰不是同一對，中止。"
  exit 1
fi

subject="$(openssl x509 -in "$TMP_DIR/fullchain.pem" -noout -subject 2>/dev/null)"
not_after="$(openssl x509 -in "$TMP_DIR/fullchain.pem" -noout -enddate 2>/dev/null | cut -d= -f2)"
log "取得憑證：$subject"
log "有效期限至：$not_after"

if ! openssl x509 -in "$TMP_DIR/fullchain.pem" -noout -checkend 0 >/dev/null 2>&1; then
  err "取得的憑證已經過期，中止（那台機器的續期可能壞了）。"
  exit 1
fi

# ── 有變更才動 ────────────────────────────────────────────────────────────────
changed=1
if [[ -f "$DEST_CERT" && -f "$DEST_KEY" ]] \
   && cmp -s "$TMP_DIR/fullchain.pem" "$DEST_CERT" \
   && cmp -s "$TMP_DIR/privkey.pem" "$DEST_KEY"; then
  changed=0
fi

if [[ "$changed" -eq 0 && "$FORCE" -eq 0 ]]; then
  log "憑證沒有變化，不做任何事。"
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "--dry-run：偵測到需要更新，但不寫入也不重啟。"
  exit 0
fi

mkdir -p "$DEST_DIR"
install -m 644 "$TMP_DIR/fullchain.pem" "$DEST_CERT"
# 私鑰只給自己讀。抄過來之後擁有者是跑這個腳本的使用者，不再是遠端那台的 root。
install -m 600 "$TMP_DIR/privkey.pem" "$DEST_KEY"
log "已安裝到 $DEST_CERT 與 $DEST_KEY"

if [[ -n "$RESTART_CMD" ]]; then
  log "重啟 makeslide：$RESTART_CMD"
  if bash -c "$RESTART_CMD"; then
    log "重啟完成。"
  else
    err "重啟指令失敗——憑證已經換好，但服務可能還在用舊的，請手動確認。"
    exit 1
  fi
else
  log "沒有設定 CERT_SYNC_RESTART_CMD，憑證已更新但服務仍在用舊憑證；請自行重啟 makeslide。"
fi
