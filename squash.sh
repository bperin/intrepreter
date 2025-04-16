#!/bin/bash

# The commit hash to keep (squash everything after this)
TARGET_COMMIT="8c83adb43fec484b2c0fe0308c3c3ffdf2760f8f"

# Verify the commit exists
if ! git cat-file -e "$TARGET_COMMIT"; then
  echo "Error: Commit $TARGET_COMMIT not found!"
  exit 1
fi

# Get the current branch
CURRENT_BRANCH=$(git symbolic-ref --short HEAD)
echo "Working on branch: $CURRENT_BRANCH"

# Create a temporary rebase script
TEMPFILE=$(mktemp)
echo "Creating temporary rebase script..."

# Generate the rebase todo file
git log --format=%H "$TARGET_COMMIT"..HEAD | tac > "$TEMPFILE.commits"

# Create the rebase-todo file
{
  echo "pick $TARGET_COMMIT"
  while read -r commit; do
    echo "fixup $commit"
  done < "$TEMPFILE.commits"
} > "$TEMPFILE"

echo "Generated rebase plan:"
cat "$TEMPFILE"
echo ""

# Ask for confirmation
read -p "Proceed with squashing all commits after $TARGET_COMMIT? [y/N] " confirm
if [[ "$confirm" != [Yy]* ]]; then
  echo "Operation cancelled."
  rm "$TEMPFILE" "$TEMPFILE.commits"
  exit 0
fi

# Execute the rebase
echo "Executing rebase..."
GIT_SEQUENCE_EDITOR="cat $TEMPFILE >" git rebase -i "$TARGET_COMMIT^"

# Clean up
rm "$TEMPFILE" "$TEMPFILE.commits"

echo "Squash complete! All commits after $TARGET_COMMIT have been combined into it."
echo "You may need to force push with: git push --force-with-lease" 