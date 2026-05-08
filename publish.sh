#!/usr/bin/env bash
set -euo pipefail

current=$(node -p "require('./package.json').version")
echo "Current version: $current"

echo ""
echo "What kind of bump?"
echo "  1) patch"
echo "  2) minor"
echo "  3) major"
read -rp "Choice [1/2/3]: " choice

case "$choice" in
  1) bump="patch" ;;
  2) bump="minor" ;;
  3) bump="major" ;;
  *) echo "Invalid choice"; exit 1 ;;
esac

new_version=$(npm version "$bump" --no-git-tag-version)
echo "Bumped to $new_version"

git add package.json package-lock.json
git commit --signoff -m "$new_version"
git tag "$new_version"

echo ""
echo "Building..."
npm run build

echo ""
echo "Publishing..."
npm publish

echo ""
echo "Done! Don't forget to push: git push && git push --tags"
