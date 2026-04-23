#!/bin/bash
# GitHub Integration Helper for Polyterminal
# This script helps manage GitHub authentication and common git operations

REPO_DIR="/Users/earn/.verdent/verdent-projects/how-connect-ssh/polyterminal"
cd "$REPO_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

show_menu() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  GitHub Integration Helper${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    echo "1. Check GitHub connection status"
    echo "2. Store GitHub token (for HTTPS)"
    echo "3. Switch to SSH authentication"
    echo "4. Pull latest changes"
    echo "5. Push current branch"
    echo "6. View recent commits"
    echo "7. Check repository status"
    echo "8. Open repository on GitHub"
    echo "0. Exit"
    echo ""
}

check_status() {
    echo -e "${YELLOW}Checking GitHub connection...${NC}"
    
    # Check if we can reach GitHub
    if curl -s -o /dev/null -w "%{http_code}" https://api.github.com | grep -q "200"; then
        echo -e "${GREEN}✓ GitHub API is reachable${NC}"
    else
        echo -e "${RED}✗ Cannot reach GitHub API${NC}"
    fi
    
    # Show current remote
    echo ""
    echo "Current remote:"
    git remote -v
    
    # Show current branch
    echo ""
    echo "Current branch: $(git branch --show-current)"
    
    # Check for uncommitted changes
    if git diff-index --quiet HEAD --; then
        echo -e "${GREEN}✓ Working directory clean${NC}"
    else
        echo -e "${YELLOW}! Uncommitted changes present${NC}"
    fi
}

store_token() {
    echo -e "${YELLOW}GitHub Token Setup${NC}"
    echo "This will store your GitHub token in the macOS Keychain."
    echo ""
    read -sp "Enter your GitHub Personal Access Token: " token
    echo ""
    
    if [ -z "$token" ]; then
        echo -e "${RED}No token provided${NC}"
        return
    fi
    
    # Store in keychain
    git remote set-url origin "https://${token}@github.com/MBIO1/polyterminal.git"
    
    # Test the connection
    echo "Testing connection..."
    if git ls-remote origin &>/dev/null; then
        echo -e "${GREEN}✓ Token valid and stored${NC}"
        # Reset to clean URL (token is cached by credential helper)
        git remote set-url origin https://github.com/MBIO1/polyterminal.git
    else
        echo -e "${RED}✗ Token invalid or expired${NC}"
    fi
}

switch_to_ssh() {
    echo -e "${YELLOW}Switching to SSH authentication...${NC}"
    
    # Check if SSH key exists
    if [ -f "$HOME/.ssh/id_ed25519.pub" ] || [ -f "$HOME/.ssh/id_rsa.pub" ]; then
        echo -e "${GREEN}✓ SSH key found${NC}"
        git remote set-url origin git@github.com:MBIO1/polyterminal.git
        echo -e "${GREEN}✓ Remote URL updated to SSH${NC}"
        echo ""
        echo "Test with: git ls-remote origin"
    else
        echo -e "${RED}✗ No SSH key found${NC}"
        echo "Generate one with: ssh-keygen -t ed25519 -C 'your@email.com'"
        echo "Then add the public key to GitHub → Settings → SSH Keys"
    fi
}

pull_changes() {
    echo -e "${YELLOW}Pulling latest changes...${NC}"
    git pull origin main
}

push_changes() {
    echo -e "${YELLOW}Pushing to GitHub...${NC}"
    
    # Check if there are changes to push
    if git diff-index --quiet HEAD -- && git diff --quiet --cached; then
        echo -e "${YELLOW}No changes to commit${NC}"
    else
        read -p "Enter commit message: " msg
        if [ -z "$msg" ]; then
            msg="Update from $(date '+%Y-%m-%d %H:%M')"
        fi
        git add -A
        git commit -m "$msg"
    fi
    
    git push origin main
}

view_commits() {
    echo -e "${YELLOW}Recent commits:${NC}"
    git log --oneline --graph --decorate -10
}

repo_status() {
    echo -e "${YELLOW}Repository Status:${NC}"
    git status
}

open_github() {
    echo -e "${YELLOW}Opening GitHub repository...${NC}"
    open https://github.com/MBIO1/polyterminal
}

# Main loop
while true; do
    show_menu
    read -p "Select option: " choice
    
    case $choice in
        1) check_status ;;
        2) store_token ;;
        3) switch_to_ssh ;;
        4) pull_changes ;;
        5) push_changes ;;
        6) view_commits ;;
        7) repo_status ;;
        8) open_github ;;
        0) exit 0 ;;
        *) echo -e "${RED}Invalid option${NC}" ;;
    esac
done
