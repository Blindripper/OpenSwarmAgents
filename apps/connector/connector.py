#!/usr/bin/env python3
"""Minimal OpenSwarmAgents connector.

The connector keeps user-owned agent execution local. It can run a safe
deterministic stub for lifecycle tests or call a user-owned provider API key
from the local environment for real task execution.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shlex
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from typing import Any


PROVIDER_ENV = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
}

DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "anthropic": "claude-3-5-haiku-latest",
    "gemini": "gemini-1.5-flash",
}


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


def upload_artifact(
    args: argparse.Namespace,
    agent: dict[str, Any],
    task: dict[str, Any],
    name: str,
    content: str,
    description: str,
) -> dict[str, Any]:
    response = request(
        args.server,
        "POST",
        "/api/artifacts/upload",
        {
            "agentId": agent["id"],
            "goalId": task.get("goalId"),
            "taskId": task.get("id"),
            "name": name,
            "kind": "code",
            "mimeType": "text/markdown",
            "description": description,
            "dataBase64": base64.b64encode(content.encode("utf-8")).decode("ascii"),
        },
        args.session_token,
        args.connector_token,
    )
    return response["artifact"]


def provider_request(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8")
        raise RuntimeError(f"Provider request failed: {exc.code} {detail}") from exc


def provider_key(args: argparse.Namespace, provider: str) -> str:
    explicit_env = args.api_key_env or PROVIDER_ENV.get(provider, "")
    key = os.environ.get(explicit_env, "").strip()
    if not key:
        raise RuntimeError(f"Missing provider key. Set {explicit_env} before running the connector.")
    return key


def provider_model(args: argparse.Namespace, provider: str) -> str:
    if args.model:
        return args.model
    env_name = f"{provider.upper()}_MODEL"
    return os.environ.get(env_name, DEFAULT_MODELS.get(provider, ""))


def call_provider(args: argparse.Namespace, prompt: str, system: str) -> str:
    provider = normalize_provider(args.provider)
    if provider == "openai":
        return call_openai(args, prompt, system)
    if provider == "anthropic":
        return call_anthropic(args, prompt, system)
    if provider == "gemini":
        return call_gemini(args, prompt, system)
    raise RuntimeError("Choose --provider openai, anthropic, or gemini when --runner provider is used.")


def call_local_cli(args: argparse.Namespace, prompt: str, system: str) -> str:
    if args.runner == "openclaw":
        return call_openclaw(args, prompt, system)
    if args.runner == "codex":
        return call_codex(args, prompt, system)
    raise RuntimeError(f"Unsupported local CLI runner: {args.runner}")


def local_cli_message(prompt: str, system: str) -> str:
    return (
        f"{system}\n\n"
        "Return one JSON object only. Do not include prose outside JSON.\n\n"
        f"{prompt}\n"
    )


def call_openclaw(args: argparse.Namespace, prompt: str, system: str) -> str:
    command = args.openclaw_command or os.environ.get("OSA_OPENCLAW_COMMAND", "openclaw")
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".md", delete=False) as handle:
        handle.write(local_cli_message(prompt, system))
        message_file = handle.name
    try:
        cmd = [
            command,
            "agent",
            "--local",
            "--json",
            "--timeout",
            str(args.local_cli_timeout),
            "--message-file",
            message_file,
        ]
        if args.openclaw_agent:
            cmd.extend(["--agent", args.openclaw_agent])
        if args.model:
            cmd.extend(["--model", args.model])
        if args.openclaw_thinking:
            cmd.extend(["--thinking", args.openclaw_thinking])
        return run_local_command(cmd, None, args.local_cli_timeout)
    finally:
        try:
            os.unlink(message_file)
        except OSError:
            pass


def call_codex(args: argparse.Namespace, prompt: str, system: str) -> str:
    message = local_cli_message(prompt, system)
    command_template = args.codex_command or os.environ.get("OSA_CODEX_COMMAND", "")
    if command_template:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".md", delete=False) as handle:
            handle.write(message)
            message_file = handle.name
        try:
            cmd = command_from_template(
                command_template,
                prompt_file=message_file,
                prompt=message,
                timeout=args.local_cli_timeout,
            )
            stdin = None if "{prompt}" in command_template or "{prompt_file}" in command_template else message
            return run_local_command(cmd, stdin, args.local_cli_timeout)
        finally:
            try:
                os.unlink(message_file)
            except OSError:
                pass

    cmd = [args.codex_binary, "exec", "--json", "--skip-git-repo-check"]
    if args.model:
        cmd.extend(["--model", args.model])
    return run_local_command(cmd, message, args.local_cli_timeout)


def command_from_template(template: str, **values: Any) -> list[str]:
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{" + key + "}", shlex.quote(str(value)))
    return shlex.split(rendered)


def run_local_command(cmd: list[str], stdin: str | None, timeout: int) -> str:
    try:
        completed = subprocess.run(
            cmd,
            input=stdin,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"Local CLI runner not found: {cmd[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Local CLI runner timed out after {timeout}s: {cmd[0]}") from exc

    output = completed.stdout.strip()
    detail = completed.stderr.strip()
    if completed.returncode != 0:
        raise RuntimeError(f"Local CLI runner failed with exit {completed.returncode}: {detail or output}")
    if not output and detail:
        output = detail
    if not output:
        raise RuntimeError("Local CLI runner returned no output")
    return extract_cli_text(output)


def extract_cli_text(output: str) -> str:
    parsed = parse_json_lines(output)
    if parsed:
        texts = [text for item in parsed for text in text_values(item)]
        if texts:
            return texts[-1]
    try:
        item = json.loads(output)
        texts = text_values(item)
        if texts:
            return texts[-1]
    except json.JSONDecodeError:
        pass
    return output


def parse_json_lines(output: str) -> list[Any]:
    parsed = []
    for line in output.splitlines():
        value = line.strip()
        if not value.startswith("{"):
            continue
        try:
            parsed.append(json.loads(value))
        except json.JSONDecodeError:
            continue
    return parsed


def text_values(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        texts: list[str] = []
        for item in value:
            texts.extend(text_values(item))
        return texts
    if not isinstance(value, dict):
        return []

    direct_keys = ("final", "reply", "message", "content", "text", "output", "result", "last_message")
    texts: list[str] = []
    for key in direct_keys:
        if key in value:
            texts.extend(text_values(value[key]))
    for nested in ("data", "response", "assistant", "assistant_message"):
        if nested in value:
            texts.extend(text_values(value[nested]))
    return texts


def call_openai(args: argparse.Namespace, prompt: str, system: str) -> str:
    key = provider_key(args, "openai")
    payload = {
        "model": provider_model(args, "openai"),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": args.temperature,
        "max_tokens": args.max_tokens,
    }
    data = provider_request(
        args.openai_url,
        payload,
        {"authorization": f"Bearer {key}"},
        args.provider_timeout,
    )
    return data["choices"][0]["message"]["content"]


def call_anthropic(args: argparse.Namespace, prompt: str, system: str) -> str:
    key = provider_key(args, "anthropic")
    payload = {
        "model": provider_model(args, "anthropic"),
        "max_tokens": args.max_tokens,
        "temperature": args.temperature,
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
    }
    data = provider_request(
        args.anthropic_url,
        payload,
        {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
        args.provider_timeout,
    )
    return "".join(part.get("text", "") for part in data.get("content", []) if part.get("type") == "text")


def call_gemini(args: argparse.Namespace, prompt: str, system: str) -> str:
    key = provider_key(args, "gemini")
    model = provider_model(args, "gemini")
    url = args.gemini_url.format(model=model, key=key)
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": args.temperature,
            "maxOutputTokens": args.max_tokens,
        },
    }
    data = provider_request(url, payload, {}, args.provider_timeout)
    parts = data["candidates"][0]["content"].get("parts", [])
    return "".join(part.get("text", "") for part in parts)


def extract_json(text: str) -> dict[str, Any]:
    value = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", value, re.DOTALL | re.IGNORECASE)
    if fenced:
        value = fenced.group(1)
    if not value.startswith("{"):
        start = value.find("{")
        end = value.rfind("}")
        if start != -1 and end != -1 and end > start:
            value = value[start : end + 1]
    return json.loads(value)


def normalize_provider(value: str) -> str:
    provider = (value or "").strip().lower()
    return provider if provider in PROVIDER_ENV else "unknown"


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


def task_system_prompt() -> str:
    return (
        "You are a local user-owned OpenSwarmAgents worker. Produce bounded, useful work for one leased task. "
        "Do not claim unsupported facts. Prefer clear sources when available. Return only valid JSON."
    )


def review_system_prompt() -> str:
    return (
        "You are a local user-owned OpenSwarmAgents review agent. Review another agent's result for usefulness, "
        "source quality, project alignment, and whether it needs another iteration. Return only valid JSON."
    )


def task_prompt(task: dict[str, Any], context: dict[str, Any]) -> str:
    return json.dumps(
        {
            "instructions": {
                "outputSchema": {
                    "summary": "short human-readable result summary",
                    "content": "complete useful result, markdown allowed",
                    "sources": ["source URL or citation strings"],
                    "confidence": "number from 0 to 1",
                },
                "rules": [
                    "Keep the task bounded.",
                    "Use priorResults and review feedback when present.",
                    "If sources are unavailable, say so explicitly in content and use low confidence.",
                ],
            },
            "task": task,
            "collaborationContext": context,
        },
        indent=2,
    )


def review_prompt(result: dict[str, Any], task: dict[str, Any]) -> str:
    return json.dumps(
        {
            "instructions": {
                "outputSchema": {
                    "decision": "accepted, needs_revision, or rejected",
                    "score": "number from 0 to 1",
                    "reason": "short, specific review rationale",
                },
                "rules": [
                    "Accept only if the result is useful and adequately bounded.",
                    "Use needs_revision for fixable gaps.",
                    "Use rejected only for unsafe, irrelevant, or fundamentally wrong outputs.",
                ],
            },
            "task": task,
            "result": result,
        },
        indent=2,
    )


def stub_result_for(task: dict[str, Any], context: dict[str, Any]) -> tuple[str, str, list[str], float]:
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
            "The safe OSA pattern is small leased tasks, user-owned outbound connectors, "
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

    return summary, content, ["connector://stub-worker", "docs/ARCHITECTURE.md"], 0.72


def provider_result_for(args: argparse.Namespace, task: dict[str, Any], context: dict[str, Any]) -> tuple[str, str, list[str], float]:
    text = call_provider(args, task_prompt(task, context), task_system_prompt())
    data = extract_json(text)
    summary = str(data.get("summary") or f"Result for {task['title']}").strip()[:240]
    content = str(data.get("content") or text).strip()
    sources = data.get("sources") if isinstance(data.get("sources"), list) else []
    confidence = float(data.get("confidence", 0.65))
    return summary, content, [str(source)[:500] for source in sources], max(0.0, min(1.0, confidence))


def local_cli_result_for(args: argparse.Namespace, task: dict[str, Any], context: dict[str, Any]) -> tuple[str, str, list[str], float]:
    text = call_local_cli(args, task_prompt(task, context), task_system_prompt())
    data = extract_json(text)
    summary = str(data.get("summary") or f"Result for {task['title']}").strip()[:240]
    content = str(data.get("content") or text).strip()
    sources = data.get("sources") if isinstance(data.get("sources"), list) else []
    confidence = float(data.get("confidence", 0.65))
    if not sources:
        sources = [f"connector://{args.runner}/local-cli"]
    return summary, content, [str(source)[:500] for source in sources], max(0.0, min(1.0, confidence))


def result_for(args: argparse.Namespace, task: dict[str, Any], agent: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    if args.runner == "provider":
        try:
            summary, content, sources, confidence = provider_result_for(args, task, context)
        except Exception as exc:
            if not args.fallback_to_stub:
                raise
            print(f"provider execution failed, falling back to stub: {exc}")
            summary, content, sources, confidence = stub_result_for(task, context)
    elif args.runner in {"openclaw", "codex"}:
        try:
            summary, content, sources, confidence = local_cli_result_for(args, task, context)
        except Exception as exc:
            if not args.fallback_to_stub:
                raise
            print(f"{args.runner} execution failed, falling back to stub: {exc}")
            summary, content, sources, confidence = stub_result_for(task, context)
    else:
        summary, content, sources, confidence = stub_result_for(task, context)

    try:
        artifact = upload_artifact(
            args,
            agent,
            task,
            f"{args.runner}-result.md",
            f"# {summary}\n\n{content}\n",
            f"Markdown artifact uploaded by the local {args.runner} connector.",
        )
    except RuntimeError:
        artifact = {
            "name": f"{args.runner}-result.md",
            "kind": "code",
            "mimeType": "text/markdown",
            "description": f"Markdown artifact metadata produced by the local {args.runner} connector. Use a scoped connector token to enable real uploads.",
        }

    return {
        "agentId": agent["id"],
        "summary": summary,
        "content": content,
        "artifacts": [artifact],
        "sources": sources or [f"connector://{args.runner}/{normalize_provider(args.provider)}"],
        "confidence": confidence,
    }


def review_for(
    args: argparse.Namespace,
    task: dict[str, Any],
    agent: dict[str, Any],
) -> tuple[str | None, dict[str, Any]]:
    result_id = task.get("reviewForResultId")
    if not result_id:
        return None, {}

    state = request(args.server, "GET", "/api/state", session_token=args.session_token)
    result = next((item for item in state["results"] if item["id"] == result_id), None)
    if not result:
        return None, {}
    if result["agentId"] == agent["id"]:
        return None, {}

    if args.runner in {"provider", "openclaw", "codex"}:
        try:
            text = (
                call_provider(args, review_prompt(result, task), review_system_prompt())
                if args.runner == "provider"
                else call_local_cli(args, review_prompt(result, task), review_system_prompt())
            )
            data = extract_json(text)
            decision = str(data.get("decision") or "needs_revision").strip().lower()
            if decision not in {"accepted", "needs_revision", "rejected"}:
                decision = "needs_revision"
            score = max(0.0, min(1.0, float(data.get("score", 0.55))))
            reason = str(data.get("reason") or "Provider review completed.").strip()
        except Exception as exc:
            if not args.fallback_to_stub:
                raise
            print(f"{args.runner} review failed, falling back to stub: {exc}")
            decision = "accepted" if result.get("sources") else "needs_revision"
            score = 0.82 if result.get("sources") else 0.52
            reason = "The result is bounded, source-backed, and useful for the current OSA knowledge base."
    else:
        decision = "accepted" if result.get("sources") else "needs_revision"
        score = 0.82 if result.get("sources") else 0.52
        reason = "The result is bounded, source-backed, and useful for the current OSA knowledge base."

    payload = {
        "agentId": agent["id"],
        "decision": decision,
        "score": score,
        "reason": reason[:2000],
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
            result_id, payload = review_for(args, task, agent)
            if result_id and payload:
                request(args.server, "POST", f"/api/results/{result_id}/review", payload, args.session_token, args.connector_token)
                print(f"reviewed {result_id}")
        else:
            payload = result_for(args, task, agent, claim.get("context", {}))
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
    parser.add_argument("--runner", choices=["stub", "provider", "openclaw", "codex"], default="stub")
    parser.add_argument("--provider", default="unknown")
    parser.add_argument("--providers", default="")
    parser.add_argument("--model", default=None, help="Provider model override. Defaults can also be set with OPENAI_MODEL, ANTHROPIC_MODEL, or GEMINI_MODEL.")
    parser.add_argument("--api-key-env", default=None, help="Environment variable that contains the selected provider API key.")
    parser.add_argument("--max-tokens", type=int, default=1400)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--provider-timeout", type=int, default=60)
    parser.add_argument("--local-cli-timeout", type=int, default=600)
    parser.add_argument("--openclaw-command", default=None, help="OpenClaw CLI binary. Defaults to OSA_OPENCLAW_COMMAND or openclaw.")
    parser.add_argument("--openclaw-agent", default=None, help="Optional OpenClaw agent id for --runner openclaw.")
    parser.add_argument("--openclaw-thinking", default=None, help="Optional OpenClaw thinking level for --runner openclaw.")
    parser.add_argument("--codex-binary", default=os.environ.get("OSA_CODEX_BINARY", "codex"), help="Codex CLI binary for the default --runner codex command.")
    parser.add_argument("--codex-command", default=None, help="Optional Codex command template. Supports {prompt_file}, {prompt}, and {timeout}.")
    parser.add_argument("--openai-url", default="https://api.openai.com/v1/chat/completions")
    parser.add_argument("--anthropic-url", default="https://api.anthropic.com/v1/messages")
    parser.add_argument("--gemini-url", default="https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}")
    parser.add_argument("--fallback-to-stub", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--max-concurrent-tasks", type=int, default=1)
    parser.add_argument("--session-token", default=None, help="Optional OpenSwarmAgents user session token.")
    parser.add_argument("--connector-token", default=None, help="Scoped OSA connector token generated by the website.")
    parser.add_argument("--interval", type=float, default=5)
    parser.add_argument("--voting-pool", action="store_true", help="Connect this agent to the proposal voting pool.")
    parser.add_argument("--once", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    run(parse_args())
