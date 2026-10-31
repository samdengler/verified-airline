"""Turn records: each turn of a Connect chat, kept 30 days.

The key is the contact and the turn's number in it, counted from 1, so the
widget can read the record of the reply it just showed.  The whole turn
(question, retrieved chunks, draft, check) is one JSON attribute, since
DynamoDB takes no floats and the check's confidence is one.
"""

import json
import os
import time

DAYS = 30


def record(table, contact, turn):
    """Store the turn under the next free number for the contact and return
    that number."""
    number = table.query(KeyConditionExpression="contact = :c", ExpressionAttributeValues={":c": contact},
                         Select="COUNT")["Count"] + 1
    now = int(time.time())
    while True:
        try:
            table.put_item(
                Item={"contact": contact, "turn": number, "at": now, "expires": now + DAYS * 86400,
                      "mode": turn["mode"], "state": turn["state"], "body": json.dumps(turn)},
                ConditionExpression="attribute_not_exists(turn)",
            )
            return number
        except table.meta.client.exceptions.ConditionalCheckFailedException:
            number += 1


def table(session):
    return session.resource("dynamodb").Table(os.environ["TURNS_TABLE"])
