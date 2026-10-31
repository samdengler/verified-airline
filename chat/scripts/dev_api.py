"""The chat's API on this machine, for the widget under `npm start`.

  eval "$(aws configure export-credentials --format env)"
  uv run scripts/dev_api.py          # http://127.0.0.1:8790; web/proxy.conf.json sends /api here

Until the widget is published the chat start has no public route, so this
server stands in for it with the caller's AWS credentials:

  POST /api/chat/start {"mode": "kb" | "verified"}   invokes the chat start
  GET  /api/chat/turns/<contact>                       every turn of the chat
  GET  /api/chat/turns/<contact>/<turn>                one turn

A turn is what chat/airline_agent/turn_view.py lets the widget read.  The
server listens on 127.0.0.1 only.
"""

import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import boto3

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from airline_agent.turn_view import view  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
REGION = "us-east-1"
PORT = 8790
TURNS = re.compile(r"^/api/chat/turns/([0-9a-f-]{36})(?:/(\d+))?$")


def outputs(stack):
    cf = boto3.client("cloudformation", region_name=REGION)
    (s,) = cf.describe_stacks(StackName=stack)["Stacks"]
    return {o["OutputKey"]: o["OutputValue"] for o in s["Outputs"]}


OUT = outputs("VerifiedAirlineChat")
LAMBDA = boto3.client("lambda", region_name=REGION)
TABLE = boto3.resource("dynamodb", region_name=REGION).Table(OUT["TurnsTableName"])
RULES = json.loads((ROOT / "build" / "chat" / "ar-rules.json").read_text())["rules"]
REQUIREMENTS = json.loads((ROOT / "model" / "model.json").read_text())["requirements"]


class Api(BaseHTTPRequestHandler):
    def answer(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != "/api/chat/start":
            return self.answer(404, {"error": "not found"})
        try:
            mode = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}").get("mode")
        except ValueError:
            return self.answer(400, {"error": "the body is not JSON"})
        response = LAMBDA.invoke(FunctionName=OUT["ChatStartFunctionName"],
                                 Payload=json.dumps({"body": json.dumps({"mode": mode})}).encode())
        proxied = json.loads(response["Payload"].read())
        self.answer(proxied.get("statusCode", 502), json.loads(proxied.get("body") or "{}"))

    def do_GET(self):
        m = TURNS.match(self.path)
        if not m:
            return self.answer(404, {"error": "not found"})
        contact, turn = m.group(1), m.group(2)
        if turn:
            item = TABLE.get_item(Key={"contact": contact, "turn": int(turn)}).get("Item")
            return self.answer(200, view(item, RULES, REQUIREMENTS)) if item else self.answer(404, {"error": "no turn"})
        items = TABLE.query(KeyConditionExpression="contact = :c", ExpressionAttributeValues={":c": contact})["Items"]
        self.answer(200, [view(i, RULES, REQUIREMENTS) for i in items])

    def log_message(self, fmt, *args):
        print(f"{self.command} {self.path.split('?')[0]} -> {args[1] if len(args) > 1 else ''}", flush=True)


if __name__ == "__main__":
    print(f"chat API on http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Api).serve_forever()
