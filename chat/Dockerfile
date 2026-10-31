# The airline agent for AgentCore Runtime, which runs arm64 images.  The
# dependencies install from the lockfile in their own layer, reused until
# uv.lock or pyproject.toml changes; the agent's code lands after them.
FROM --platform=linux/arm64 python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project

COPY airline_agent ./airline_agent
EXPOSE 8080
CMD ["python", "-m", "airline_agent.app"]
