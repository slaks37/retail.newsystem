import { bindings, defineConfig } from 'cf/config';
export default defineConfig({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  worker: {
    name: 'retail-newsystem',
    entrypoint: './server/index.ts',
    compatibilityDate: '2026-11-08',
    assets: { notFoundHandling: 'single-page-application', runWorkerFirst: true },
    env: {
      ASSETS: bindings.assets(),
      DATABASE_URL: bindings.secret(),
      SESSION_SECRET: bindings.secret(),
      BUSINESS_ID: bindings.text('00000000-0000-4000-8000-000000000001'),
    },
    placement: { region: process.env.WORKER_REGION ?? 'aws:ap-southeast-1' },
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: true, headSamplingRate: 0.1 },
      traces: { enabled: true, headSamplingRate: 0.1 },
    },
  },
});
