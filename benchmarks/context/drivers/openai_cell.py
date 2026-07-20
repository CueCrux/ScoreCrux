#!/usr/bin/env python3
"""OpenAI-compatible CDB model driver (example — adapt for your provider).

A CDB model driver takes the SAME args as run_cell.sh:
    openai_cell.py <sandbox> <prompt-file> <out-dir> [model] [max-turns]

It runs the prompt against a `/v1/chat/completions` endpoint, extracts the JSON
answer object the prompt asks for, and writes it to
<sandbox>/artifacts/answers.json — plus a claude-shaped transcript.jsonl + a
result.json so run_matrix.read_usage / read_latency keep working unchanged.

Dependency-free (urllib). Point CDB_DRIVER at this file:
    export CDB_DRIVER=$PWD/drivers/openai_cell.py
    export OPENAI_BASE=https://api.your-provider.com OPENAI_API_KEY=...
    python3 run_matrix.py --model gpt-4.1-mini --backends my-backend ... --emit
"""
import json, os, pathlib, re, sys, time, urllib.request


def extract_json_object(text):
    """Pull the last {...} object out of a chat response (models sometimes wrap
    it in prose or a code fence)."""
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fence:
        try:
            return json.loads(fence.group(1))
        except Exception:
            pass
    # last balanced-looking object
    for m in reversed(list(re.finditer(r"\{.*\}", text, re.S))):
        try:
            return json.loads(m.group(0))
        except Exception:
            continue
    return {}


def main():
    sandbox, prompt_file, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    model = sys.argv[4] if len(sys.argv) > 4 else "gpt-4.1-mini"
    base = os.environ.get("OPENAI_BASE", "https://api.openai.com").rstrip("/")
    key = os.environ.get("OPENAI_API_KEY", "")
    prompt = pathlib.Path(prompt_file).read_text()

    out = pathlib.Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    artifacts = pathlib.Path(sandbox) / "artifacts"; artifacts.mkdir(parents=True, exist_ok=True)

    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
    }).encode()
    req = urllib.request.Request(f"{base}/v1/chat/completions", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}",
                                          "Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            resp = json.loads(r.read())
    except Exception as e:
        (out / "stderr.log").write_text(f"driver error: {e}\n")
        resp = {"choices": [{"message": {"content": "{}"}}], "usage": {}}
    dt_ms = int((time.time() - t0) * 1000)

    content = (resp.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
    answers = extract_json_object(content)
    (artifacts / "answers.json").write_text(json.dumps(answers, indent=2))

    u = resp.get("usage") or {}
    # Map to the claude transcript shape run_matrix.read_usage expects.
    transcript = {"message": {"model": model, "usage": {
        "input_tokens": u.get("prompt_tokens", 0),
        "output_tokens": u.get("completion_tokens", 0),
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }}}
    (out / "transcript.jsonl").write_text(json.dumps(transcript) + "\n")
    (out / "result.json").write_text(json.dumps({
        "model": model, "duration_ms": dt_ms, "num_turns": 1,
        "usage": transcript["message"]["usage"],
    }, indent=2))
    print(f"ok driver=openai model={model} dt={dt_ms}ms answers={len(answers)}")


if __name__ == "__main__":
    main()
