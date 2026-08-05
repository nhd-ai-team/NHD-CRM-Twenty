#!/bin/zsh
set -euo pipefail

ROOT="/Users/nhdailabcenter/Desktop/some agents/tools-claude/ai crm"
LABEL="com.nhd.crm.autostart"
SOURCE_PLIST="$ROOT/scripts/launchd/$LABEL.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$LABEL.plist"

mkdir -p "$TARGET_DIR"
cp "$SOURCE_PLIST" "$TARGET_PLIST"

/bin/launchctl bootout "gui/$(id -u)" "$TARGET_PLIST" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$(id -u)" "$TARGET_PLIST"
/bin/launchctl enable "gui/$(id -u)/$LABEL"

echo "已安装 CRM 开机自启动：$TARGET_PLIST"
echo "立即启动可执行：launchctl kickstart -k gui/$(id -u)/$LABEL"
echo "卸载命令：launchctl bootout gui/$(id -u) $TARGET_PLIST"
