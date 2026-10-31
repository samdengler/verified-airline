"""SigV4 signing for the MCP client: the tools gateway authorizes callers by
IAM, so each request is signed with the runtime's role."""

import httpx
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest


class SigV4(httpx.Auth):
    requires_request_body = True

    def __init__(self, session, region, service="bedrock-agentcore"):
        self.session, self.region, self.service = session, region, service

    def auth_flow(self, request):
        credentials = self.session.get_credentials().get_frozen_credentials()
        headers = {"host": request.url.host}
        if "content-type" in request.headers:
            headers["content-type"] = request.headers["content-type"]
        signed = AWSRequest(method=request.method, url=str(request.url), data=request.content, headers=headers)
        SigV4Auth(credentials, self.service, self.region).add_auth(signed)
        for name, value in signed.headers.items():
            request.headers[name] = value
        yield request
