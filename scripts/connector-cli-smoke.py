#!/usr/bin/env python3
"""Smoke checks for local CLI connector helpers without invoking real agents."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = ROOT / "apps" / "connector" / "connector.py"

spec = importlib.util.spec_from_file_location("osa_connector", CONNECTOR_PATH)
connector = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(connector)

text = connector.extract_cli_text(json.dumps({"message": "{\"summary\":\"ok\",\"content\":\"done\"}"}))
assert json.loads(text)["summary"] == "ok"

json_lines = "\n".join(
    [
        json.dumps({"event": "started"}),
        json.dumps({"message": "{\"summary\":\"line\",\"content\":\"json lines\"}"}),
    ]
)
assert json.loads(connector.extract_cli_text(json_lines))["content"] == "json lines"

cmd = connector.command_from_template(
    "agent --message-file {prompt_file} --timeout {timeout}",
    prompt_file="/tmp/osa prompt.md",
    timeout=15,
    prompt="unused",
)
assert cmd == ["agent", "--message-file", "/tmp/osa prompt.md", "--timeout", "15"]

output = connector.run_local_command(
    [
        sys.executable,
        "-c",
        "import json; print(json.dumps({'message': '{\"summary\":\"subprocess\",\"content\":\"ok\"}'}))",
    ],
    None,
    5,
)
assert json.loads(output)["summary"] == "subprocess"

print("connector CLI smoke passed")
