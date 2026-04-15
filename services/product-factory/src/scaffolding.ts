import type { ProductSpec, ScaffoldResult, ScaffoldFile, ScaffoldTemplate } from './types.js';

/**
 * Generates a file tree scaffold for a given template and product spec.
 * Returns a JSON description of files — does NOT create actual files.
 */
export class ScaffoldGenerator {
  generateScaffold(template: ScaffoldTemplate, spec: ProductSpec): ScaffoldResult {
    const builders: Record<ScaffoldTemplate, (spec: ProductSpec) => ScaffoldFile[]> = {
      'nextjs-landing': this.nextjsLanding,
      'fastify-api': this.fastifyApi,
      'expo-mobile': this.expoMobile,
    };

    const files = builders[template](spec);

    return {
      template,
      files,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Template builders ──

  private nextjsLanding(spec: ProductSpec): ScaffoldFile[] {
    const featureList = spec.structured.features.map((f) => f.title).join(', ');

    return [
      { path: 'package.json', description: 'Project manifest with Next.js and React dependencies', contentHint: '{ "name": "landing", "dependencies": { "next": "^15", "react": "^19" } }' },
      { path: 'tsconfig.json', description: 'TypeScript configuration for Next.js', contentHint: '{ "extends": "next/core-web-vitals" }' },
      { path: 'next.config.ts', description: 'Next.js configuration', contentHint: 'export default { output: "standalone" }' },
      { path: 'app/layout.tsx', description: 'Root layout with metadata and font loading', contentHint: `<html><body>{children}</body></html> — title: "${spec.structured.problem}"` },
      { path: 'app/page.tsx', description: 'Landing page with hero, features, and CTA sections', contentHint: `Hero section for "${spec.structured.problem}", features: ${featureList}` },
      { path: 'app/globals.css', description: 'Global styles with CSS custom properties', contentHint: ':root { --primary: #0066ff; } body { font-family: system-ui; }' },
      { path: 'components/hero.tsx', description: 'Hero section component with headline and CTA', contentHint: `Headline targeting "${spec.structured.targetUser}"` },
      { path: 'components/features.tsx', description: 'Feature grid component', contentHint: `Grid of ${spec.structured.features.length} feature cards with MoSCoW badges` },
      { path: 'components/cta.tsx', description: 'Call-to-action section with signup form', contentHint: 'Email capture form with submit handler' },
      { path: 'components/footer.tsx', description: 'Footer with links and legal', contentHint: 'Copyright, privacy policy, terms links' },
      { path: 'public/favicon.ico', description: 'Favicon placeholder', contentHint: 'Default Next.js favicon' },
      { path: '.env.example', description: 'Environment variable template', contentHint: 'NEXT_PUBLIC_API_URL=http://localhost:3000/api' },
    ];
  }

  private fastifyApi(spec: ProductSpec): ScaffoldFile[] {
    const mustFeatures = spec.structured.features
      .filter((f) => f.priority === 'must')
      .map((f) => f.title);
    const routeHint = mustFeatures.length > 0
      ? `Routes for: ${mustFeatures.join(', ')}`
      : 'CRUD routes for primary resource';

    return [
      { path: 'package.json', description: 'Project manifest with Fastify and TypeScript', contentHint: '{ "name": "api", "dependencies": { "fastify": "^5", "@fastify/cors": "^10" } }' },
      { path: 'tsconfig.json', description: 'TypeScript strict configuration', contentHint: '{ "strict": true, "target": "ES2024", "module": "Node16" }' },
      { path: 'src/server.ts', description: 'Fastify server bootstrap and plugin registration', contentHint: 'fastify().listen({ port: 3000 })' },
      { path: 'src/routes/health.ts', description: 'Health check endpoint', contentHint: 'GET /health → { status: "ok" }' },
      { path: 'src/routes/api.ts', description: 'Primary API routes', contentHint: routeHint },
      { path: 'src/schemas/index.ts', description: 'Zod schemas for request/response validation', contentHint: `Schemas for ${spec.structured.features.length} features` },
      { path: 'src/services/index.ts', description: 'Business logic service layer', contentHint: `Service class for "${spec.structured.problem}"` },
      { path: 'src/db/client.ts', description: 'Database client setup', contentHint: `${spec.structured.techStack.includes('PostgreSQL') ? 'PostgreSQL' : 'SQLite'} connection` },
      { path: 'src/db/schema.ts', description: 'Database schema definitions', contentHint: 'Drizzle ORM table definitions' },
      { path: 'Dockerfile', description: 'Multi-stage Docker build', contentHint: 'FROM node:22-alpine, build stage + production stage' },
      { path: '.env.example', description: 'Environment variable template', contentHint: 'DATABASE_URL=postgresql://localhost:5432/app' },
      { path: 'vitest.config.ts', description: 'Test configuration', contentHint: 'Vitest with v8 coverage provider' },
    ];
  }

  private expoMobile(spec: ProductSpec): ScaffoldFile[] {
    const journeySteps = spec.structured.userJourney;
    const screenCount = Math.max(journeySteps.length, 3);

    return [
      { path: 'package.json', description: 'Expo project manifest', contentHint: '{ "name": "mobile", "dependencies": { "expo": "~52", "react-native": "0.76" } }' },
      { path: 'tsconfig.json', description: 'TypeScript configuration for Expo', contentHint: '{ "extends": "expo/tsconfig.base" }' },
      { path: 'app.json', description: 'Expo app configuration', contentHint: `{ "expo": { "name": "${spec.structured.problem.slice(0, 30)}" } }` },
      { path: 'app/_layout.tsx', description: 'Root layout with navigation stack', contentHint: `Stack navigator with ${screenCount} screens` },
      { path: 'app/index.tsx', description: 'Home screen with primary feature access', contentHint: `Entry point for "${spec.structured.targetUser}"` },
      { path: 'app/onboarding.tsx', description: 'Onboarding flow screen', contentHint: `${journeySteps.length}-step onboarding carousel` },
      { path: 'app/dashboard.tsx', description: 'Dashboard screen with key metrics', contentHint: 'Card grid showing status and metrics' },
      { path: 'components/Button.tsx', description: 'Reusable button component with variants', contentHint: 'primary | secondary | ghost variants' },
      { path: 'components/Card.tsx', description: 'Card component for content display', contentHint: 'Pressable card with title, description, icon' },
      { path: 'lib/api.ts', description: 'API client for backend communication', contentHint: 'fetch wrapper with auth token injection' },
      { path: 'lib/store.ts', description: 'Global state management', contentHint: 'Zustand store for user and app state' },
      { path: 'assets/icon.png', description: 'App icon placeholder', contentHint: '1024x1024 PNG app icon' },
      { path: '.env.example', description: 'Environment variable template', contentHint: 'EXPO_PUBLIC_API_URL=http://localhost:3000' },
    ];
  }
}
