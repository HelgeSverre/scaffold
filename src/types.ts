import type { Database } from "bun:sqlite";

export interface PropertyDef {
  name: string;
  type: string;
  nullable?: boolean;
  default?: any;
  values?: string[];
  entity?: string;
}

export interface EntityDef {
  properties: (string | PropertyDef)[];
  pivot?: boolean;
  seed?: Record<string, any>[];
}

export interface AIConfig {
  model?: string;
  max_tokens?: number;
  style_reference?: string;
  prefer_claude_code?: boolean;
  instructions?: string;
}

export interface PageSummary {
  filename: string;
  title: string;
  lineCount: number;
}

export interface AIContext {
  scaffoldYml: string;
  projectPages: PageSummary[];
  promptMd: string;
  currentPageHtml?: string;
  selectedHtml?: string;
  basePageHtml?: string;
  components?: ComponentMeta[];
}

export interface ComponentMeta {
  name: string;
  description: string;
  category: string;
  path: string;
  props?: ComponentProp[];
  alpine?: string;
}

export interface ComponentProp {
  name: string;
  description?: string;
  default?: string;
}

export interface ScaffoldConfig {
  name?: string;
  entities: Record<string, EntityDef>;
  ai?: AIConfig;
}

export interface EntityMeta {
  entityName: string;
  tableName: string;
  routePath: string;
  properties: PropertyDef[];
  pivot: boolean;
  seed?: Record<string, any>[];
  relations: { property: string; targetEntity: string; targetTable: string }[];
}

export interface RouteEntry {
  method: string;
  pattern: string;
  segments: string[];
  handler: (req: Request, params: Record<string, string>) => Response | Promise<Response>;
}

export interface ScaffoldContext {
  db: Database;
  route: (method: string, path: string, handler: (req: Request) => Response | Promise<Response>) => void;
  broadcast: (page: string, message: object) => void;
  config: ScaffoldConfig;
}
