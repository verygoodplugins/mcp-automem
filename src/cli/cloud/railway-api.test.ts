import { describe, expect, it } from 'vitest';
import {
  deployTemplate,
  fetchTemplateConfig,
  provisionTemplate,
  RAILWAY_GRAPHQL_ENDPOINT,
} from './railway-api.js';
import type { FetchResponse } from './types.js';

function jsonResponse(body: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('railway-api', () => {
  it('targets the backboard v2 GraphQL endpoint', () => {
    expect(RAILWAY_GRAPHQL_ENDPOINT).toBe('https://backboard.railway.com/graphql/v2');
  });

  it('fetchTemplateConfig queries the template UNAUTHENTICATED and returns id + serializedConfig', async () => {
    const calls: Array<{ url: string; auth: string | undefined; body: string }> = [];
    const fetchFn = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      calls.push({ url, auth: init?.headers?.Authorization, body: init?.body ?? '' });
      return jsonResponse({ data: { template: { id: 'tmpl-1', name: 'AutoMem', serializedConfig: { services: { a: {} } } } } });
    };
    const res = await fetchTemplateConfig('automem-ai-memory-service', { fetchFn });
    expect(res.templateId).toBe('tmpl-1');
    expect(res.serializedConfig).toEqual({ services: { a: {} } });
    expect(calls[0].url).toBe(RAILWAY_GRAPHQL_ENDPOINT);
    // The template query MUST be public — with a Bearer token Railway returns
    // "Not Authorized" for a template you don't own.
    expect(calls[0].auth).toBeUndefined();
    expect(calls[0].body).toContain('automem-ai-memory-service');
  });

  it('fetchTemplateConfig throws when the GraphQL response carries errors', async () => {
    const fetchFn = async () => jsonResponse({ errors: [{ message: 'Not Authorized' }], data: null });
    await expect(fetchTemplateConfig('x', { fetchFn })).rejects.toThrow(/not authorized|template/i);
  });

  it('deployTemplate posts templateDeployV2 WITH a Bearer token and returns the workflowId', async () => {
    const calls: Array<{ auth: string | undefined; body: string }> = [];
    const fetchFn = async (_url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      calls.push({ auth: init?.headers?.Authorization, body: init?.body ?? '' });
      return jsonResponse({ data: { templateDeployV2: { projectId: 'p1', workflowId: 'wf-1' } } });
    };
    const res = await deployTemplate(
      { token: 'tok-123', projectId: 'p1', environmentId: 'e1', templateId: 't1', serializedConfig: { services: {} } },
      { fetchFn }
    );
    expect(res.workflowId).toBe('wf-1');
    expect(calls[0].auth).toBe('Bearer tok-123');
    expect(calls[0].body).toContain('templateDeployV2');
  });

  it('deployTemplate throws when the deploy mutation returns an Unauthorized error', async () => {
    const fetchFn = async () => jsonResponse({ errors: [{ message: 'Unauthorized' }], data: null });
    await expect(
      deployTemplate(
        { token: 't', projectId: 'p', environmentId: 'e', templateId: 'ti', serializedConfig: {} },
        { fetchFn }
      )
    ).rejects.toThrow(/unauthorized|deploy/i);
  });

  it('provisionTemplate fetches config (public) THEN deploys (authed), returning the workflowId', async () => {
    const auths: Array<string | undefined> = [];
    const fetchFn = async (_url: string, init?: { headers?: Record<string, string> }) => {
      auths.push(init?.headers?.Authorization);
      if (auths.length === 1) {
        return jsonResponse({ data: { template: { id: 'ti', name: 'X', serializedConfig: { services: {} } } } });
      }
      return jsonResponse({ data: { templateDeployV2: { workflowId: 'wf' } } });
    };
    const res = await provisionTemplate(
      { token: 'tok', projectId: 'p', environmentId: 'e', templateCode: 'automem-ai-memory-service' },
      { fetchFn }
    );
    expect(res.workflowId).toBe('wf');
    expect(auths[0]).toBeUndefined(); // template fetch is public
    expect(auths[1]).toBe('Bearer tok'); // deploy is authed
  });
});
