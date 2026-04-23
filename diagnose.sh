#!/bin/bash
# Comprehensive App Diagnostics Script
# Run this to check for common issues

echo "=========================================="
echo "POLYTERMINAL APP DIAGNOSTICS"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cd /Users/earn/.verdent/verdent-projects/how-connect-ssh/polyterminal

# Track issues
ERRORS=0
WARNINGS=0

echo "1. CHECKING PROJECT STRUCTURE"
echo "------------------------------"

# Check essential directories
for dir in src base44 base44/functions base44/entities; do
  if [ -d "$dir" ]; then
    echo -e "${GREEN}✓${NC} Directory exists: $dir"
  else
    echo -e "${RED}✗${NC} Missing directory: $dir"
    ((ERRORS++))
  fi
done

echo ""
echo "2. CHECKING ENTITY SCHEMAS"
echo "------------------------------"

# Check all entity JSON files
for f in base44/entities/*.jsonc; do
  if python3 -c "import json,sys; json.load(open('$f'))" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Valid JSON: $(basename $f)"
  else
    echo -e "${RED}✗${NC} Invalid JSON: $(basename $f)"
    ((ERRORS++))
  fi
done

echo ""
echo "3. CHECKING FUNCTION FILES"
echo "------------------------------"

# Count functions
FUNC_COUNT=$(find base44/functions -name "entry.ts" -type f | wc -l)
echo "Found $FUNC_COUNT function entry points"

# Check for syntax issues in functions
echo "Checking for common syntax issues..."

# Check for unmatched braces in function files
for f in base44/functions/*/entry.ts; do
  # Simple check for balanced braces
  OPEN=$(grep -o '{' "$f" | wc -l)
  CLOSE=$(grep -o '}' "$f" | wc -l)
  if [ "$OPEN" -eq "$CLOSE" ]; then
    : # Balanced
  else
    echo -e "${YELLOW}!${NC} Potential brace mismatch in $(basename $(dirname $f))"
    ((WARNINGS++))
  fi
done

echo ""
echo "4. CHECKING LIBRARY EXPORTS"
echo "------------------------------"

# Check that all lib files have default exports
for f in base44/functions/lib/*.ts; do
  if grep -q "export default" "$f" || grep -q "export {" "$f"; then
    echo -e "${GREEN}✓${NC} Exports found: $(basename $f)"
  else
    echo -e "${YELLOW}!${NC} No exports in: $(basename $f)"
    ((WARNINGS++))
  fi
done

echo ""
echo "5. CHECKING FRONTEND IMPORTS"
echo "------------------------------"

# Check for common frontend issues
if [ -f "src/App.jsx" ]; then
  echo -e "${GREEN}✓${NC} App.jsx exists"
else
  echo -e "${RED}✗${NC} App.jsx missing"
  ((ERRORS++))
fi

# Check for missing component imports
if grep -q "DropletHealthCheck" src/App.jsx; then
  if [ -f "src/pages/DropletHealthCheck.jsx" ]; then
    echo -e "${GREEN}✓${NC} DropletHealthCheck component exists"
  else
    echo -e "${RED}✗${NC} DropletHealthCheck imported but file missing"
    ((ERRORS++))
  fi
fi

echo ""
echo "6. CHECKING PACKAGE.JSON"
echo "------------------------------"

# Check for required scripts
for script in dev build; do
  if grep -q "\"$script\":" package.json; then
    echo -e "${GREEN}✓${NC} Script exists: $script"
  else
    echo -e "${YELLOW}!${NC} Script missing: $script"
    ((WARNINGS++))
  fi
done

echo ""
echo "7. CHECKING ENVIRONMENT VARIABLES"
echo "------------------------------"

echo "Required environment variables:"
echo "  - VITE_BASE44_APP_ID (for frontend)"
echo "  - VITE_BASE44_APP_BASE_URL (for frontend)"
echo "  - BYBIT_API_KEY (for trading)"
echo "  - BYBIT_API_SECRET (for trading)"
echo "  - TELEGRAM_BOT_TOKEN (for alerts)"
echo "  - TELEGRAM_CHAT_ID (for alerts)"
echo "  - ARB_ENCRYPTION_KEY (optional, for enhanced security)"

if [ -f ".env.local" ]; then
  echo -e "${GREEN}✓${NC} .env.local file exists"
else
  echo -e "${YELLOW}!${NC} .env.local file not found (create from .env.example)"
  ((WARNINGS++))
fi

echo ""
echo "8. CHECKING DATA FLOW"
echo "------------------------------"

# Check that all entities referenced in code exist
ENTITIES=$(grep -r "entities\." base44/functions --include="*.ts" | grep -o "entities\.[A-Za-z]*" | sort | uniq | cut -d'.' -f2)
for entity in $ENTITIES; do
  if [ -f "base44/entities/${entity}.jsonc" ]; then
    echo -e "${GREEN}✓${NC} Entity exists: $entity"
  else
    echo -e "${RED}✗${NC} Entity referenced but not defined: $entity"
    ((ERRORS++))
  fi
done

echo ""
echo "=========================================="
echo "DIAGNOSTICS SUMMARY"
echo "=========================================="
echo -e "Errors: ${RED}$ERRORS${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "${GREEN}✓ All checks passed!${NC}"
  exit 0
elif [ $ERRORS -eq 0 ]; then
  echo -e "${YELLOW}! App has warnings but should function${NC}"
  exit 0
else
  echo -e "${RED}✗ App has critical errors that need fixing${NC}"
  exit 1
fi
