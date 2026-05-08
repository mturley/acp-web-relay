#!/usr/bin/env bash
set -euo pipefail

current=$(node -p "require('./package.json').version")
echo "Current version: $current"

echo ""
echo "What kind of bump?"
echo "  0) none (retry current version)"
echo "  1) patch"
echo "  2) minor"
echo "  3) major"
read -rp "Choice [0/1/2/3]: " choice

if [ "$choice" = "0" ]; then
  echo "Retrying v$current"
else
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
  git tag -m "$new_version" "$new_version"
fi

echo ""
echo "Building..."
npm run build

echo ""
echo "Publishing..."
npm publish

echo ""
read -rp "Push commits and tags? [y/N]: " push_choice
if [[ "$push_choice" =~ ^[Yy]$ ]]; then
  git push && git push --tags
  echo "Pushed!"
else
  echo "Done! Don't forget to push: git push && git push --tags"
fi
