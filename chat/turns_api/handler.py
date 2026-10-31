"""GET /api/chat/turns/<contact>[/<turn>] on air.dengler.io: a chat's turn
records, as the widget reads them (airline_agent/turn_view.py).

CloudFront calls this function's URL through an origin access control.  The
function reads the turns table and nothing else.  rules.json beside it holds
each policy rule's statement, Lean rule, requirements and theorems, and each
requirement's criteria statuses; the stack writes it from build/chat/ and
model/ when it is synthesized.
"""

import json
import os
import re
from pathlib import Path

import boto3

from airline_agent.turn_view import view

PATH = re.compile(r"^/api/chat/turns/([0-9a-f-]{36})(?:/(\d+))?$")
DATA = json.loads(Path(__file__).with_name("rules.json").read_text())
TABLE = boto3.resource("dynamodb").Table(os.environ["TURNS_TABLE"])


def answer(status, body):
    return {"statusCode": status, "headers": {"content-type": "application/json", "cache-control": "no-store"},
            "body": json.dumps(body)}


def handler(event, _context):
    if event.get("requestContext", {}).get("http", {}).get("method") != "GET":
        return answer(405, {"error": "GET only"})
    m = PATH.match(event.get("rawPath", ""))
    if not m:
        return answer(404, {"error": "not found"})
    contact, turn = m.group(1), m.group(2)
    if turn:
        item = TABLE.get_item(Key={"contact": contact, "turn": int(turn)}).get("Item")
        return answer(200, view(item, DATA["rules"], DATA["requirements"])) if item else answer(404, {"error": "no turn"})
    items = TABLE.query(KeyConditionExpression="contact = :c", ExpressionAttributeValues={":c": contact})["Items"]
    return answer(200, [view(i, DATA["rules"], DATA["requirements"]) for i in items])
