#!/usr/bin/env python3
"""Minimal OpenSwarmAgents connector.

The connector keeps user-owned agent execution local. This MVP worker uses a
safe deterministic stub so the task lifecycle can be tested before real agent
adapters are added.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from typing import Any


def request(
    base_url: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    session_token: str | None = None,
    connector_token: str | None = None,
) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"content-type": "application/json"}
    if session_token:
        headers["x-agentswarm-session"] = session_token
    if connector_token:
        headers["x-osa-connector-token"] = connector_token
    req = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        method=method,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8")
        raise RuntimeError(f"{method} {path} failed: {exc.code} {detail}") from exc


def register(args: argparse.Namespace) -> dict[str, Any]:
    if args.voting_pool:
        response = request(
            args.server,
            "POST",
            "/api/voting/connect",
            {
                "name": args.agent_name,
                "models": args.models.split(","),
                "provider": args.provider,
                "providers": args.providers.split(","),
            },
            args.session_token,
            args.connector_token,
        )
        return response["agent"]

    payload = {
        "name": args.agent_name,
        "goalId": args.goal,
        "capabilities": args.capabilities.split(","),
        "models": args.models.split(","),
        "provider": args.provider,
        "providers": args.providers.split(","),
        "maxConcurrentTasks": args.max_concurrent_tasks,
    }
    response = request(args.server, "POST", "/api/agents/register", payload, args.session_token, args.connector_token)
    return response["agent"]


def result_for(task: dict[str, Any], agent: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    prior_results = context.get("priorResults", [])
    iteration = context.get("iteration", 1)
    revision_note = context.get("lastRevisionReason")
    if task["type"] == "synthesis":
        summary = f"Synthesis proposal for {task['title']}"
        content = (
            "A useful synthesis should separate durable claims from open questions, "
            "link every claim to evidence, and create follow-up tasks for unresolved contradictions."
        )
    else:
        summary = f"Research note for {task['title']}"
        content = (
            "The safe MVP pattern is small leased tasks, user-owned outbound connectors, "
            "independent review, claim-level provenance, and reputation per capability. "
            "This keeps untrusted agents from writing directly into shared knowledge."
        )

    if prior_results:
        content += (
            f" This is iteration {iteration} and it incorporates {len(prior_results)} prior result(s) "
            "from collaborating agents."
        )
    if revision_note:
        content += f" Revision focus: {revision_note}"

    return {
        "agentId": agent["id"],
        "summary": summary,
        "content": content,
        "artifacts": [
            {
                "name": "stub-result.md",
                "kind": "code",
                "mimeType": "text/markdown",
                "description": "Markdown artifact placeholder produced by the local stub connector.",
            }
        ],
        "sources": ["connector://stub-worker", "docs/ARCHITECTURE.md"],
        "confidence": 0.72,
    }


def review_for(
    base_url: str,
    task: dict[str, Any],
    agent: dict[str, Any],
    session_token: str | None = None,
) -> tuple[str | None, dict[str, Any]]:
    result_id = task.get("reviewForResultId")
    if not result_id:
        return None, {}

    state = request(base_url, "GET", "/api/state", session_token=session_token)
    result = next((item for item in state["results"] if item["id"] == result_id), None)
    if not result:
        return None, {}
    if result["agentId"] == agent["id"]:
        return None, {}

    payload = {
        "agentId": agent["id"],
        "decision": "accepted" if result.get("sources") else "needs_revision",
        "score": 0.82 if result.get("sources") else 0.52,
        "reason": "The result is bounded, source-backed, and useful for the current MVP knowledge base.",
    }
    return result_id, payload


def run(args: argparse.Namespace) -> None:
    agent = register(args)
    print(f"registered {agent['id']} ({agent['name']})")

    if args.voting_pool:
        print("voting pool registration cast one proposal vote")
        return

    while True:
        request(args.server, "POST", f"/api/agents/{agent['id']}/heartbeat", {}, args.session_token, args.connector_token)
        claim = request(
            args.server,
            "POST",
            "/api/tasks/claim",
            {"agentId": agent["id"], "goalId": args.goal},
            args.session_token,
            args.connector_token,
        )
        task = claim.get("task")

        if not task:
            print(f"idle: {claim.get('reason', 'no_task')}")
            if args.once:
                return
            time.sleep(args.interval)
            continue

        print(f"claimed {task['id']} {task['type']} {task['title']}")
        if task["type"] == "review":
            result_id, payload = review_for(args.server, task, agent, args.session_token)
            if result_id and payload:
                request(args.server, "POST", f"/api/results/{result_id}/review", payload, args.session_token, args.connector_token)
                print(f"reviewed {result_id}")
        else:
            payload = result_for(task, agent, claim.get("context", {}))
            request(args.server, "POST", f"/api/tasks/{task['id']}/result", payload, args.session_token, args.connector_token)
            print(f"submitted result for {task['id']}")

        if args.once:
            return
        time.sleep(args.interval)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Connect a local agent to OpenSwarmAgents.")
    parser.add_argument("--server", default="http://127.0.0.1:8788")
    parser.add_argument("--agent-name", default="Local Stub Agent")
    parser.add_argument("--goal", default="goal-agent-collab")
    parser.add_argument("--capabilities", default="research,review,synthesis")
    parser.add_argument("--models", default="stub-local")
    parser.add_argument("--provider", default="unknown")
    parser.add_argument("--providers", default="")
    parser.add_argument("--max-concurrent-tasks", type=int, default=1)
    parser.add_argument("--session-token", default=None, help="Optional OpenSwarmAgents user session token.")
    parser.add_argument("--connector-token", default=None, help="Scoped OSA connector token generated by the website.")
    parser.add_argument("--interval", type=float, default=5)
    parser.add_argument("--voting-pool", action="store_true", help="Connect this agent to the proposal voting pool.")
    parser.add_argument("--once", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    run(parse_args())
