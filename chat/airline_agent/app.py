"""The agent on AgentCore Runtime: POST /invocations with
{"question": "...", "mode": "kb" | "verified"} answers one turn."""

from bedrock_agentcore.runtime import BedrockAgentCoreApp

from airline_agent.agent import answer

app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload):
    payload = payload or {}
    question = payload.get("question") or payload.get("prompt") or ""
    if not question.strip():
        return {"error": "no question"}
    return answer(question, payload.get("mode", "kb"))


if __name__ == "__main__":
    app.run()
