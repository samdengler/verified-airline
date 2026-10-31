"""Chat with Verified Airline over Amazon Connect, as the widget will, and
print each reply with its turn record.

  uv run scripts/chat.py --mode verified "My Main flight left without me this morning. What can I get back if I cancel?"
  uv run scripts/chat.py --mode kb "..." "..."

The chat starts through the deployed chat start (invoked with IAM, since it
has no public route yet), connects the traveler's WebSocket, which the flow
waits for, and sends each question once the previous reply has come.  After
each reply the script reads the turn's record from the turns table, so the
state the widget will show (verified, not checked, withheld) is printed with
the draft and the check's result.  Tokens are never printed.
"""

import argparse
import json
import sys
import threading
import time

import boto3
import websocket

REGION = "us-east-1"


def outputs(stack):
    cf = boto3.client("cloudformation", region_name=REGION)
    (s,) = cf.describe_stacks(StackName=stack)["Stacks"]
    return {o["OutputKey"]: o["OutputValue"] for o in s["Outputs"]}


class Chat:
    def __init__(self, function, mode):
        response = boto3.client("lambda", region_name=REGION).invoke(
            FunctionName=function, Payload=json.dumps({"mode": mode}).encode())
        started = json.loads(response["Payload"].read())
        if "participantToken" not in started:
            sys.exit(f"the chat start answered {started}")
        self.contact = started["contactId"]
        self.participant = boto3.client("connectparticipant", region_name=REGION)
        conn = self.participant.create_participant_connection(
            Type=["WEBSOCKET", "CONNECTION_CREDENTIALS"], ParticipantToken=started["participantToken"])
        self.connection_token = conn["ConnectionCredentials"]["ConnectionToken"]
        self.replies = []
        self.ended = False
        self.ws = websocket.create_connection(conn["Websocket"]["Url"], timeout=60)
        self.ws.send(json.dumps({"topic": "aws/subscribe", "content": {"topics": ["aws/chat"]}}))
        threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        while not self.ended:
            try:
                frame = json.loads(self.ws.recv() or "{}")
            except Exception:
                return
            if frame.get("topic") != "aws/chat":
                continue
            content = json.loads(frame.get("content") or "{}")
            if content.get("Type") == "MESSAGE" and content.get("ParticipantRole") != "CUSTOMER":
                self.replies.append(content.get("Content", ""))
            elif content.get("Type") == "EVENT" and content.get("ContentType", "").endswith("chat.ended"):
                self.ended = True

    def wait_reply(self, seen, limit):
        deadline = time.monotonic() + limit
        while time.monotonic() < deadline and not self.ended and len(self.replies) <= seen:
            time.sleep(0.25)
        return self.replies[seen] if len(self.replies) > seen else None

    def say(self, text):
        self.participant.send_message(ContentType="text/plain", Content=text, ConnectionToken=self.connection_token)

    def close(self):
        if not self.ended:
            try:
                self.participant.disconnect_participant(ConnectionToken=self.connection_token)
            except Exception:
                pass
        self.ended = True
        self.ws.close()


def main():
    ap = argparse.ArgumentParser(description="Chat with Verified Airline over Connect.")
    ap.add_argument("questions", nargs="+")
    ap.add_argument("--mode", choices=["kb", "verified"], default="verified")
    ap.add_argument("--limit", type=float, default=45.0, help="seconds to wait for each reply")
    args = ap.parse_args()
    out = outputs("VerifiedAirlineChat")
    table = boto3.resource("dynamodb", region_name=REGION).Table(out["TurnsTableName"])

    started = time.monotonic()
    chat = Chat(out["ChatStartFunctionName"], args.mode)
    print(f"contact {chat.contact}, mode {args.mode}")
    failed = False
    try:
        greeting = chat.wait_reply(0, args.limit)
        print(f"  << {greeting}  ({time.monotonic() - started:.1f} s)")
        failed = greeting is None
        for number, question in enumerate(args.questions, start=1):
            if chat.ended or failed:
                break
            print(f"  >> {question}")
            sent = time.monotonic()
            chat.say(question)
            reply = chat.wait_reply(number, args.limit)
            print(f"  << {reply}  ({time.monotonic() - sent:.1f} s)")
            item = table.get_item(Key={"contact": chat.contact, "turn": number}).get("Item")
            if reply is None or not item:
                print(f"     no {'reply' if reply is None else 'turn record'}")
                failed = True
                continue
            turn = json.loads(item["body"])
            check = turn.get("check") or {}
            print(f"     state {item['state']}; check {check.get('result', 'none')}, rules {check.get('rulesApplied', [])}")
            if reply != turn["answer"]:
                print(f"     draft: {turn['answer']}")
    finally:
        chat.close()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
