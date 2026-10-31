"""One turn of the support chat.

The agent searches the knowledge base through the tools gateway's MCP tool,
wrapped so the model passes plain text, and answers from what it returns.  In "kb" mode that answer is the reply; in
"verified" mode the same answer also goes through the Automated Reasoning
guardrail, and the reply carries the guardrail's result as returned.  Either
way the turn records the chunks retrieval returned, so a slip can be traced.
"""

import os
import time
import uuid

import boto3
from strands import Agent, tool
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient

from airline_agent.check import check
from airline_agent.sigv4 import SigV4

REGION = os.environ.get("AWS_REGION", "us-east-1")
MODES = ("kb", "verified")
# One or two sentences in both modes: each added claim in an answer is one
# more statement for the check's translation to disagree on, and a long
# answer drew TRANSLATION_AMBIGUOUS twice as often in step 2.
SYSTEM = (
    "You answer travelers' questions for Verified Airline, a fictional airline. Before you answer, search the "
    "airline's documents with the retrieval tool, and answer only from what it returns. Answer in one or two plain "
    "sentences that give the decision: for a change, whether it is allowed and what it costs; for a cancellation, "
    "what it gives back; with amounts in US dollars. Do not add examples or cases the traveler did not ask about. "
    "If the documents do not answer the question, or say it is still being decided, say so and suggest contacting "
    "Verified Airline."
)


def search_tool(tools):
    """The knowledge base search, as a tool that takes the query as plain text.

    The gateway's Retrieve wants {"retrievalQuery": {"text": ...}}, and the
    model's first call on every turn passed the query as a bare string, which
    Retrieve refused; each turn then cost a second model call to retry."""
    name = next(t.tool_name for t in tools.list_tools_sync() if t.tool_name.endswith("___Retrieve"))

    @tool
    def search_documents(query: str) -> str:
        """Search Verified Airline's documents on fares, changes and cancellations.

        Args:
            query: What to look up, in plain words.
        """
        result = tools.call_tool_sync(uuid.uuid4().hex, name, {"retrievalQuery": {"text": query}})
        text = "\n".join(c["text"] for c in result["content"] if "text" in c)
        if result["status"] != "success":
            raise RuntimeError(text)
        return text

    return search_documents


def retrieved(messages):
    """The text of every tool result in the conversation."""
    out = []
    for m in messages:
        for block in m.get("content", []):
            result = block.get("toolResult")
            if result:
                out += [c["text"] for c in result.get("content", []) if "text" in c]
    return out


def answer(question, mode="kb"):
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    session = boto3.Session(region_name=REGION)
    model_id = os.environ["MODEL_ID"]
    tools = MCPClient(url=os.environ["TOOLS_GATEWAY_URL"], auth_provider=SigV4(session, REGION))
    started = time.monotonic()
    with tools:
        agent = Agent(
            model=BedrockModel(model_id=model_id, boto_session=session),
            tools=[search_tool(tools)],
            system_prompt=SYSTEM,
            callback_handler=None,
        )
        reply = str(agent(question)).strip()
        chunks = retrieved(agent.messages)
    turn = {"mode": mode, "question": question, "answer": reply, "model": model_id, "retrieved": chunks,
            "ms": {"answer": round((time.monotonic() - started) * 1000)},
            # Where the documents and the policy came from, for the answer certificate.
            "provenance": {"leanModelCommit": os.environ.get("LEAN_MODEL_COMMIT"),
                           "policyVersion": os.environ.get("POLICY_VERSION_ARN"),
                           "guardrailVersion": os.environ.get("GUARDRAIL_VERSION")}}
    if mode == "verified":
        runtime = session.client("bedrock-runtime")
        turn["check"] = check(runtime, os.environ["GUARDRAIL_ID"], os.environ["GUARDRAIL_VERSION"], question, reply)
        turn["ms"]["check"] = turn["check"]["ms"]
    return turn
