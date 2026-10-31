"""The agent on AgentCore Runtime.  POST /invocations answers one turn in
either of two shapes:

- {"question": "...", "mode": "kb" | "verified"} returns the whole turn, for
  chat/scripts/ask.py;
- an A2A JSON-RPC message/send, which the Connect canvas sends through the
  agents gateway, with the question as the message's text and the mode and
  contact ID in its metadata.  The turn is recorded under the contact, and the
  reply's parts are the text the traveler is shown and a data part naming
  the turn's number and state.
"""

import uuid

import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp

from airline_agent import reply, turns
from airline_agent.agent import REGION, answer

app = BedrockAgentCoreApp()


def rpc_error(request_id, code, message):
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def message_send(request):
    request_id = request.get("id")
    if request.get("method") != "message/send":
        return rpc_error(request_id, -32601, "only message/send is supported")
    message = (request.get("params") or {}).get("message") or {}
    question = " ".join(p.get("text", "") for p in message.get("parts", []) if p.get("kind") == "text").strip()
    metadata = message.get("metadata") or {}
    mode, contact = metadata.get("mode") or "kb", metadata.get("contact")
    if not question or mode not in ("kb", "verified") or not contact:
        return rpc_error(request_id, -32602, "a message needs text, a mode of kb or verified, and a contact")
    turn = answer(question, mode)
    turn["state"] = reply.state(turn)
    number = turns.record(turns.table(boto3.Session(region_name=REGION)), contact, turn)
    return {"jsonrpc": "2.0", "id": request_id, "result": {
        "kind": "message", "role": "agent", "messageId": uuid.uuid4().hex, "contextId": message.get("contextId"),
        "parts": [{"kind": "text", "text": reply.text(turn, turn["state"])},
                  {"kind": "data", "data": {"turn": number, "mode": mode, "state": turn["state"]}}]}}


@app.entrypoint
def invoke(payload):
    payload = payload or {}
    if payload.get("jsonrpc"):
        return message_send(payload)
    question = payload.get("question") or payload.get("prompt") or ""
    if not question.strip():
        return {"error": "no question"}
    turn = answer(question, payload.get("mode", "kb"))
    turn["state"] = reply.state(turn)
    return turn


if __name__ == "__main__":
    app.run()
