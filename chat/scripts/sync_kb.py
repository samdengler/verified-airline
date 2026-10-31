"""Upload the knowledge base's documents and ingest them.

  uv run scripts/sync_kb.py

The documents are what scripts/export_chat.py writes to build/chat/kb/.  They
go to the knowledge base bucket under kb/, any document the exporter no longer
writes is deleted there, and an ingestion job runs to completion, so the
knowledge base matches the model's files when this returns.
"""

import sys
import time
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[2]
KB_DIR = ROOT / "build" / "chat" / "kb"
PREFIX = "kb/"
REGION = "us-east-1"


def outputs(stack):
    cf = boto3.client("cloudformation", region_name=REGION)
    (s,) = cf.describe_stacks(StackName=stack)["Stacks"]
    return {o["OutputKey"]: o["OutputValue"] for o in s["Outputs"]}


def main():
    docs = {p.relative_to(KB_DIR).as_posix(): p for p in sorted(KB_DIR.rglob("*.md"))}
    if not docs:
        sys.exit(f"no documents in {KB_DIR}; run python3 scripts/export_chat.py first")
    out = outputs("VerifiedAirlineChat")
    bucket = out["KnowledgeBaseBucketName"]
    s3 = boto3.client("s3", region_name=REGION)
    for name, path in docs.items():
        s3.put_object(Bucket=bucket, Key=PREFIX + name, Body=path.read_bytes(), ContentType="text/markdown")
    stale = [o["Key"] for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX)
             for o in page.get("Contents", []) if o["Key"][len(PREFIX):] not in docs]
    for key in stale:
        s3.delete_object(Bucket=bucket, Key=key)
    agent = boto3.client("bedrock-agent", region_name=REGION)
    job = agent.start_ingestion_job(knowledgeBaseId=out["KnowledgeBaseId"], dataSourceId=out["DataSourceId"])
    job_id = job["ingestionJob"]["ingestionJobId"]
    while True:
        j = agent.get_ingestion_job(knowledgeBaseId=out["KnowledgeBaseId"], dataSourceId=out["DataSourceId"],
                                    ingestionJobId=job_id)["ingestionJob"]
        if j["status"] in ("COMPLETE", "FAILED", "STOPPED"):
            break
        time.sleep(5)
    stats = j.get("statistics", {})
    print(f"uploaded {len(docs)} documents, deleted {len(stale)}; ingestion {j['status'].lower()}: "
          f"{stats.get('numberOfNewDocumentsIndexed', 0)} new, {stats.get('numberOfModifiedDocumentsIndexed', 0)} "
          f"changed, {stats.get('numberOfDocumentsDeleted', 0)} removed, {stats.get('numberOfDocumentsFailed', 0)} failed")
    if j["status"] != "COMPLETE":
        sys.exit(f"ingestion {j['status']}: {j.get('failureReasons')}")


if __name__ == "__main__":
    main()
