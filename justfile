# Show available recipes
default:
    @just --list

# Install root dependencies
setup:
    npm ci

# Format source files
fmt:
    npm run format

# Check formatting and generated provider copies
[group('validate')]
fmt-check:
    npm run format:check
    npm run providers:check

# Check frontend code
[group('validate')]
typecheck:
    npm --prefix frontend run typecheck

# Lint frontend, backend, and extension
[group('lint')]
lint:
    npm --prefix frontend run lint
    npm --prefix backend run lint
    npm --prefix extension run lint

# Run backend tests
[group('test')]
test-backend:
    npm --prefix backend test

# Run frontend tests
[group('test')]
test-frontend:
    npm --prefix frontend run test:run

# Run bridge tests
[group('test')]
test-bridge:
    cd bridge && go test ./...

# Build the frontend
[group('validate')]
build-frontend:
    npm --prefix frontend run build

# Build the backend
[group('validate')]
build-backend:
    npm --prefix backend run build

# Validate the website
[group('validate')]
check-web:
    npm --prefix web exec -- astro check
    npm --prefix web run build

# Run checks available in the local checkout
check: fmt-check typecheck lint test-backend test-frontend test-bridge build-frontend build-backend
