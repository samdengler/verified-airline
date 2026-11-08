"""The One ID relay's two functions, behind the VerifiedAirlineOneId stack's HTTP API.

A session carries one exchange of the demo between two devices.  The screen that
asks (the check-in page or the gate reader) starts it with its request; the
wallet writes its answer; after a share at check-in, the website writes word that
the boarding pass was added.  Each part is written once and read by the
session's id, which is random and unguessable.  Nothing lists sessions, and each
expires after SESSION_SECONDS.

The relay reads nothing in what it carries beyond checking that it is a JSON
object of at most MAX_BYTES: the checks on each screen decide.  The sessions
hold specimen data, and are kept as if they held real data.

    POST /sessions                 the request; answers 201 with the session's id
    POST /sessions/{id}/{part}     part is response or pass; 204, or 404 or 409
    GET  /sessions/{id}/{part}     part is request, response or pass; 200, 204 before
                                   it is written, or 404 for no session
"""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import time

SESSION_SECONDS = int(os.environ.get("SESSION_SECONDS", "600"))
MAX_BYTES = 16 * 1024
SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{22}$")
# The parts written after the request, each with the part it must follow.
LATER = {"response": None, "pass": "response"}
READABLE = ("request", "response", "pass")


class Sessions:
    """The table, through the three calls the relay makes.  Every write is
    conditional, so two writers cannot both answer one request."""

    def __init__(self, table):
        self.table = table

    def create(self, session_id: str, request: str, expires: int) -> bool:
        return self._conditional(
            self.table.put_item,
            Item={"id": session_id, "request": request, "expires": expires},
            ConditionExpression="attribute_not_exists(id)",
        )

    def add(self, session_id: str, part: str, body: str, needs: str | None, now: int) -> bool:
        condition = "attribute_exists(id) AND attribute_not_exists(#part) AND expires > :now"
        names = {"#part": part}
        if needs:
            condition += " AND attribute_exists(#needs)"
            names["#needs"] = needs
        return self._conditional(
            self.table.update_item,
            Key={"id": session_id},
            UpdateExpression="SET #part = :body",
            ConditionExpression=condition,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues={":body": body, ":now": now},
        )

    def get(self, session_id: str) -> dict | None:
        return self.table.get_item(Key={"id": session_id}, ConsistentRead=True).get("Item")

    @staticmethod
    def _conditional(call, **kwargs) -> bool:
        try:
            call(**kwargs)
            return True
        except Exception as e:  # botocore's ConditionalCheckFailedException, without importing botocore here
            if type(e).__name__ == "ConditionalCheckFailedException":
                return False
            raise


_sessions: Sessions | None = None


def sessions() -> Sessions:
    global _sessions
    if _sessions is None:
        import boto3

        _sessions = Sessions(boto3.resource("dynamodb").Table(os.environ["SESSIONS_TABLE"]))
    return _sessions


def reply(status: int, body: object | str | None = None) -> dict:
    headers = {"cache-control": "no-store"}
    if body is None:
        return {"statusCode": status, "headers": headers}
    headers["content-type"] = "application/json"
    return {"statusCode": status, "headers": headers, "body": body if isinstance(body, str) else json.dumps(body)}


def body_of(event: dict) -> str | dict:
    """The body as compact JSON, or a reply saying why it cannot be stored."""
    raw = event.get("body") or ""
    data = base64.b64decode(raw) if event.get("isBase64Encoded") else raw.encode()
    if len(data) > MAX_BYTES:
        return reply(413, {"error": f"at most {MAX_BYTES} bytes"})
    try:
        value = json.loads(data)
    except ValueError:
        return reply(400, {"error": "not JSON"})
    if not isinstance(value, dict):
        return reply(400, {"error": "not a JSON object"})
    return json.dumps(value, separators=(",", ":"))


def live(item: dict | None, now: int) -> bool:
    """A session TTL has not deleted yet still counts as gone once it expires."""
    return item is not None and int(item["expires"]) > now


def write(event: dict, context=None, store: Sessions | None = None) -> dict:
    """POST /sessions and POST /sessions/{id}/{part}."""
    store = store or sessions()
    now = int(time.time())
    body = body_of(event)
    if isinstance(body, dict):
        return body
    params = event.get("pathParameters") or {}
    if "id" not in params:
        session_id = secrets.token_urlsafe(16)
        expires = now + SESSION_SECONDS
        if not store.create(session_id, body, expires):
            return reply(409, {"error": "try again"})
        return reply(201, {"id": session_id, "expires": expires})
    session_id, part = params["id"], params.get("part")
    if not SESSION_ID.match(session_id) or part not in LATER:
        return reply(404, {"error": "no such session"})
    if store.add(session_id, part, body, LATER[part], now):
        return reply(204)
    if not live(store.get(session_id), now):
        return reply(404, {"error": "no such session"})
    return reply(409, {"error": f"{part} cannot be written now"})


def read(event: dict, context=None, store: Sessions | None = None) -> dict:
    """GET /sessions/{id}/{part}."""
    store = store or sessions()
    params = event.get("pathParameters") or {}
    session_id, part = params.get("id", ""), params.get("part")
    if not SESSION_ID.match(session_id) or part not in READABLE:
        return reply(404, {"error": "no such session"})
    item = store.get(session_id)
    if not live(item, int(time.time())):
        return reply(404, {"error": "no such session"})
    if part not in item:
        return reply(204)
    return reply(200, item[part])
