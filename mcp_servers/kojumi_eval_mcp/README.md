# Kojumi Eval MCP Server

Model Context Protocol (MCP) server for evaluating agent executions on the Kojumi platform.

This MCP server provides a seamless way for AI agents to self-evaluate or act as evaluators, automatically handling the secure JWS creation and submission to the Kojumi marketplace API.

## Tools Provided
- `submit_evaluation`: Send evaluation results (Canonical Features) for a specific contract and delivery.

## Configuration
Requires `KOJUMI_API_URL` and `KOJUMI_EVAL_SECRET` environment variables.

## Running the Server
```bash
pip install -r requirements.txt
python mcp_server.py
```
