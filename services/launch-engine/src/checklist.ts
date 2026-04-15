export interface ChecklistItem {
  id: string;
  category: string;
  title: string;
  description: string;
  required: boolean;
  completed: boolean;
}

export interface ChecklistParams {
  title: string;
  techStack: string;
}

const CHECKLIST_TEMPLATE: ReadonlyArray<Omit<ChecklistItem, 'id' | 'completed'>> = [
  // domain
  {
    category: 'domain',
    title: 'Register production domain',
    description: 'Purchase and configure the primary domain name with DNS provider.',
    required: true,
  },
  {
    category: 'domain',
    title: 'Configure SSL/TLS certificate',
    description: 'Provision and install a valid TLS certificate for HTTPS.',
    required: true,
  },
  {
    category: 'domain',
    title: 'Set up DNS records',
    description: 'Configure A/CNAME/MX records for the production domain.',
    required: true,
  },
  // legal
  {
    category: 'legal',
    title: 'Publish privacy policy',
    description: 'Draft and publish a GDPR/CCPA-compliant privacy policy page.',
    required: true,
  },
  {
    category: 'legal',
    title: 'Publish terms of service',
    description: 'Draft and publish terms of service covering user rights and liability.',
    required: true,
  },
  {
    category: 'legal',
    title: 'Add cookie consent banner',
    description: 'Implement a cookie consent mechanism for analytics and tracking cookies.',
    required: true,
  },
  // analytics
  {
    category: 'analytics',
    title: 'Set up analytics tracking',
    description: 'Install and verify a privacy-respecting analytics service.',
    required: false,
  },
  {
    category: 'analytics',
    title: 'Configure error monitoring',
    description: 'Set up an error tracking service (e.g. Sentry) for production errors.',
    required: false,
  },
  {
    category: 'analytics',
    title: 'Set up uptime monitoring',
    description: 'Configure an external uptime monitor with alerting for downtime.',
    required: false,
  },
  // support
  {
    category: 'support',
    title: 'Create support email or form',
    description: 'Set up a support@domain inbox or contact form for user inquiries.',
    required: false,
  },
  {
    category: 'support',
    title: 'Write initial FAQ or docs',
    description: 'Create a minimal FAQ page or documentation covering common questions.',
    required: false,
  },
  // marketing
  {
    category: 'marketing',
    title: 'Prepare launch announcement',
    description: 'Draft social media posts and blog content for launch day.',
    required: false,
  },
  {
    category: 'marketing',
    title: 'Create Open Graph meta tags',
    description: 'Add og:title, og:description, og:image for rich social media previews.',
    required: false,
  },
  // infrastructure
  {
    category: 'infrastructure',
    title: 'Configure production environment variables',
    description: 'Set all required env vars and secrets in the production deploy target.',
    required: false,
  },
  {
    category: 'infrastructure',
    title: 'Set up database backups',
    description: 'Enable automated daily backups with point-in-time recovery.',
    required: false,
  },
];

export class LaunchChecklist {
  generateChecklist(params: ChecklistParams): ChecklistItem[] {
    return CHECKLIST_TEMPLATE.map((item, index) => ({
      ...item,
      id: `${params.title.toLowerCase().replace(/\s+/g, '-')}-${item.category}-${index}`,
      completed: false,
    }));
  }
}
