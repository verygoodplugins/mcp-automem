// Railway GraphQL helpers for the installer's guided deploy.
//
// The template lookup is public; the deploy mutation uses the Railway CLI session
// token. fetchFn is injectable so tests do not hit Railway.

import type { FetchLike } from './types.js';

export const RAILWAY_GRAPHQL_ENDPOINT = 'https://backboard.railway.com/graphql/v2';

export interface RailwayApiDeps {
  fetchFn?: FetchLike;
  endpoint?: string;
}

export interface TemplateConfig {
  templateId: string;
  serializedConfig: unknown;
}

const TEMPLATE_QUERY =
  'query TemplateDetail($code:String!){ template(code:$code){ id name serializedConfig } }';

const DEPLOY_MUTATION = `mutation TemplateDeploy($projectId:String!,$environmentId:String!,$templateId:String!,$serializedConfig:SerializedTemplateConfig!){
  templateDeployV2(input:{projectId:$projectId,environmentId:$environmentId,templateId:$templateId,serializedConfig:$serializedConfig}){ projectId workflowId }
}`;

interface GraphQLBody<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

// POST a GraphQL operation and return the typed `data`, throwing on transport
// failures or any `errors[]` the server reports (GraphQL returns 200 + errors for
// auth failures, so HTTP status alone is not enough).
async function post<T>(
  query: string,
  variables: Record<string, unknown>,
  opts: { token?: string; label: string } & RailwayApiDeps
): Promise<T> {
  const fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
  const endpoint = opts.endpoint ?? RAILWAY_GRAPHQL_ENDPOINT;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const res = await fetchFn(endpoint, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  if (!res.json) throw new Error(`Railway ${opts.label} failed: response had no JSON body.`);
  const body = (await res.json()) as GraphQLBody<T>;
  if (body.errors?.length) {
    throw new Error(`Railway ${opts.label} failed: ${body.errors.map((e) => e.message ?? 'unknown').join('; ')}`);
  }
  if (!res.ok) throw new Error(`Railway ${opts.label} failed: HTTP ${res.status}.`);
  if (body.data == null) throw new Error(`Railway ${opts.label} failed: empty response.`);
  return body.data;
}

export async function fetchTemplateConfig(
  templateCode: string,
  deps: RailwayApiDeps = {}
): Promise<TemplateConfig> {
  const data = await post<{ template?: { id?: string; serializedConfig?: unknown } | null }>(
    TEMPLATE_QUERY,
    { code: templateCode },
    { ...deps, label: 'template lookup' } // public: no token
  );
  const template = data.template;
  if (!template?.id) {
    throw new Error(`Railway template lookup failed: no template found for code "${templateCode}".`);
  }
  return { templateId: template.id, serializedConfig: template.serializedConfig };
}

export async function deployTemplate(
  args: {
    token: string;
    projectId: string;
    environmentId: string;
    templateId: string;
    serializedConfig: unknown;
  },
  deps: RailwayApiDeps = {}
): Promise<{ workflowId: string }> {
  const data = await post<{ templateDeployV2?: { workflowId?: string } | null }>(
    DEPLOY_MUTATION,
    {
      projectId: args.projectId,
      environmentId: args.environmentId,
      templateId: args.templateId,
      serializedConfig: args.serializedConfig,
    },
    { ...deps, token: args.token, label: 'template deploy' }
  );
  const workflowId = data.templateDeployV2?.workflowId;
  if (!workflowId) throw new Error('Railway template deploy failed: no workflowId returned.');
  return { workflowId };
}

// Compose the two: fetch the template config (public) then deploy it (authed).
// This is what the provider's default API-deploy uses.
export async function provisionTemplate(
  args: { token: string; projectId: string; environmentId: string; templateCode: string },
  deps: RailwayApiDeps = {}
): Promise<{ workflowId: string }> {
  const { templateId, serializedConfig } = await fetchTemplateConfig(args.templateCode, deps);
  return deployTemplate(
    {
      token: args.token,
      projectId: args.projectId,
      environmentId: args.environmentId,
      templateId,
      serializedConfig,
    },
    deps
  );
}
