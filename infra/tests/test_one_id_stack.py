"""Synthesizes the One ID relay's stack and checks its resources, then runs its
two functions against a table kept in memory."""

import base64
import importlib.util
import json

import aws_cdk as cdk
import pytest
from aws_cdk.assertions import Match, Template
from verified_airline_infra.one_id_stack import ALLOWED_ORIGINS, RELAY_DIR, SESSION_SECONDS, VerifiedAirlineOneIdStack

ACCOUNT = "123456789012"

spec = importlib.util.spec_from_file_location("relay", RELAY_DIR / "relay.py")
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)


@pytest.fixture(scope="module")
def template():
    app = cdk.App()
    stack = VerifiedAirlineOneIdStack(app, "VerifiedAirlineOneId", env=cdk.Environment(account=ACCOUNT, region="us-east-1"))
    return Template.from_stack(stack)


def test_one_table_on_demand_whose_sessions_expire(template):
    template.resource_count_is("AWS::DynamoDB::Table", 1)
    template.has_resource_properties(
        "AWS::DynamoDB::Table",
        {
            "BillingMode": "PAY_PER_REQUEST",
            "KeySchema": [{"AttributeName": "id", "KeyType": "HASH"}],
            "TimeToLiveSpecification": {"AttributeName": "expires", "Enabled": True},
        },
    )
    assert SESSION_SECONDS == 600


def test_two_functions_one_writes_and_one_reads(template):
    functions = template.find_resources("AWS::Lambda::Function")
    assert sorted(f["Properties"]["Handler"] for f in functions.values()) == ["relay.read", "relay.write"]
    for f in functions.values():
        assert f["Properties"]["Runtime"] == "python3.13"
        assert f["Properties"]["Environment"]["Variables"]["SESSION_SECONDS"] == "600"


def test_the_reader_may_only_get_and_nothing_may_list(template):
    granted = {}
    for policy in template.find_resources("AWS::IAM::Policy").values():
        role = json.dumps(policy["Properties"]["Roles"])
        actions = set()
        for s in policy["Properties"]["PolicyDocument"]["Statement"]:
            actions.update([s["Action"]] if isinstance(s["Action"], str) else s["Action"])
            assert s["Resource"] != "*", json.dumps(s)
        granted["Read" if "Read" in role else "Write"] = actions
    assert granted["Read"] == {"dynamodb:GetItem"}
    assert granted["Write"] == {"dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:GetItem"}
    assert not any(a in acts for acts in granted.values() for a in ("dynamodb:Scan", "dynamodb:Query", "dynamodb:*"))


def test_three_routes_and_none_that_lists(template):
    routes = sorted(r["Properties"]["RouteKey"] for r in template.find_resources("AWS::ApiGatewayV2::Route").values())
    assert routes == ["GET /sessions/{id}/{part}", "POST /sessions", "POST /sessions/{id}/{part}"]


def test_cors_allows_the_site_and_the_dev_server_only(template):
    template.has_resource_properties(
        "AWS::ApiGatewayV2::Api",
        {
            "ProtocolType": "HTTP",
            "CorsConfiguration": Match.object_like(
                {"AllowOrigins": ALLOWED_ORIGINS, "AllowMethods": ["GET", "POST"], "AllowHeaders": ["content-type"]}
            ),
        },
    )
    assert ALLOWED_ORIGINS == ["https://air.dengler.io", "http://localhost:4200", "http://127.0.0.1:4200"]


def test_the_stage_is_throttled(template):
    template.has_resource_properties(
        "AWS::ApiGatewayV2::Stage",
        {"StageName": "$default", "AutoDeploy": True,
         "DefaultRouteSettings": {"ThrottlingRateLimit": 20, "ThrottlingBurstLimit": 40}},
    )


def test_the_relay_url_is_an_output(template):
    assert "RelayUrl" in template.find_outputs("*")


class Table:
    """The calls Sessions makes, on a dict, with the conditions they carry."""

    def __init__(self):
        self.items = {}

    def put_item(self, Item, ConditionExpression):
        assert ConditionExpression == "attribute_not_exists(id)"
        if Item["id"] in self.items:
            raise ConditionalCheckFailedException()
        self.items[Item["id"]] = dict(Item)

    def update_item(self, Key, UpdateExpression, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues):
        item = self.items.get(Key["id"])
        part, needs = ExpressionAttributeNames["#part"], ExpressionAttributeNames.get("#needs")
        ok = (item is not None and part not in item and item["expires"] > ExpressionAttributeValues[":now"]
              and (needs is None or needs in item))
        if not ok:
            raise ConditionalCheckFailedException()
        item[part] = ExpressionAttributeValues[":body"]

    def get_item(self, Key, ConsistentRead):
        assert ConsistentRead
        item = self.items.get(Key["id"])
        return {"Item": dict(item)} if item else {}


class ConditionalCheckFailedException(Exception):
    pass


@pytest.fixture
def store():
    return relay.Sessions(Table())


def post(store, body, session_id=None, part=None, base64_body=False):
    raw = body if isinstance(body, str) else json.dumps(body)
    event = {"body": base64.b64encode(raw.encode()).decode() if base64_body else raw, "isBase64Encoded": base64_body}
    if session_id:
        event["pathParameters"] = {"id": session_id, "part": part}
    return relay.write(event, store=store)


def get(store, session_id, part):
    return relay.read({"pathParameters": {"id": session_id, "part": part}}, store=store)


def test_a_session_round_trips(store):
    created = post(store, {"for": "check-in", "request": {"elements": []}})
    assert created["statusCode"] == 201
    session_id = json.loads(created["body"])["id"]
    assert relay.SESSION_ID.match(session_id)
    assert json.loads(get(store, session_id, "request")["body"]) == {"for": "check-in", "request": {"elements": []}}
    assert get(store, session_id, "response")["statusCode"] == 204
    assert post(store, {"answer": "shared"}, session_id, "response")["statusCode"] == 204
    assert json.loads(get(store, session_id, "response")["body"]) == {"answer": "shared"}
    assert post(store, {"trip": {}}, session_id, "pass", base64_body=True)["statusCode"] == 204
    assert get(store, session_id, "pass")["statusCode"] == 200
    assert get(store, session_id, "pass")["headers"]["cache-control"] == "no-store"


def test_each_id_is_new_and_unguessable(store):
    ids = {json.loads(post(store, {})["body"])["id"] for _ in range(50)}
    assert len(ids) == 50 and all(len(i) == 22 for i in ids)


def test_an_answer_is_written_once(store):
    session_id = json.loads(post(store, {})["body"])["id"]
    assert post(store, {"answer": "shared"}, session_id, "response")["statusCode"] == 204
    assert post(store, {"answer": "declined"}, session_id, "response")["statusCode"] == 409
    assert json.loads(get(store, session_id, "response")["body"]) == {"answer": "shared"}


def test_the_pass_follows_an_answer(store):
    session_id = json.loads(post(store, {})["body"])["id"]
    assert post(store, {"trip": {}}, session_id, "pass")["statusCode"] == 409


def test_the_request_is_written_only_when_the_session_starts(store):
    session_id = json.loads(post(store, {"first": True})["body"])["id"]
    assert post(store, {"second": True}, session_id, "request")["statusCode"] == 404
    assert json.loads(get(store, session_id, "request")["body"]) == {"first": True}


def test_an_expired_session_is_gone_before_its_item_is(store):
    session_id = json.loads(post(store, {})["body"])["id"]
    store.table.items[session_id]["expires"] = 0
    assert get(store, session_id, "request")["statusCode"] == 404
    assert post(store, {"answer": "shared"}, session_id, "response")["statusCode"] == 404


def test_unknown_or_malformed_ids_find_nothing(store):
    assert get(store, "A" * 22, "request")["statusCode"] == 404
    assert get(store, "../../etc", "request")["statusCode"] == 404
    assert post(store, {}, "A" * 22, "response")["statusCode"] == 404


def test_only_json_objects_within_the_limit_are_stored(store):
    assert post(store, "not json")["statusCode"] == 400
    assert post(store, [1, 2])["statusCode"] == 400
    assert post(store, {"pad": "x" * relay.MAX_BYTES})["statusCode"] == 413
    assert not store.table.items
