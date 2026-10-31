"""The search tool hands Retrieve the query in the shape it wants."""

from types import SimpleNamespace

import pytest

from airline_agent.agent import search_tool


class Gateway:
    def __init__(self, status="success", text="| Cancel after a missed flight | Nothing back |"):
        self.status, self.text, self.calls = status, text, []

    def list_tools_sync(self):
        return [SimpleNamespace(tool_name="docs___Retrieve")]

    def call_tool_sync(self, tool_use_id, name, arguments):
        self.calls.append((name, arguments))
        return {"status": self.status, "toolUseId": tool_use_id, "content": [{"text": self.text}]}


def test_the_query_goes_to_retrieve_as_retrieval_query_text():
    gateway = Gateway()
    search = search_tool(gateway)
    assert search.tool_name == "search_documents"
    assert search("Main fare after a missed flight") == gateway.text
    assert gateway.calls == [("docs___Retrieve", {"retrievalQuery": {"text": "Main fare after a missed flight"}})]


def test_a_failed_retrieve_raises_with_its_message():
    search = search_tool(Gateway(status="error", text="ValidationException"))
    with pytest.raises(RuntimeError, match="ValidationException"):
        search("anything")
