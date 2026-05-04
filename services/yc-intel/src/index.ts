import { eq, ilike, desc, count, sql } from 'drizzle-orm';
import { type Db } from '@pilot/db/client';
import { ycCompanies, ycBatches, ycAdvice, ycFounders, ingestionRecords, ycCourses } from '@pilot/db/schema';

export class YcIntelService {
  constructor(private readonly db: Db) {}

  async searchCompanies(query: string, limit = 20) {
    return this.db
      .select()
      .from(ycCompanies)
      .where(ilike(ycCompanies.name, `%${query}%`))
      .orderBy(desc(ycCompanies.createdAt))
      .limit(limit);
  }

  async getCompany(id: string) {
    const [company] = await this.db
      .select()
      .from(ycCompanies)
      .where(eq(ycCompanies.id, id))
      .limit(1);
    if (!company) return null;

    const founders = await this.db
      .select()
      .from(ycFounders)
      .where(eq(ycFounders.companyId, id));

    return { ...company, founders };
  }

  async getCompanyStats() {
    const totalCompanies = await this.db.select({ count: count() }).from(ycCompanies);
    const totalFounders = await this.db.select({ count: count() }).from(ycFounders);
    const totalAdvice = await this.db.select({ count: count() }).from(ycAdvice);

    // Get top industries
    const industries = await this.db
      .select({
        industry: ycCompanies.industry,
        count: count(),
      })
      .from(ycCompanies)
      .where(sql`${ycCompanies.industry} IS NOT NULL`)
      .groupBy(ycCompanies.industry)
      .orderBy(desc(count()))
      .limit(10);

    return {
      companies: totalCompanies[0]?.count ?? 0,
      founders: totalFounders[0]?.count ?? 0,
      adviceItems: totalAdvice[0]?.count ?? 0,
      topIndustries: industries,
    };
  }

  async listBatches() {
    return this.db
      .select()
      .from(ycBatches)
      .orderBy(desc(ycBatches.year));
  }

  async searchAdvice(query: string, limit = 20) {
    return this.db
      .select()
      .from(ycAdvice)
      .where(ilike(ycAdvice.title, `%${query}%`))
      .orderBy(desc(ycAdvice.createdAt))
      .limit(limit);
  }

  async searchAdviceByTag(tag: string, limit = 20) {
    // tags is a jsonb array
    return this.db
      .select()
      .from(ycAdvice)
      .where(sql`${ycAdvice.tags} ? ${tag}`)
      .orderBy(desc(ycAdvice.createdAt))
      .limit(limit);
  }

  async getCourseModules(program: string = 'startup_school') {
    return this.db
      .select()
      .from(ycCourses)
      .where(eq(ycCourses.program, program))
      .orderBy(ycCourses.order);
  }

  // ─── Provenance / Ingestion ───

  async getIngestionHistory(limit = 50) {
    return this.db
      .select()
      .from(ingestionRecords)
      .orderBy(desc(ingestionRecords.fetchedAt))
      .limit(limit);
  }

  async getIngestionRecord(id: string) {
    const [record] = await this.db
      .select()
      .from(ingestionRecords)
      .where(eq(ingestionRecords.id, id))
      .limit(1);
    return record ?? null;
  }
}
