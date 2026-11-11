#!/bin/sh
# Builds the unsigned release .ipa for GitHub releases: build/release/Karting-Hub-v<version>.ipa,
# where <version> is MARKETING_VERSION in project.yml. Unsigned on purpose: a signed build would carry the
# signer's Apple ID and device IDs, and people sideloading it sign it with their own Apple ID.
set -eu
cd "$(dirname "$0")/.."

version=$(sed -n 's/^ *MARKETING_VERSION: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' project.yml)
[ -n "$version" ] || { echo "No MARKETING_VERSION in project.yml" >&2; exit 1; }
out=build/release
ipa="$out/Karting-Hub-v$version.ipa"

xcodegen generate --quiet
rm -rf "$out"
xcodebuild -project KartingHub.xcodeproj -scheme KartingHub -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath build -archivePath "$out/KartingHub.xcarchive" \
  archive CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" DEVELOPMENT_TEAM="" -quiet

mkdir -p "$out/Payload"
cp -R "$out/KartingHub.xcarchive/Products/Applications/KartingHub.app" "$out/Payload/"
(cd "$out" && zip -qry "$(basename "$ipa")" Payload)
rm -rf "$out/Payload"
echo "$ipa"
