#!/bin/bash
# SecureWatch Docker Stack Startup Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== SecureWatch Docker Stack ===${NC}"

# Check for .env file
if [ ! -f .env ]; then
    echo -e "${YELLOW}No .env file found. Creating from .env.example...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}Please edit .env with your settings (especially GEMINI_API_KEY)${NC}"
fi

# Check for backend directory
if [ ! -d ../backend ]; then
    echo -e "${RED}Error: Backend directory not found at ../backend${NC}"
    echo "Please ensure the backend code is available at: $(dirname $SCRIPT_DIR)/backend"
    exit 1
fi

# Parse command line arguments
PROFILE=""
if [ "$1" == "--with-frontend" ]; then
    PROFILE="--profile frontend"
    echo -e "${GREEN}Starting with frontend...${NC}"
fi

if [ "$1" == "--with-simulation" ]; then
    PROFILE="--profile simulation"
    echo -e "${GREEN}Starting with simulation worker...${NC}"
fi

if [ "$1" == "--full" ]; then
    PROFILE="--profile frontend --profile simulation"
    echo -e "${GREEN}Starting full stack...${NC}"
fi

# Build and start
echo -e "${GREEN}Building containers...${NC}"
docker compose build

echo -e "${GREEN}Starting services...${NC}"
docker compose $PROFILE up -d

echo ""
echo -e "${GREEN}=== Services Started ===${NC}"
echo "  Redis:     localhost:6379"
echo "  MinIO:     localhost:9000 (console: localhost:9001)"
echo "  MediaMTX:  localhost:8554 (RTSP) / localhost:8888 (HLS)"
echo "  API:       localhost:4000"
echo ""
echo -e "${YELLOW}View logs: docker compose logs -f${NC}"
echo -e "${YELLOW}Stop: docker compose down${NC}"
