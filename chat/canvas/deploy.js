'use strict';

/**
 * Create or update the canvas in the designer's workspace, build it, deploy it to
 * production, and write the deployment to build/chat/canvas.json for
 * chat/scripts/contact_flow.py.
 *
 *   node deploy.js              # everything
 *   node deploy.js --no-build   # the resources only
 *
 * The agents gateway's URL comes from the VerifiedAirlineChat stack's outputs. The API key
 * is read from ~/.config/verified-airline/acxd_api_key (mode 600, saved by Sam) and is
 * never logged or stored in the repository.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const sdk = require('amazon-connect-acxd-sdk');
const canvas = require('./canvas');

const REGION = 'us-east-1';
const WORKSPACE_ID = 'e600f20d-566d-4bea-8eab-d9b567076159';
const KEY_FILE = path.join(os.homedir(), '.config', 'verified-airline', 'acxd_api_key');
const STATE = path.join(__dirname, '..', '..', 'build', 'chat', 'canvas.json');
const ENVIRONMENT = 'production';

const mask = (message) => String(message).replace(/acxd_live_[A-Za-z0-9.]+/g, 'acxd_live_***');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stackOutput(key) {
  const out = execFileSync('aws', ['cloudformation', 'describe-stacks', '--stack-name', 'VerifiedAirlineChat',
    '--region', REGION, '--query', `Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue`, '--output', 'text'],
  { encoding: 'utf8' }).trim();
  if (!out || out === 'None') throw new Error(`the VerifiedAirlineChat stack has no output ${key}; deploy it first`);
  return out;
}

async function listAll(client, Command, input = {}) {
  const items = [];
  let nextToken;
  do {
    const page = await client.send(new Command({ ...input, ...(nextToken ? { nextToken } : {}) }));
    items.push(...(page.items ?? []));
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

/** Update the resource if one with the key exists, else create it. */
async function upsert(client, { List, Create, Update, key, identifier, resource }) {
  const existing = await listAll(client, List);
  if (existing.some((r) => r[key] === resource[key])) {
    const { [key]: id, ...rest } = resource;
    await client.send(new Update({ [identifier]: id, ...rest }));
    return 'updated';
  }
  await client.send(new Create(resource));
  return 'created';
}

async function upsertApplication(client, application) {
  const match = (await listAll(client, sdk.ListApplicationsCommand)).find((a) => a.name === application.name);
  if (match) {
    await client.send(new sdk.UpdateApplicationCommand({ applicationIdentifier: match.applicationId, ...application }));
    return match.applicationId;
  }
  return (await client.send(new sdk.CreateApplicationCommand(application))).applicationId;
}

async function build(client, applicationId) {
  const { buildId } = await client.send(new sdk.CreateApplicationBuildCommand({
    applicationIdentifier: applicationId, description: 'deploy.js',
  }));
  const deadline = Date.now() + 10 * 60 * 1000;
  for (;;) {
    const b = await client.send(new sdk.GetApplicationBuildCommand({ applicationIdentifier: applicationId, buildIdentifier: buildId }));
    if (b.status === 'BUILT') return buildId;
    if (!['PENDING', 'IN_PROGRESS', 'BUILDING'].includes(b.status)) {
      throw Object.assign(new Error(`build ${buildId} ended ${b.status}`), { build: b });
    }
    if (Date.now() > deadline) throw new Error(`build ${buildId} still ${b.status}`);
    await sleep(5000);
  }
}

/** Deploy a build, replacing the environment's deployment; an application holds one. */
async function deploy(client, applicationId, buildId) {
  const ids = { applicationIdentifier: applicationId };
  const current = ((await client.send(new sdk.ListApplicationDeploymentsCommand(ids))).items ?? [])
    .find((d) => d.environment === ENVIRONMENT);
  const spec = { ...ids, buildIdentifier: buildId, environment: ENVIRONMENT, languageCodes: ['en-US'] };
  if (current) {
    try {
      await client.send(new sdk.UpdateApplicationDeploymentCommand({ ...spec, deploymentIdentifier: current.deploymentId }));
      return client.send(new sdk.GetApplicationDeploymentCommand({ ...ids, deploymentIdentifier: current.deploymentId }));
    } catch {
      await client.send(new sdk.DeleteApplicationDeploymentCommand({ ...ids, deploymentIdentifier: current.deploymentId }));
    }
  }
  const { deploymentId } = await client.send(new sdk.CreateApplicationDeploymentCommand({ ...spec, description: 'deploy.js' }));
  return client.send(new sdk.GetApplicationDeploymentCommand({ ...ids, deploymentIdentifier: deploymentId }));
}

(async () => {
  const apiKey = fs.readFileSync(KEY_FILE, 'utf8').trim();
  const client = new sdk.AgenticCXDesignerClient({ region: REGION, apiKey, workspaceId: WORKSPACE_ID });
  const gatewayUrl = stackOutput('AgentsGatewayUrl').replace(/\/(mcp)?$/, '');
  try {
    for (const v of canvas.CONTEXT_VARIABLES) {
      const action = await upsert(client, { List: sdk.ListContextVariablesCommand, Create: sdk.CreateContextVariableCommand,
        Update: sdk.UpdateContextVariableCommand, key: 'name', identifier: 'contextVariableIdentifier', resource: v });
      console.log(`context variable ${v.name}: ${action}`);
    }
    const ask = canvas.askDataRequest(gatewayUrl);
    console.log(`data request ${ask.dataRequestId}: ${await upsert(client, { List: sdk.ListDataRequestsCommand,
      Create: sdk.CreateDataRequestCommand, Update: sdk.UpdateDataRequestCommand, key: 'dataRequestId',
      identifier: 'dataRequestIdentifier', resource: ask })}`);
    const flow = { utterances: [], untrained: false, mainLanguageCode: 'en-US', languageCodes: ['en-US'], slotTypes: [], ...canvas.askFlow() };
    console.log(`flow ${flow.flowId}: ${await upsert(client, { List: sdk.ListFlowsCommand, Create: sdk.CreateFlowCommand,
      Update: sdk.UpdateFlowCommand, key: 'flowId', identifier: 'flowIdentifier', resource: flow })}`);
    const applicationId = await upsertApplication(client, canvas.APPLICATION);
    console.log(`application ${canvas.APPLICATION.name}: ${applicationId}`);
    if (process.argv.includes('--no-build')) return;

    console.log('building ...');
    const buildId = await build(client, applicationId);
    const d = await deploy(client, applicationId, buildId);
    console.log(`deployment ${d.deploymentId}: ${d.deploymentStatus}, alias ${d.deploymentAlias}`);
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({
      workspaceId: WORKSPACE_ID, applicationId, buildId, deploymentId: d.deploymentId,
      deploymentAlias: d.deploymentAlias, environment: ENVIRONMENT, deployedAt: new Date().toISOString(),
    }, null, 2));
  } catch (e) {
    console.error('deploy failed:', e.name, mask(e.message));
    if (e.fieldList) console.error(JSON.stringify(e.fieldList, null, 2));
    if (e.build) console.error(JSON.stringify(e.build, null, 2).slice(0, 4000));
    process.exitCode = 1;
  }
})();
