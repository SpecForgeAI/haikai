/**
 * Architecture Domain Type and Constants
 *
 * Defines the six architecture domains used to filter entity/relationship tabs
 * in Meta-Model View and palette sections in Diagram View.
 *
 * Domains:
 * - business: Business Users, Business Processes, Process Activities, Business Points
 * - application: Applications, App Components, Services, Interfaces, Endpoints, Application Points
 * - data: Logical Data Entities/Attributes, Physical Data Entities/Attributes
 * - behavioural: Events (starter entity for behavioural architecture)
 * - ui: UI Screens, UI Workflow Transitions, UI Components, UI Actions
 * - infrastructure: Environments, Cloud Accounts, Locations, Networks, Subnets,
 *   Compute Clusters/Resources, Deployment Units, Load Balancers, Listeners,
 *   Data Store Instances, Infrastructure Resources, Infrastructure Points (Spec 2026-05-04)
 */

import { Users, Boxes, Database, Workflow, MonitorSmartphone, Server, LucideIcon } from 'lucide-react';

/**
 * Architecture Domain type union
 * Represents the six architecture layers in the meta-model
 */
export type ArchitectureDomain = 'business' | 'application' | 'data' | 'behavioural' | 'ui' | 'infrastructure';

/**
 * Array of all architecture domains for iteration
 */
export const ALL_DOMAINS: ArchitectureDomain[] = ['business', 'application', 'data', 'behavioural', 'ui', 'infrastructure'];

/**
 * Display labels for each architecture domain
 * Used in domain selector UI components
 */
export const DOMAIN_LABELS: Record<ArchitectureDomain, string> = {
  business: 'Business',
  application: 'Application',
  data: 'Data',
  behavioural: 'Behavioural',
  ui: 'UI',
  infrastructure: 'Infrastructure',
};

/**
 * Lucide-react icons for each architecture domain
 * Used in domain selector UI components
 */
export const DOMAIN_ICONS: Record<ArchitectureDomain, LucideIcon> = {
  business: Users,
  application: Boxes,
  data: Database,
  behavioural: Workflow,
  ui: MonitorSmartphone,
  infrastructure: Server,
};

/**
 * Check if a string is a valid ArchitectureDomain
 * @param value - The string to check
 * @returns true if the value is a valid ArchitectureDomain
 */
export function isArchitectureDomain(value: string): value is ArchitectureDomain {
  return ALL_DOMAINS.includes(value as ArchitectureDomain);
}
