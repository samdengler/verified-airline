'use strict';

/**
 * The support chat as an Agentic CX designer application.
 *
 * The canvas routes and relays: it greets once, and sends every question to the airline
 * agent through the agents gateway as one A2A message/send, with the chat's mode and the
 * contact ID in the message's metadata. The agent answers, checks the answer in verified
 * mode, records the turn, and returns the text the traveler is shown; the canvas relays
 * that text. It has no generative node of its own, so every answer comes from the agent
 * and the guardrail sits in one place.
 *
 * Its wording comes from content/chat.json, where the renderer checks it.
 *
 * The contact flow (chat/scripts/contact_flow.py) puts the contact attributes `mode` and
 * `agentsToken`, which the chat start sets, into the context variables of the same names.
 */

const crypto = require('crypto');
const questions = require('../questions.json').questions;
const wording = require('../../content/chat.json').traveler;

const CONV = '{System.conversationId:NLX.System}';
const UTTERANCE = '{System.utterance:NLX.System}';
const FLOW = 'AskFlow';
const ASK = 'Ask';

const CONTEXT_VARIABLES = [
  { name: 'mode', schema: { type: 'string' }, disallowExternalModification: false },
  { name: 'agentsToken', schema: { type: 'string' }, disallowExternalModification: false },
  { name: 'greeted', schema: { type: 'number' }, disallowExternalModification: false },
];

const hdr = (key, value, extra = {}) => ({ key, value, ...extra });

/** The agent's reply: the text the traveler is shown, then the turn's number and state. */
const A2A_REPLY_SCHEMA = {
  type: 'object',
  properties: {
    jsonrpc: { type: 'string' },
    result: {
      type: 'object',
      properties: {
        contextId: { type: 'string' },
        parts: {
          type: 'array',
          items: {
            type: 'object',
            properties: { kind: { type: 'string' }, text: { type: 'string' }, data: { type: 'object' } },
          },
        },
      },
    },
  },
};

function askDataRequest(gatewayUrl) {
  const url = `${gatewayUrl}/airline/invocations`;
  const headers = [
    hdr('Authorization', 'Bearer {agentsToken:NLX.Context}', { sensitive: true }),
    hdr('Content-Type', 'application/json'),
    // One runtime session per chat; a contact ID is long enough for one.
    hdr('X-Amzn-Bedrock-AgentCore-Runtime-Session-Id', CONV),
  ];
  return {
    dataRequestId: ASK,
    type: 'object',
    description: 'The airline agent over A2A, through the agents gateway.',
    webhook: {
      implementation: 'external',
      method: 'POST',
      environments: { production: { url, headers }, development: { url, headers } },
    },
    responseSchema: A2A_REPLY_SCHEMA,
  };
}

/** The A2A body as a JSON string template: the runtime fills and escapes each placeholder. */
const ASK_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: CONV,
  method: 'message/send',
  params: {
    message: {
      role: 'user',
      messageId: CONV,
      contextId: CONV,
      parts: [{ kind: 'text', text: UTTERANCE }],
      metadata: { mode: '{mode:NLX.Context}', contact: CONV },
    },
  },
});

/** Node IDs derived from the flow and a readable name, so a redeploy updates the same nodes. */
function nodeId(name) {
  const h = crypto.createHash('sha1').update(`${FLOW}/${name}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const text = (body) => ({ type: 'text', body, metadata: { alternatePhrasings: [] } });
const statusIs = (value) => ({ left: { type: 'node_status' }, operator: 'eq', right: { type: 'constant', value } });
const capturedFlow = (operator) => [{ left: { type: 'captured_flow' }, operator }];

function node(name, type, { children = [], messages = [], metadata = {}, dataRequests } = {}) {
  return {
    nodeId: nodeId(name),
    type,
    childNodes: children.map((c) =>
      typeof c === 'string'
        ? { nodeId: nodeId(c), conditions: [] }
        : { nodeId: nodeId(c.to), conditions: c.when ?? [], ...(c.name ? { name: c.name } : {}) },
    ),
    messages: messages.map(text),
    modalities: {},
    metadata: { stateModifications: [], name, ...metadata },
    ...(dataRequests ? { dataRequests } : {}),
  };
}

function askFlow() {
  const nodes = [
    node('start', 'start', { children: ['guard'] }),
    node('guard', 'choice', {
      children: [
        { to: 'listen', when: [{ left: { type: 'context', name: 'greeted' }, operator: 'gte', right: { type: 'constant', value: 1 } }] },
        'greet',
      ],
    }),
    node('greet', 'basic', {
      children: ['listen'],
      messages: [wording.greeting],
      metadata: { stateModifications: [{ type: 'context', name: 'greeted', modification: 'set', value: { type: 'constant', value: 1 } }] },
    }),
    // A user_input node with an unconditional edge does not wait for input (guppi-hr's
    // canvas notes), so both cases are spelled out.
    node('listen', 'user_input', {
      children: [
        { to: 'ask', when: capturedFlow('exists'), name: 'recognized' },
        { to: 'ask', when: capturedFlow('not_exists'), name: 'unrecognized' },
      ],
    }),
    node('ask', 'data_request', {
      children: [
        { to: 'route', when: [statusIs('success')] },
        { to: 'unreachable', when: [statusIs('failure')] },
        { to: 'unreachable', when: [statusIs('timeout')] },
      ],
      dataRequests: [{ dataRequestId: ASK, name: ASK, headers: {}, payload: ASK_BODY, alwaysRetrigger: true }],
      metadata: { timeout: 30000 },
    }),
    node('route', 'choice', {
      children: [{ to: 'reply', when: [{ left: { type: 'variable', name: `${ASK}.result.parts.0.text` }, operator: 'exists' }] }, 'unreachable'],
    }),
    node('reply', 'basic', { children: ['toListen'], messages: [`{${ASK}.result.parts.0.text:NLX.Variable}`] }),
    node('unreachable', 'basic', {
      children: ['toListen'],
      messages: [wording.unreachable],
    }),
    // A second user_input reached in the same turn re-reads that turn's utterance, so a
    // reply ends the turn with a redirect to the listen node.
    node('toListen', 'redirect', { children: ['end'], metadata: { redirect: { type: 'flow', flowId: FLOW, nodeId: nodeId('listen') } } }),
    node('end', 'end'),
  ];
  return {
    flowId: FLOW,
    description: 'Greets once, then sends every question to the airline agent and relays its reply.',
    aiDescription: "A traveler's question about Verified Airline: fares, changes, cancellations, refunds and fees.",
    utterances: questions.filter((q) => q.kind === 'direct').slice(0, 12).map((q) => ({ text: q.question })),
    contextVariables: [
      { name: 'mode', type: 'text' },
      { name: 'agentsToken', type: 'text' },
      { name: 'greeted', type: 'number' },
    ],
    nodes: Object.fromEntries(nodes.map((n) => [n.nodeId, n])),
  };
}

const APPLICATION = {
  name: 'verified-airline-chat',
  description: "Verified Airline's support chat: relays each question to the airline agent.",
  flows: [{ flowId: FLOW }],
  settings: {
    languageCode: 'en-US',
    languageCodes: ['en-US'],
    defaultFlows: { welcome: { flowId: FLOW }, unknown: { flowId: FLOW } },
  },
};

module.exports = { CONTEXT_VARIABLES, askDataRequest, askFlow, APPLICATION };
