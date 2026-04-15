import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { founderProfiles, founderAssessments, founderStrengths } from '@helm-pilot/db/schema';
import {
  AnalyzeFounderInput,
  CreateCofounderCandidateInput,
  CreateCofounderNoteInput,
  CreateCofounderOutreachDraftInput,
  CreateFounderProfileInput,
} from '@helm-pilot/shared/schemas';
import { type GatewayDeps } from '../index.js';
import { getWorkspaceId } from '../lib/workspace.js';

export function founderRoutes(deps: GatewayDeps) {
  const app = new Hono();

  app.get('/profile', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const profile = deps.founderIntel
      ? await deps.founderIntel.getProfile(workspaceId)
      : await getFounderProfileFallback(deps, workspaceId);

    if (!profile) return c.json({ error: 'No founder profile found' }, 404);
    return c.json(profile);
  });

  app.post('/profile', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const raw = await c.req.json();
    const parsed = CreateFounderProfileInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const profile = await upsertFounderProfile(deps, workspaceId, parsed.data);
    return c.json(profile, 201);
  });

  app.post('/analyze', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);

    const raw = await c.req.json();
    const parsed = AnalyzeFounderInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    if (!deps.founderIntel) {
      return c.json({ error: 'Founder analysis requires an LLM provider' }, 503);
    }

    const result = await deps.founderIntel.processIntake(workspaceId, parsed.data.rawText);
    return c.json(result, 201);
  });

  app.get('/candidates', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    if (!deps.cofounderEngine) return c.json({ error: 'Cofounder engine unavailable' }, 503);

    const candidates = await deps.cofounderEngine.listCandidates(workspaceId);
    return c.json(candidates);
  });

  app.post('/candidates', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    if (!deps.cofounderEngine) return c.json({ error: 'Cofounder engine unavailable' }, 503);

    const raw = await c.req.json();
    const parsed = CreateCofounderCandidateInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const candidate = await deps.cofounderEngine.createCandidate(workspaceId, parsed.data);
    return c.json(candidate, 201);
  });

  app.get('/candidates/:id', async (c) => {
    if (!deps.cofounderEngine) return c.json({ error: 'Cofounder engine unavailable' }, 503);

    const { id } = c.req.param();
    const candidate = await deps.cofounderEngine.getCandidate(id);
    if (!candidate) return c.json({ error: 'Candidate not found' }, 404);
    return c.json(candidate);
  });

  app.post('/candidates/:id/score', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    if (!deps.cofounderEngine) return c.json({ error: 'Cofounder engine unavailable' }, 503);

    const { id } = c.req.param();
    try {
      const evaluation = await deps.cofounderEngine.scoreCandidate(workspaceId, id);
      return c.json(evaluation, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed to score candidate' }, 404);
    }
  });

  app.post('/candidates/:id/notes', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    if (!deps.cofounderEngine) return c.json({ error: 'Cofounder engine unavailable' }, 503);

    const raw = await c.req.json();
    const parsed = CreateCofounderNoteInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const { id } = c.req.param();
    const note = await deps.cofounderEngine.addCandidateNote(
      workspaceId,
      id,
      parsed.data.content,
      parsed.data.noteType,
      c.get('userId'),
    );
    return c.json(note, 201);
  });

  app.post('/candidates/:id/outreach', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    if (!deps.cofounderEngine) return c.json({ error: 'Cofounder engine unavailable' }, 503);

    const raw = await c.req.json();
    const parsed = CreateCofounderOutreachDraftInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const { id } = c.req.param();
    const draft = await deps.cofounderEngine.createOutreachDraft(workspaceId, id, parsed.data);
    return c.json(draft, 201);
  });

  app.post('/candidates/:id/follow-ups', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: 'workspaceId required' }, 400);
    if (!deps.cofounderEngine) return c.json({ error: 'Cofounder engine unavailable' }, 503);

    const { id } = c.req.param();
    const body = (await c.req.json()) as { dueAt?: string; note?: string };
    const followUp = await deps.cofounderEngine.createFollowUp(workspaceId, id, {
      dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
      note: body.note,
    });
    return c.json(followUp, 201);
  });

  // Legacy compatibility routes while surfaces migrate.
  app.get('/:workspaceId', async (c) => {
    const { workspaceId } = c.req.param();
    const profile = deps.founderIntel
      ? await deps.founderIntel.getProfile(workspaceId)
      : await getFounderProfileFallback(deps, workspaceId);

    if (!profile) return c.json({ error: 'No founder profile found' }, 404);
    return c.json(profile);
  });

  app.post('/:workspaceId', async (c) => {
    const { workspaceId } = c.req.param();
    const raw = await c.req.json();
    const parsed = CreateFounderProfileInput.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const profile = await upsertFounderProfile(deps, workspaceId, parsed.data);
    return c.json(profile, 201);
  });

  app.post('/:founderId/assessment', async (c) => {
    const { founderId } = c.req.param();
    const body = await c.req.json();
    if (!body.assessmentType || !body.responses) {
      return c.json({ error: 'assessmentType and responses are required' }, 400);
    }

    const [assessment] = await deps.db
      .insert(founderAssessments)
      .values({
        founderId,
        assessmentType: body.assessmentType,
        responses: body.responses,
        analysis: body.analysis,
      })
      .returning();
    return c.json(assessment, 201);
  });

  app.get('/:founderId/strengths', async (c) => {
    const { founderId } = c.req.param();
    const strengths = await deps.db
      .select()
      .from(founderStrengths)
      .where(eq(founderStrengths.founderId, founderId));
    return c.json(strengths);
  });

  return app;
}

async function upsertFounderProfile(
  deps: GatewayDeps,
  workspaceId: string,
  body: {
    name: string;
    background?: string;
    experience?: string;
    interests: string[];
  },
) {
  const [profile] = await deps.db
    .insert(founderProfiles)
    .values({
      workspaceId,
      name: body.name,
      background: body.background,
      experience: body.experience,
      interests: body.interests,
    })
    .onConflictDoUpdate({
      target: founderProfiles.workspaceId,
      set: {
        name: body.name,
        background: body.background,
        experience: body.experience,
        interests: body.interests,
        updatedAt: new Date(),
      },
    })
    .returning();

  return profile;
}

async function getFounderProfileFallback(deps: GatewayDeps, workspaceId: string) {
  const [profile] = await deps.db
    .select()
    .from(founderProfiles)
    .where(eq(founderProfiles.workspaceId, workspaceId))
    .limit(1);
  if (!profile) return null;

  const strengths = await deps.db
    .select()
    .from(founderStrengths)
    .where(eq(founderStrengths.founderId, profile.id));

  return { ...profile, strengths };
}
