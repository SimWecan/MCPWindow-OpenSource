#!/bin/bash
# sign-release.sh — 为 MCPWindow 发布包附上 SimWecan 签名
# 用法: scripts/sign-release.sh [版本号，默认取 package.json]
# 流程: 重签 macOS App → 重打 ZIP / 重建并签名 DMG → 签名 Windows EXE
#       → 生成 SHA256SUMS 清单并用 SimWecan 私钥签名 → 刷新 version.json
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-$(node -p "require('./package.json').version")}"
REL="$ROOT/release"
SIGN_DIR="$ROOT/build/signing"
PASS_FILE="$ROOT/deploy/secrets/simwecan-signing.passphrase"
WORK=/tmp/mcpw-sign-release
CERT_PEM="$SIGN_DIR/SimWecan-cert.pem"
KEY_PEM="$SIGN_DIR/SimWecan-key.pem"

[ -f "$PASS_FILE" ] || { echo "缺少口令文件 $PASS_FILE"; exit 1; }
[ -f "$CERT_PEM" ] || { echo "缺少证书 $CERT_PEM，先运行证书生成流程"; exit 1; }

# 钥匙串中的 SimWecan 身份哈希（用于 codesign）
SIGN_HASH="$(security find-certificate -c SimWecan -Z 2>/dev/null | awk '/SHA-1/{print $3}')"
[ -n "$SIGN_HASH" ] || { echo "钥匙串中未找到 SimWecan 证书"; exit 1; }

command -v osslsigncode >/dev/null || { echo "请先安装 osslsigncode: brew install osslsigncode"; exit 1; }

echo "==> SimWecan 签名版本 $VERSION（身份 $SIGN_HASH）"

# ---------- 1. macOS：重签 App，重打 ZIP，重建并签名 DMG ----------
echo "==> [1/4] 签名 macOS 应用"
rm -rf "$WORK" && mkdir -p "$WORK"
unzip -q "$REL/MCPWindow-$VERSION-arm64.zip" -d "$WORK"
codesign --deep --force -s "$SIGN_HASH" --identifier com.simwecan.mcpwindow "$WORK/MCPWindow.app"
codesign --verify --deep --strict "$WORK/MCPWindow.app"
rm -f "$REL/MCPWindow-$VERSION-arm64.zip"
( cd "$WORK" && zip -qry "$REL/MCPWindow-$VERSION-arm64.zip" MCPWindow.app )
echo "    ZIP 已重打包（含签名应用）"

echo "==> [2/4] 重建并签名 DMG"
MNT="$WORK-dmg-mnt"; SRC="$WORK-dmg-src"
rm -rf "$MNT" "$SRC" && mkdir -p "$MNT" "$SRC"
hdiutil attach "$REL/MCPWindow-$VERSION-arm64.dmg" -nobrowse -quiet -mountpoint "$MNT"
cp -R "$WORK/MCPWindow.app" "$SRC/"
cp -R "$MNT/Applications" "$SRC/" 2>/dev/null || true
hdiutil detach "$MNT" -quiet
hdiutil create -volname MCPWindow -srcfolder "$SRC" -format UDZO -ov -quiet -o "$WORK/MCPWindow-$VERSION-arm64.dmg"
codesign -s "$SIGN_HASH" --identifier com.simwecan.mcpwindow-installer "$WORK/MCPWindow-$VERSION-arm64.dmg"
codesign --verify "$WORK/MCPWindow-$VERSION-arm64.dmg"
mv "$WORK/MCPWindow-$VERSION-arm64.dmg" "$REL/MCPWindow-$VERSION-arm64.dmg"
rm -rf "$SRC" "$MNT"
echo "    DMG 已重建并签名"

# ---------- 2. Windows：osslsigncode 签名两个 EXE ----------
echo "==> [3/4] 签名 Windows 安装包"
PLAIN_KEY="$WORK/simwecan-key-plain.pem"
if [ ! -f "$REL/MCPWindow-Setup-$VERSION.exe" ]; then
  echo "    未找到 Windows 安装包，跳过（本机不构建 Windows 产物）"
else
chmod 700 "$WORK"
/usr/bin/openssl rsa -in "$KEY_PEM" -passin "file:$PASS_FILE" -out "$PLAIN_KEY" 2>/dev/null
chmod 600 "$PLAIN_KEY"
sign_exe() {
  osslsigncode sign -certs "$CERT_PEM" -key "$PLAIN_KEY" \
    -n "MCPWindow" -i "https://software.terrafin.top" \
    -in "$REL/$1" -out "$WORK/$1" >/dev/null
  osslsigncode verify -CAfile "$CERT_PEM" -in "$WORK/$1" >/dev/null
  mv "$WORK/$1" "$REL/$1"
  echo "    $1 已签名"
}
sign_exe "MCPWindow-Setup-$VERSION.exe"
sign_exe "MCPWindow-Portable-$VERSION.exe"
fi
rm -f "$PLAIN_KEY"

# ---------- 3. 校验清单 + 公钥 + version.json ----------
echo "==> [4/4] 生成签名校验清单"
DLD="$ROOT/website/downloads"
SUM_FILES="release/MCPWindow-$VERSION-arm64.dmg release/MCPWindow-$VERSION-arm64.zip"
[ -f "$REL/MCPWindow-Setup-$VERSION.exe" ] && SUM_FILES="$SUM_FILES release/MCPWindow-Setup-$VERSION.exe release/MCPWindow-Portable-$VERSION.exe"
SUM_FILES="$SUM_FILES release/MCPWindow-Companion-$VERSION.zip"
[ -f "$ROOT/mobile/MCPWindow-mobile-$VERSION-debug.apk" ] && SUM_FILES="$SUM_FILES mobile/MCPWindow-mobile-$VERSION-debug.apk"
( cd "$ROOT" && shasum -a 256 $SUM_FILES ) > "$DLD/SHA256SUMS.txt"
/usr/bin/openssl rsa -in "$KEY_PEM" -passin "file:$PASS_FILE" -out "$PLAIN_KEY" 2>/dev/null
/usr/bin/openssl dgst -sha256 -sign "$PLAIN_KEY" -out "$DLD/SHA256SUMS.txt.SimWecan.sig" "$DLD/SHA256SUMS.txt"
rm -f "$PLAIN_KEY"
cp "$CERT_PEM" "$DLD/SimWecan-signing-cert.pem"
rm -rf "$WORK"

node scripts/generate-update-manifest.mjs
echo "==> 完成：全部发布包已附 SimWecan 签名"
